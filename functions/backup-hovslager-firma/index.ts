// Supabase Edge Function: backup-hovslager-firma
// Automatisk nattbackup for ALLE hovslager-firma + liste + restore.
// Backup lagres i Storage-bucket: hov_backups/firma/<firma_id>/...
// Bilder kopieres til: hov_backups/storage/<firma_id>/...
//
// Kall:
//   { "action": "backup" } eller tom body  -> backup av alle firma
//   { "action": "list", "firma_id": "uuid" } -> liste for ett firma
//   { "action": "restore", "backup_path": "firma/<firma_id>/<fil>.json" } -> restore fra backup

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BACKUP_BUCKET = "hov_backups";
const APP_NAME = "hovslager";

const HOV_TABLES = [
  "hov_firma",
  "hov_kunder",
  "hov_hester",
  "hov_hest_bilder",
  "hov_jobber",
  "hov_jobb_bilder",
  "hov_priser",
  "hov_fakturaer",
  "hov_fakturalinjer",
  "hov_kreditnotaer",
  "hov_kreditnotalinjer",
  "hov_betalinger",
  "hov_abonnement",
  "hov_innstillinger",
];

// Delete children before parents. Restore parents before children.
const RESTORE_ORDER = [
  "hov_firma",
  "hov_kunder",
  "hov_hester",
  "hov_jobber",
  "hov_jobb_bilder",
  "hov_hest_bilder",
  "hov_priser",
  "hov_fakturaer",
  "hov_fakturalinjer",
  "hov_kreditnotaer",
  "hov_kreditnotalinjer",
  "hov_betalinger",
  "hov_abonnement",
  "hov_innstillinger",
];

const DELETE_ORDER = RESTORE_ORDER.filter((tableName) => tableName !== "hov_firma").reverse();
const IMAGE_TABLES = ["hov_jobb_bilder", "hov_hest_bilder"];

const IMAGE_BUCKET_CANDIDATES = [
  "hovslager-bilder",
  "hov-bilder",
  "bilder",
  "timer-bilder",
];

function nowIso() {
  return new Date().toISOString();
}

function osloStamp() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}-${get("minute")}-${get("second")}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isMissingTableError(error: any): boolean {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("could not find the table") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}

function isMissingFirmaIdError(error: any): boolean {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("firma_id") && (msg.includes("column") || msg.includes("could not find"));
}

function safeSlug(input: string | null | undefined) {
  return String(input || "firma")
    .toLowerCase()
    .replace(/[^a-z0-9æøå_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "firma";
}

function cleanStoragePath(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = String(input).trim();
  if (!value) return null;
  value = value.split("?")[0];

  const publicMatch = value.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
  if (publicMatch) return publicMatch[2];

  value = value.replace(/^\/+/, "");
  return value || null;
}

function filenameFromImageRow(row: any, fallbackIndex: number): string {
  const raw = row?.filnavn || row?.filsti || row?.bilde_url || row?.path || row?.bilde_path || `bilde-${fallbackIndex}`;
  const noQuery = String(raw).split("?")[0];
  const base = noQuery.split("/").filter(Boolean).pop() || `bilde-${fallbackIndex}`;
  return base.replace(/[^a-zA-Z0-9æøåÆØÅ._-]+/g, "-").slice(0, 120);
}

async function fetchRowsForFirma(supabase: any, tableName: string, firmaId: string) {
  const query = tableName === "hov_firma"
    ? supabase.from(tableName).select("*").eq("id", firmaId)
    : supabase.from(tableName).select("*").eq("firma_id", firmaId);

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) return { skipped: true, reason: "tabell finnes ikke", rows: [] };
    if (isMissingFirmaIdError(error)) return { skipped: true, reason: "mangler firma_id", rows: [] };
    throw new Error(`${tableName}: ${error.message}`);
  }

  return { skipped: false, rows: data || [] };
}

async function tryDownloadImage(supabase: any, row: any): Promise<{ ok: boolean; bucket?: string; path?: string; blob?: Blob; error?: string }> {
  const possiblePaths = [
    cleanStoragePath(row?.filsti),
    cleanStoragePath(row?.bilde_url),
    cleanStoragePath(row?.filnavn),
    cleanStoragePath(row?.path),
    cleanStoragePath(row?.bilde_path),
    cleanStoragePath(row?.logo_path),
    cleanStoragePath(row?.logo_url),
  ].filter(Boolean) as string[];

  const attempts: Array<{ bucket: string; path: string }> = [];
  for (const rawPath of possiblePaths) {
    for (const bucket of IMAGE_BUCKET_CANDIDATES) {
      attempts.push({ bucket, path: rawPath });
      if (rawPath.startsWith(`${bucket}/`)) attempts.push({ bucket, path: rawPath.slice(bucket.length + 1) });
    }
  }

  const seen = new Set<string>();
  for (const attempt of attempts) {
    const key = `${attempt.bucket}:${attempt.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { data, error } = await supabase.storage.from(attempt.bucket).download(attempt.path);
    if (!error && data) return { ok: true, bucket: attempt.bucket, path: attempt.path, blob: data };
  }

  return { ok: false, error: "fant ikke bildefil i kjente buckets" };
}

async function backupImagesForFirma(supabase: any, firmaId: string, backupStamp: string, tableName: string, imageRows: any[]) {
  const copied: any[] = [];
  const missing: any[] = [];

  for (let i = 0; i < imageRows.length; i++) {
    const row = imageRows[i];
    const found = await tryDownloadImage(supabase, row);

    if (!found.ok || !found.blob) {
      missing.push({
        table: tableName,
        id: row?.id || null,
        filnavn: row?.filnavn || null,
        filsti: row?.filsti || null,
        bilde_url: row?.bilde_url || null,
        path: row?.path || null,
        reason: found.error || "ukjent feil",
      });
      continue;
    }

    const fileName = filenameFromImageRow(row, i + 1);
    const backupImagePath = `storage/${firmaId}/${backupStamp}/${tableName}/${row?.id || i + 1}-${fileName}`;

    const { error: uploadError } = await supabase.storage.from(BACKUP_BUCKET).upload(backupImagePath, found.blob, {
      contentType: found.blob.type || "application/octet-stream",
      upsert: true,
    });

    if (uploadError) {
      missing.push({ table: tableName, id: row?.id || null, filnavn: row?.filnavn || null, reason: uploadError.message });
      continue;
    }

    copied.push({
      table: tableName,
      id: row?.id || null,
      source_bucket: found.bucket,
      source_path: found.path,
      backup_path: backupImagePath,
    });
  }

  return { copied, missing };
}

async function backupOneFirma(supabase: any, firma: any, stamp: string) {
  const firmaId = firma.id;
  const firmaNavn = firma.navn || firma.firmanavn || "firma";
  const backup: Record<string, unknown> = {
    app: APP_NAME,
    backup_type: "firma",
    firma_id: firmaId,
    firma_navn: firmaNavn,
    created_at: nowIso(),
    created_at_oslo: stamp,
    tables: {},
    storage_images: {},
  };

  const summary: Record<string, unknown> = {};

  for (const tableName of HOV_TABLES) {
    const result = await fetchRowsForFirma(supabase, tableName, firmaId);
    (backup.tables as Record<string, unknown>)[tableName] = result.rows;
    summary[tableName] = result.skipped
      ? { skipped: true, reason: result.reason }
      : { rows: Array.isArray(result.rows) ? result.rows.length : 0 };
  }

  const allCopied: any[] = [];
  const allMissing: any[] = [];

  for (const tableName of IMAGE_TABLES) {
    const rows = ((backup.tables as any)[tableName] || []) as any[];
    const result = await backupImagesForFirma(supabase, firmaId, stamp, tableName, rows);
    allCopied.push(...result.copied);
    allMissing.push(...result.missing);
    summary[`storage_${tableName}`] = {
      rows_i_tabell: rows.length,
      kopiert: result.copied.length,
      mangler: result.missing.length,
    };
  }

  backup.storage_images = { copied: allCopied, missing: allMissing };
  (backup as any).summary = summary;

  const json = JSON.stringify(backup, null, 2);
  const fileName = `hovslager-${safeSlug(firmaNavn)}-${stamp}.json`;
  const jsonPath = `firma/${firmaId}/${fileName}`;
  const bytes = new TextEncoder().encode(json).length;

  const { error: uploadError } = await supabase.storage.from(BACKUP_BUCKET).upload(jsonPath, new Blob([json], { type: "application/json" }), {
    contentType: "application/json; charset=utf-8",
    upsert: false,
  });

  if (uploadError) throw new Error(`Storage upload feilet for ${firmaId}: ${uploadError.message}`);

  const signed = await supabase.storage.from(BACKUP_BUCKET).createSignedUrl(jsonPath, 60 * 60);

  return {
    ok: true,
    backup_scope: "firma",
    backup_type: "firma",
    bucket: BACKUP_BUCKET,
    firma_id: firmaId,
    firma_navn: firmaNavn,
    path: jsonPath,
    file_path: jsonPath,
    name: fileName,
    file_size: bytes,
    storrelse_bytes: bytes,
    storrelse_kb: Math.ceil(bytes / 1024),
    created_at: (backup as any).created_at,
    created_at_oslo: stamp,
    signed_url: signed.data?.signedUrl || null,
    summary,
  };
}

async function runNightBackupAllFirms(supabase: any) {
  const { data, error } = await supabase.from("hov_firma").select("id, navn, epost, linknavn").order("navn");
  if (error) throw new Error(`Kunne ikke hente hov_firma: ${error.message}`);

  const firmaer = data || [];
  const stamp = osloStamp();
  const results = [];
  const errors = [];

  for (const firma of firmaer) {
    try {
      results.push(await backupOneFirma(supabase, firma, stamp));
    } catch (err) {
      errors.push({
        firma_id: firma?.id || null,
        firma_navn: firma?.navn || null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: errors.length === 0,
    app: APP_NAME,
    backup_type: "nightly_all_firms",
    created_at: nowIso(),
    created_at_oslo: stamp,
    bucket: BACKUP_BUCKET,
    antall_firma: firmaer.length,
    antall_ok: results.length,
    antall_feil: errors.length,
    results,
    errors,
  };
}

function parseFirmaIdFromPath(path: string): string | null {
  const m = String(path || "").match(/^firma\/([^/]+)\//);
  return m ? m[1] : null;
}

type AuthContext = {
  authenticated: boolean;
  userId: string | null;
  firmaId: string | null;
  role: string | null;
  isSysadm: boolean;
};

function normalizeRole(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function isValidCronRequest(req: Request): boolean {
  const configured = Deno.env.get("BACKUP_CRON_SECRET") || "";
  const supplied = req.headers.get("x-cron-secret") || "";
  if (configured && supplied && constantTimeEqual(configured, supplied)) {
    return true;
  }

  const serviceRole =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("APP_SERVICE_ROLE_KEY") ||
    "";

  const auth =
    req.headers.get("Authorization") ||
    req.headers.get("authorization") ||
    "";

  const bearer = auth.replace(/^Bearer\s+/i, "").trim();

  return Boolean(
    serviceRole &&
    bearer &&
    constantTimeEqual(serviceRole, bearer)
  );
}

async function authContextFromRequest(supabase: any, req: Request): Promise<AuthContext> {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { authenticated: false, userId: null, firmaId: null, role: null, isSysadm: false };

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id || null;
  if (userError || !userId) return { authenticated: false, userId: null, firmaId: null, role: null, isSysadm: false };

  const profile = await supabase
    .from("hov_profiles")
    .select("firma_id, rolle")
    .eq("auth_user_id", userId)
    .maybeSingle();

  const role = normalizeRole(profile.data?.rolle || "hovslager");
  if (role === "deaktivert") throw new Error("Brukeren er deaktivert");

  let firmaId = profile.data?.firma_id || null;
  if (!firmaId) {
    const firma = await supabase.from("hov_firma").select("id").eq("auth_user_id", userId).maybeSingle();
    firmaId = firma.data?.id || null;
  }

  return {
    authenticated: true,
    userId,
    firmaId,
    role,
    isSysadm: role === "sysadm",
  };
}

function requestedFirmaId(body: any): string | null {
  const value = body?.firma_id || body?.firmaId || body?.firmaID || null;
  return value ? String(value) : null;
}

function authorizedFirmaId(ctx: AuthContext, body: any): string {
  if (!ctx.authenticated) throw new Error("Du må være innlogget");
  const requested = requestedFirmaId(body);
  if (ctx.isSysadm) {
    const id = requested || ctx.firmaId;
    if (!id) throw new Error("Mangler firma_id");
    return id;
  }
  if (!ctx.firmaId) throw new Error("Brukeren er ikke koblet til et firma");
  if (requested && requested !== ctx.firmaId) throw new Error("Ingen tilgang til valgt firma");
  return ctx.firmaId;
}

async function listBackups(supabase: any, body: any, ctx: AuthContext) {
  const firmaId = authorizedFirmaId(ctx, body);
  if (!firmaId) {
    return { ok: false, error: "Mangler firma_id for liste" };
  }

  const prefix = `firma/${firmaId}`;
  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "desc" },
  });

  if (error) throw new Error(`Kunne ikke hente backup-liste: ${error.message}`);

  const backups = [];
  for (const file of (data || [])) {
    if (!file || file.name?.startsWith(".") || !file.name?.toLowerCase().endsWith(".json")) continue;
    const filePath = `${prefix}/${file.name}`;
    const size = file.metadata?.size || file.size || null;
    const signed = await supabase.storage.from(BACKUP_BUCKET).createSignedUrl(filePath, 60 * 60);
    backups.push({
      name: file.name,
      path: filePath,
      file_path: filePath,
      backup_path: filePath,
      created_at: file.created_at || file.updated_at || file.last_accessed_at || null,
      updated_at: file.updated_at || null,
      file_size: size,
      size,
      storrelse_bytes: size,
      storrelse_kb: size ? Math.ceil(size / 1024) : null,
      signed_url: signed.data?.signedUrl || null,
      status: "ok",
      backup_scope: "firma",
      firma_id: firmaId,
    });
  }

  return { ok: true, bucket: BACKUP_BUCKET, firma_id: firmaId, backups };
}

async function downloadBackupJson(supabase: any, backupPath: string) {
  const cleanPath = String(backupPath || "").replace(/^\/+/, "");
  if (!cleanPath || !cleanPath.startsWith("firma/") || !cleanPath.endsWith(".json")) {
    throw new Error("Ugyldig backup_path. Må være firma/<firma_id>/<fil>.json");
  }

  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).download(cleanPath);
  if (error || !data) throw new Error(`Kunne ikke laste backupfil: ${error?.message || "ukjent feil"}`);

  const text = await data.text();
  let backup: any;
  try {
    backup = JSON.parse(text);
  } catch (_err) {
    throw new Error("Backupfilen er ikke gyldig JSON");
  }

  if (!backup || backup.app !== APP_NAME || backup.backup_type !== "firma" || !backup.firma_id || !backup.tables) {
    throw new Error("Backupfilen har ikke forventet hovslager-format");
  }

  return { backup, cleanPath };
}

function tableRows(backup: any, tableName: string): any[] {
  const rows = backup?.tables?.[tableName];
  return Array.isArray(rows) ? rows : [];
}

async function tableExists(supabase: any, tableName: string): Promise<boolean> {
  const { error } = await supabase.from(tableName).select("*").limit(1);
  return !error || !isMissingTableError(error);
}

async function deleteFirmaRows(supabase: any, tableName: string, firmaId: string) {
  if (!(await tableExists(supabase, tableName))) return { skipped: true, reason: "tabell finnes ikke", deleted: null };

  const query = tableName === "hov_firma"
    ? supabase.from(tableName).delete().eq("id", firmaId)
    : supabase.from(tableName).delete().eq("firma_id", firmaId);

  const { error } = await query;
  if (error) {
    if (isMissingFirmaIdError(error)) return { skipped: true, reason: "mangler firma_id", deleted: null };
    throw new Error(`Sletting feilet for ${tableName}: ${error.message}`);
  }
  return { skipped: false, deleted: true };
}

async function restoreRows(supabase: any, tableName: string, rows: any[]) {
  if (!rows.length) return { rows: 0 };
  if (!(await tableExists(supabase, tableName))) return { skipped: true, reason: "tabell finnes ikke", rows: 0 };

  // Upsert first. If the table has no matching primary/unique key metadata available to PostgREST, fall back to insert.
  const { error } = await supabase.from(tableName).upsert(rows, { onConflict: "id" });
  if (!error) return { rows: rows.length, method: "upsert" };

  const { error: insertError } = await supabase.from(tableName).insert(rows);
  if (insertError) throw new Error(`Restore feilet for ${tableName}: ${insertError.message || error.message}`);
  return { rows: rows.length, method: "insert" };
}

function validateBackupRows(backup: any, firmaId: string) {
  for (const tableName of HOV_TABLES) {
    for (const row of tableRows(backup, tableName)) {
      if (tableName === "hov_firma") {
        if (String(row?.id || "") !== firmaId) throw new Error(`Ugyldig firma-rad i ${tableName}`);
      } else if (String(row?.firma_id || "") !== firmaId) {
        throw new Error(`Backup inneholder rad fra annet firma i ${tableName}`);
      }
    }
  }
}

async function restoreBackup(supabase: any, body: any, ctx: AuthContext) {
  if (body?.confirm !== true) throw new Error("Restore krever confirm: true");
  const backupPath = body?.backup_path || body?.backupPath || body?.path || body?.file_path || body?.filePath || body?.filsti || body?.file;
  if (!backupPath) throw new Error("Mangler backup_path");

  const { backup, cleanPath } = await downloadBackupJson(supabase, backupPath);
  const firmaId = String(backup.firma_id);
  const allowedFirmaId = authorizedFirmaId(ctx, { firma_id: firmaId });
  if (allowedFirmaId !== firmaId) throw new Error("Ingen tilgang til backupens firma");
  const pathFirmaId = parseFirmaIdFromPath(cleanPath);
  if (!pathFirmaId || pathFirmaId !== firmaId) {
    throw new Error("backup_path og backupfil har ulik firma_id");
  }
  validateBackupRows(backup, firmaId);

  const deleted: Record<string, unknown> = {};
  for (const tableName of DELETE_ORDER) {
    deleted[tableName] = await deleteFirmaRows(supabase, tableName, firmaId);
  }

  const restored: Record<string, unknown> = {};
  for (const tableName of RESTORE_ORDER) {
    restored[tableName] = await restoreRows(supabase, tableName, tableRows(backup, tableName));
  }

  return {
    ok: true,
    action: "restore",
    bucket: BACKUP_BUCKET,
    backup_path: cleanPath,
    firma_id: firmaId,
    firma_navn: backup.firma_navn || null,
    restored_at: nowIso(),
    restored_at_oslo: osloStamp(),
    deleted,
    restored,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Bruk POST" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("APP_SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("APP_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({
        ok: false,
        error: "Mangler secrets",
        trenger: ["SUPABASE_URL eller APP_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY eller APP_SERVICE_ROLE_KEY"],
      }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "backup").toLowerCase();
    const cronRequest = isValidCronRequest(req);
    const ctx = cronRequest
      ? { authenticated: false, userId: null, firmaId: null, role: "cron", isSysadm: false }
      : await authContextFromRequest(supabase, req);

    if (action === "list") {
      if (cronRequest) return jsonResponse({ ok: false, error: "Cron kan ikke liste backups" }, 403);
      return jsonResponse(await listBackups(supabase, body, ctx));
    }

    if (action === "restore") {
      if (cronRequest) return jsonResponse({ ok: false, error: "Cron kan ikke kjøre restore" }, 403);
      return jsonResponse(await restoreBackup(supabase, body, ctx));
    }

    const scope = String(body?.scope || "firma").toLowerCase();
    if (cronRequest) {
      const result = await runNightBackupAllFirms(supabase);
      return jsonResponse(result, result.ok ? 200 : 207);
    }

    if (!ctx.authenticated) return jsonResponse({ ok: false, error: "Du må være innlogget" }, 401);

    if (scope === "system") {
      if (!ctx.isSysadm) return jsonResponse({ ok: false, error: "Bare sysadm kan ta systembackup" }, 403);
      const result = await runNightBackupAllFirms(supabase);
      return jsonResponse(result, result.ok ? 200 : 207);
    }

    const firmaId = authorizedFirmaId(ctx, body);
    const { data: firma, error: firmaError } = await supabase
      .from("hov_firma")
      .select("id, navn, epost, linknavn")
      .eq("id", firmaId)
      .maybeSingle();
    if (firmaError || !firma) throw new Error(`Fant ikke firma: ${firmaError?.message || firmaId}`);

    return jsonResponse(await backupOneFirma(supabase, firma, osloStamp()));
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
