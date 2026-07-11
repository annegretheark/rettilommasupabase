// hov-backup/index.ts
// Full fix: list + backup + restore.
// Leser bruker fra JWT-token direkte, og tillater hovslager backup/restore kun eget firma.
//
// Deploy:
// supabase functions deploy hov-backup --no-verify-jwt=false

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import JSZip from "npm:jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const DATA_TABLES = [
  "hov_firma",
  "hov_profiles",
  "hov_kunder",
  "hov_hester",
  "hov_jobber",
  "hov_fakturaer",
  "hov_kreditnotaer",
  "hov_priser",
  "hov_hest_bilder",
  "hov_jobb_bilder",
];

const RESTORE_TABLES = [
  "hov_priser",
  "hov_kreditnotaer",
  "hov_fakturaer",
  "hov_jobb_bilder",
  "hov_hest_bilder",
  "hov_jobber",
  "hov_hester",
  "hov_kunder",
  "hov_firma",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function decodeJwtPayload(token: string) {
  const part = token.split(".")[1];
  if (!part) throw new Error("Ugyldig JWT-token: mangler payload.");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(atob(padded));
}

async function getContext(req: Request) {
  if (!SUPABASE_URL) throw new Error("Mangler SUPABASE_URL secret.");
  if (!SERVICE_ROLE_KEY) throw new Error("Mangler SUPABASE_SERVICE_ROLE_KEY secret.");

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Mangler Authorization Bearer token.");

  const payload = decodeJwtPayload(token);
  const userId = payload.sub;
  const email = payload.email || payload.user_metadata?.email || "";

  if (!userId) throw new Error("Kunne ikke lese user id fra token.");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let { data: profile, error: profileErr } = await admin
    .from("hov_profiles")
    .select("*")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (profileErr) throw new Error("Kunne ikke lese hov_profiles: " + profileErr.message);

  if (!profile) {
    let firma = null;

    const byAuth = await admin
      .from("hov_firma")
      .select("*")
      .eq("auth_user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!byAuth.error && byAuth.data) firma = byAuth.data;

    if (!firma && email) {
      const byEmail = await admin
        .from("hov_firma")
        .select("*")
        .ilike("epost", email)
        .limit(1)
        .maybeSingle();
      if (!byEmail.error && byEmail.data) firma = byEmail.data;
    }

    if (firma?.id) {
      const { data: newProfile, error: upErr } = await admin
        .from("hov_profiles")
        .upsert({
          auth_user_id: userId,
          firma_id: firma.id,
          rolle: "hovslager",
          epost: email || firma.epost || null,
        }, { onConflict: "auth_user_id" })
        .select("*")
        .single();

      if (upErr) throw new Error("Kunne ikke opprette profil automatisk: " + upErr.message);
      profile = newProfile;
    }
  }

  if (!profile) throw new Error("Fant ikke profil/firma for innlogget bruker " + (email || userId));

  return {
    admin,
    user: { id: userId, email },
    profile,
    isSysadm: profile.rolle === "sysadm",
  };
}

async function selectRows(admin: any, table: string, scope: "firma" | "system", firmaId: string | null) {
  try {
    let q = admin.from(table).select("*");
    if (scope === "firma") {
      if (table === "hov_firma") q = q.eq("id", firmaId);
      else if (table === "hov_profiles") q = q.eq("firma_id", firmaId);
      else q = q.eq("firma_id", firmaId);
    }
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message, rows: [] };
    return { ok: true, error: null, rows: data ?? [] };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), rows: [] };
  }
}

async function doList(ctx: any) {
  let q = ctx.admin
    .from("hov_backup_log")
    .select("*")
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!ctx.isSysadm) q = q.eq("firma_id", ctx.profile.firma_id);

  const { data, error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);

  const rows = [];
  for (const b of data ?? []) {
    let signed_url = null;
    if (b.file_path) {
      const { data: signed } = await ctx.admin.storage
        .from("hov_backups")
        .createSignedUrl(b.file_path, 60 * 60);
      signed_url = signed?.signedUrl ?? null;
    }
    rows.push({ ...b, signed_url });
  }

  return json({ ok: true, action: "list", backups: rows });
}

async function doBackup(ctx: any, body: any) {
  const requestedScope = body.scope === "system" ? "system" : "firma";
  const scope: "firma" | "system" = ctx.isSysadm ? requestedScope : "firma";
  const firmaId = ctx.isSysadm && scope === "firma"
    ? (body.firma_id || ctx.profile.firma_id)
    : ctx.profile.firma_id;

  if (scope === "firma" && !firmaId) {
    return json({ ok: false, error: "Mangler firma_id på brukerprofilen." }, 400);
  }

  const prefix = scope === "system" ? `system/${stamp()}` : `firma/${firmaId}/${stamp()}`;

  const { data: log, error: logErr } = await ctx.admin
    .from("hov_backup_log")
    .insert({
      requested_by: ctx.user.id,
      requested_email: ctx.user.email,
      firma_id: scope === "firma" ? firmaId : null,
      status: "started",
      backup_scope: scope,
      backup_type: body.mode || "manual",
      backup_prefix: prefix,
    })
    .select("id")
    .single();

  if (logErr) return json({ ok: false, error: "Kunne ikke skrive backup-logg: " + logErr.message }, 500);

  try {
    const zip = new JSZip();
    const meta = {
      created_at: new Date().toISOString(),
      created_by: ctx.user.email,
      role: ctx.profile.rolle,
      scope,
      firma_id: scope === "firma" ? firmaId : null,
      version: "restore-action-fix",
    };

    zip.file("backup_meta.json", JSON.stringify(meta, null, 2));

    const manifest: Record<string, unknown> = {};
    for (const table of DATA_TABLES) {
      const r = await selectRows(ctx.admin, table, scope, firmaId);
      manifest[table] = { ok: r.ok, error: r.error, count: r.rows.length };
      zip.file(`data/${table}.json`, JSON.stringify(r.rows, null, 2));
    }
    zip.file("data_manifest.json", JSON.stringify(manifest, null, 2));

    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const filePath = `${prefix}/backup.zip`;

    const { error: uploadErr } = await ctx.admin.storage
      .from("hov_backups")
      .upload(filePath, bytes, { contentType: "application/zip", upsert: false });

    if (uploadErr) throw new Error("Kunne ikke lagre ZIP: " + uploadErr.message);

    const { data: signed } = await ctx.admin.storage
      .from("hov_backups")
      .createSignedUrl(filePath, 60 * 60);

    await ctx.admin
      .from("hov_backup_log")
      .update({ status: "ok", file_path: filePath, file_size: bytes.byteLength, meta })
      .eq("id", log.id);

    return json({
      ok: true,
      action: "backup",
      backup_scope: scope,
      firma_id: scope === "firma" ? firmaId : null,
      file_path: filePath,
      file_size: bytes.byteLength,
      signed_url: signed?.signedUrl ?? null,
    });
  } catch (e) {
    const message = String(e?.message ?? e);
    await ctx.admin.from("hov_backup_log").update({ status: "error", error_message: message }).eq("id", log.id);
    return json({ ok: false, error: message }, 500);
  }
}

async function upsertRows(admin: any, table: string, rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return { table, count: 0, ok: true };
  const { error } = await admin.from(table).upsert(rows);
  if (error) return { table, count: rows.length, ok: false, error: error.message };
  return { table, count: rows.length, ok: true };
}

async function doRestore(ctx: any, body: any) {
  const filePath = String(body.file_path || "");
  if (!filePath) return json({ ok: false, error: "Mangler file_path." }, 400);

  if (!ctx.isSysadm && !filePath.startsWith(`firma/${ctx.profile.firma_id}/`)) {
    return json({ ok: false, error: "Du kan bare gjenopprette backup for eget firma." }, 403);
  }

  const { data: blob, error: dlErr } = await ctx.admin.storage
    .from("hov_backups")
    .download(filePath);

  if (dlErr || !blob) return json({ ok: false, error: dlErr?.message || "Fant ikke backupfil." }, 404);

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const metaFile = zip.file("backup_meta.json");
  if (!metaFile) return json({ ok: false, error: "Backup mangler backup_meta.json." }, 400);

  const meta = JSON.parse(await metaFile.async("string"));

  if (!ctx.isSysadm && meta.firma_id !== ctx.profile.firma_id) {
    return json({ ok: false, error: "Backup tilhører ikke ditt firma." }, 403);
  }

  const results: any[] = [];

  for (const table of RESTORE_TABLES) {
    const f = zip.file(`data/${table}.json`);
    if (!f) continue;
    const rows = JSON.parse(await f.async("string"));
    results.push(await upsertRows(ctx.admin, table, rows));
  }

  await ctx.admin.from("hov_backup_log").insert({
    requested_by: ctx.user.id,
    requested_email: ctx.user.email,
    firma_id: meta.scope === "firma" ? meta.firma_id : null,
    status: "ok",
    backup_scope: meta.scope || "firma",
    backup_type: "restore",
    backup_prefix: filePath,
    meta: { restored_from: filePath, restore_results: results },
  });

  return json({ ok: true, action: "restore", file_path: filePath, results });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  try {
    const ctx = await getContext(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "backup";

    if (action === "list") return await doList(ctx);
    if (action === "backup") return await doBackup(ctx, body);
    if (action === "restore") return await doRestore(ctx, body);

    return json({ ok: false, error: "Ukjent action: " + action }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
