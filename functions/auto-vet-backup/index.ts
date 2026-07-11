import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Kandidatliste for veterinærmodulen.
// Funksjonen prøver alle disse, men hopper trygt over tabeller som ikke finnes i prosjektet.
// NB: Handverker-tabeller (hand_*) skal ikke med i veterinærbackup.
const TABLES = [
  "vet_klinikker",
  "vet_klinikk_brukere",
  "vet_dyreeiere",
  "vet_dyr",
  "vet_priser",
  "vet_varer",
  "vet_lager",
  "vet_lager_logg",
  "vet_biler",
  "vet_bil_lager",
  "vet_journal",
  "vet_journal_apning_logg",
  "vet_journal_bilder",
  // Valgfri/eldre tabell. Hvis den ikke finnes, blir den bare registrert som skipped.
  "vet_journal_varer",
];

const CLINIC_FILTER: Record<string, string | null> = {
  vet_klinikker: "id",
  vet_klinikk_brukere: "klinikk_id",
  vet_dyreeiere: "klinikk_id",
  vet_dyr: "klinikk_id",
  vet_priser: "klinikk_id",
  vet_varer: "klinikk_id",
  vet_lager: "klinikk_id",
  vet_biler: "klinikk_id",
  vet_bil_lager: "klinikk_id",
  vet_journal: "klinikk_id",
  vet_journal_apning_logg: "klinikk_id",
  vet_journal_bilder: "klinikk_id",
  vet_lager_logg: "klinikk_id",
  vet_journal_varer: "klinikk_id",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function cleanRole(role: unknown) { return String(role || "").trim().toLowerCase(); }
function safePath(p: unknown) { return String(p || "").replace(/^\/+/, ""); }
function idString(v: unknown) { return String(v || "").trim(); }
function isMissingTableError(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return code === "pgrst205" || code === "42p01" || msg.includes("could not find the table") || msg.includes("does not exist") || msg.includes("schema cache");
}

async function listRecursive(service: any, bucket: string, prefix: string, out: any[] = []) {
  const { data, error } = await service.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (error) return out;
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id || String(item.name || "").endsWith(".json")) {
      out.push({ path, name: item.name, updated_at: item.updated_at || item.created_at || null, size: item.metadata?.size || 0 });
    } else {
      await listRecursive(service, bucket, path, out);
    }
  }
  return out;
}

function filterBackupForClinic(sourceBackup: Record<string, any>, klinikkId: string) {
  const filteredTables: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = Array.isArray(sourceBackup.tabeller?.[table]) ? sourceBackup.tabeller[table] : [];
    const filterColumn = CLINIC_FILTER[table];
    if (!filterColumn) filteredTables[table] = rows;
    else filteredTables[table] = rows.filter((row: any) => String(row?.[filterColumn] || "") === String(klinikkId));
  }
  return {
    ...sourceBackup,
    versjon: 4,
    scope: "clinic",
    klinikk_id: klinikkId,
    kjede_id: null,
    source_scope: sourceBackup.scope || null,
    source_path: sourceBackup.path || null,
    tabeller: filteredTables,
  };
}
function clinicListFromBackup(backup: Record<string, any>) {
  const seen = new Set<string>();
  const names = new Map<string, string>();
  const result: any[] = [];

  const clinicRows = Array.isArray(backup.tabeller?.vet_klinikker)
    ? backup.tabeller.vet_klinikker
    : [];

  for (const row of clinicRows) {
    const id = idString(row?.id);
    if (!id) continue;
    names.set(id, String(row?.navn || row?.name || row?.klinikk_navn || id));
    seen.add(id);
  }

  // Robust fallback: en eldre eller delvis backup kan ha mangelfull
  // vet_klinikker-tabell, mens klinikk_id finnes i de andre tabellene.
  for (const table of TABLES) {
    const filterColumn = CLINIC_FILTER[table];
    if (!filterColumn || table === "vet_klinikker") continue;
    const rows = Array.isArray(backup.tabeller?.[table]) ? backup.tabeller[table] : [];
    for (const row of rows) {
      const id = idString(row?.[filterColumn]);
      if (id) seen.add(id);
    }
  }

  const backupClinicId = idString(backup.klinikk_id);
  if (backupClinicId) seen.add(backupClinicId);

  for (const id of seen) result.push({ id, navn: names.get(id) || id });
  result.sort((a, b) => String(a.navn).localeCompare(String(b.navn), "nb"));
  return result;
}



async function uploadBackup(service: any, path: string, backup: Record<string, unknown>, errors: Record<string, string>) {
  const { error } = await service.storage.from("vet-backups").upload(path, JSON.stringify({ ...backup, path, errors }, null, 2), {
    contentType: "application/json; charset=utf-8",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const BACKUP_CRON_SECRET = Deno.env.get("BACKUP_CRON_SECRET") || "";
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i Edge Function secrets." }, 500);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "backup").toLowerCase();
  const requestedScopeRaw = String(body?.scope || (body?.klinikk_id ? "clinic" : "all")).toLowerCase();
  let requestedKlinikkId = body?.klinikk_id ? String(body.klinikk_id) : "";

  const cronSecret = req.headers.get("x-backup-secret") || body?.backup_secret || "";
  const isCron = Boolean(BACKUP_CRON_SECRET && cronSecret === BACKUP_CRON_SECRET);
  let isSystemAdmin = false;
  let isClinicAdmin = false;
  let isChainAdmin = false;
  let brukerKlinikkId = "";
  let actorEmail = "";

  if (isCron) {
    isSystemAdmin = true;
  } else {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || !ANON_KEY) return json({ error: "Mangler innlogging/token." }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    actorEmail = String(userData?.user?.email || "").toLowerCase();
    if (userError || !actorEmail) return json({ error: "Kunne ikke verifisere innlogget bruker." }, 401);
    const { data: bruker, error: brukerError } = await service.from("vet_klinikk_brukere").select("id, klinikk_id, rolle, aktiv, epost").eq("epost", actorEmail).eq("aktiv", true).maybeSingle();
    const rolle = cleanRole(bruker?.rolle);
    brukerKlinikkId = bruker?.klinikk_id ? String(bruker.klinikk_id) : "";
    isSystemAdmin = actorEmail === "greknuts@online.no" || rolle === "systemadmin";
    isChainAdmin = ["kjedeadmin", "kjedeadministrator", "konsernadmin", "konsernadministrator", "chainadmin"].includes(rolle);
    isClinicAdmin = isSystemAdmin || isChainAdmin || ["admin", "klinikkadmin", "klinikkadm"].includes(rolle);
    if (brukerError || !isClinicAdmin) return json({ error: "Kun systemadmin/kjedeadmin/klinikkadmin kan bruke backup." }, 403);
  }

  let scope = requestedScopeRaw === "all" ? "all" : (requestedScopeRaw === "chain" ? "chain" : "clinic");
  if (scope === "all" && !isSystemAdmin) return json({ error: "Bare systemadmin kan ta backup av alle klinikker." }, 403);
  if (scope === "chain" && !(isSystemAdmin || isChainAdmin)) return json({ error: "Bare systemadmin/kjedeadmin kan ta backup av kjede." }, 403);
  if (scope !== "all") {
    if (!requestedKlinikkId) requestedKlinikkId = brukerKlinikkId;
    if (!requestedKlinikkId) return json({ error: "Mangler klinikk_id for backup." }, 400);
    if (!isSystemAdmin && !isChainAdmin && String(requestedKlinikkId) !== String(brukerKlinikkId)) return json({ error: "Klinikkadmin kan bare bruke egen klinikk." }, 403);
  }

  await service.storage.createBucket("vet-backups", { public: false }).catch(() => null);

  const allowedPrefixes = isSystemAdmin
    ? ["manual/", "auto/"]
    : isChainAdmin
      ? [`manual/kjede-${requestedKlinikkId}/`, `auto/kjede-${requestedKlinikkId}/`, `manual/klinikk-${requestedKlinikkId}/`, `auto/klinikk-${requestedKlinikkId}/`]
      : [`manual/klinikk-${brukerKlinikkId || requestedKlinikkId}/`, `auto/klinikk-${brukerKlinikkId || requestedKlinikkId}/`];

  if (action === "list") {
    const clinicIdForList = brukerKlinikkId || requestedKlinikkId;
    const prefixes = isSystemAdmin
      ? (scope === "all" ? ["manual/alle-klinikker", "auto/alle-klinikker"] : (scope === "chain" ? [`manual/kjede-${requestedKlinikkId}`, `auto/kjede-${requestedKlinikkId}`] : [`manual/klinikk-${requestedKlinikkId}`, `auto/klinikk-${requestedKlinikkId}`]))
      : isChainAdmin
        ? (scope === "chain" ? [`manual/kjede-${requestedKlinikkId}`, `auto/kjede-${requestedKlinikkId}`] : [`manual/klinikk-${requestedKlinikkId}`, `auto/klinikk-${requestedKlinikkId}`])
        : [`manual/klinikk-${clinicIdForList}`, `auto/klinikk-${clinicIdForList}`];
    const all: any[] = [];
    for (const prefix of prefixes) await listRecursive(service, "vet-backups", prefix, all);
    all.sort((a, b) => String(b.path).localeCompare(String(a.path)));
    return json({ ok: true, backups: all.slice(0, 100) });
  }

  if (action === "inspect" || action === "restore") {
    const path = safePath(body?.path);
    if (!path || !path.endsWith(".json")) return json({ error: "Mangler gyldig backup-path." }, 400);
    if (!allowedPrefixes.some((p) => path.startsWith(p))) return json({ error: "Du har ikke tilgang til denne backupen." }, 403);
    const { data: fileData, error: downloadError } = await service.storage.from("vet-backups").download(path);
    if (downloadError || !fileData) return json({ error: "Kunne ikke lese backup fra Supabase Storage: " + (downloadError?.message || "ukjent feil") }, 500);
    const originalBackup = JSON.parse(await fileData.text());
    if (!originalBackup || originalBackup.type !== "rett-i-lomma-veterinaer-backup" || !originalBackup.tabeller) return json({ error: "Ugyldig backupfil." }, 400);

    if (action === "inspect") {
      const klinikker = clinicListFromBackup(originalBackup);
      return json({ ok: true, path, scope: originalBackup.scope || null, klinikk_id: originalBackup.klinikk_id || null, clinic_count: klinikker.length, klinikker });
    }

    const restoreClinicId = idString(body?.restore_klinikk_id || body?.klinikk_id || "");
    let backup = originalBackup;
    if (restoreClinicId) {
      if (!isSystemAdmin && !isChainAdmin && String(restoreClinicId) !== String(brukerKlinikkId)) return json({ error: "Klinikkadmin kan bare gjenopprette egen klinikk." }, 403);
      const available = clinicListFromBackup(originalBackup).map((k: any) => String(k.id));
      if (available.length && !available.includes(String(restoreClinicId))) return json({ error: "Valgt klinikk finnes ikke i denne backupen." }, 400);
      backup = filterBackupForClinic(originalBackup, restoreClinicId);
    } else if (!isSystemAdmin && !isChainAdmin && String(originalBackup.klinikk_id || "") !== String(brukerKlinikkId)) {
      return json({ error: "Klinikkadmin kan bare gjenopprette backup for egen klinikk." }, 403);
    }

    let rows = 0;
    const restoreErrors: Record<string, string> = {};
    const restoreSkipped: Record<string, string> = {};
    const restoreStatus: Record<string, { ok: boolean; rows: number; skipped?: boolean; error?: string }> = {};
    const restoreTables = ["vet_klinikker", "vet_klinikk_brukere", ...TABLES.filter((t) => t !== "vet_klinikker" && t !== "vet_klinikk_brukere")];
    for (const table of restoreTables) {
      const rader = Array.isArray(backup.tabeller[table]) ? backup.tabeller[table] : [];
      if (!rader.length) continue;
      const { error } = await service.from(table).upsert(rader, { onConflict: "id" });
      if (error) {
        if (isMissingTableError(error)) {
          restoreSkipped[table] = error.message;
          restoreStatus[table] = { ok: false, rows: 0, skipped: true, error: error.message };
          continue;
        }
        restoreErrors[table] = error.message;
        return json({ error: `Restore stoppet på ${table}: ${error.message}`, table, restore_errors: restoreErrors, restore_skipped: restoreSkipped }, 500);
      }
      rows += rader.length;
      restoreStatus[table] = { ok: true, rows: rader.length };
    }
    return json({ ok: true, restored: true, path, rows, restore_klinikk_id: restoreClinicId || null, restore_skipped: restoreSkipped, restore_status: restoreStatus });
  }

  const backup: Record<string, any> = {
    type: "rett-i-lomma-veterinaer-backup",
    versjon: 4,
    laget: new Date().toISOString(),
    source: isCron ? "automatic" : (body?.source || "manual"),
    scope,
    klinikk_id: scope === "clinic" ? requestedKlinikkId : null,
    kjede_id: scope === "chain" ? requestedKlinikkId : null,
    actor_email: actorEmail || null,
    tabeller: {},
  };

  const errors: Record<string, string> = {};
  const skipped: Record<string, string> = {};
  const tableStatus: Record<string, { ok: boolean; rows: number; skipped?: boolean; error?: string }> = {};
  for (const table of TABLES) {
    let query = service.from(table).select("*");
    const filterColumn = CLINIC_FILTER[table];
    if (scope === "clinic" && filterColumn) query = query.eq(filterColumn, requestedKlinikkId);
    if (scope === "chain" && filterColumn) query = query.eq(filterColumn, requestedKlinikkId);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) {
        skipped[table] = error.message;
        tableStatus[table] = { ok: false, rows: 0, skipped: true, error: error.message };
        continue;
      }
      errors[table] = error.message;
      backup.tabeller[table] = [];
      tableStatus[table] = { ok: false, rows: 0, error: error.message };
    } else {
      backup.tabeller[table] = data || [];
      tableStatus[table] = { ok: true, rows: Array.isArray(data) ? data.length : 0 };
    }
  }
  backup.status = {
    clinic_count: clinicListFromBackup(backup).length,
    tables_attempted: TABLES.length,
    tables_backed_up: Object.values(tableStatus).filter((s: any) => s.ok).length,
    tables_skipped: Object.keys(skipped),
    table_status: tableStatus,
  };

  const now = new Date();
  const dato = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const scopeFolder = scope === "all" ? "alle-klinikker" : (scope === "chain" ? `kjede-${requestedKlinikkId}` : `klinikk-${requestedKlinikkId}`);
  const path = `${isCron ? "auto" : "manual"}/${scopeFolder}/${dato}/vet-backup-${stamp}.json`;

  try {
    await uploadBackup(service, path, backup, { ...errors, ...Object.fromEntries(Object.entries(skipped).map(([k, v]) => [`skipped:${k}`, v])) });
  } catch (e) {
    return json({ error: "Kunne ikke lagre backup i Storage: " + ((e as Error).message || e) }, 500);
  }

  const sharedClinicPaths: string[] = [];
  // Når SYSADM tar backup av alle klinikker, lager vi også egne klinikk-kopier.
  // Da ser klinikkadmin backupen for sin klinikk i GUI, uten å få tilgang til alle-klinikker-filen.
  if (scope === "all") {
    const clinics = clinicListFromBackup(backup);
    for (const clinic of clinics) {
      const clinicId = idString(clinic?.id);
      if (!clinicId) continue;
      const clinicBackup = filterBackupForClinic({ ...backup, path }, clinicId);
      const clinicPath = `${isCron ? "auto" : "manual"}/klinikk-${clinicId}/${dato}/vet-backup-${stamp}-fra-alle-klinikker.json`;
      try {
        await uploadBackup(service, clinicPath, clinicBackup, errors);
        sharedClinicPaths.push(clinicPath);
      } catch (e) {
        errors[`clinic-copy-${clinicId}`] = String((e as Error).message || e);
      }
    }
  }

  return json({ ok: true, bucket: "vet-backups", path, shared_clinic_paths: sharedClinicPaths, scope, klinikk_id: scope === "clinic" ? requestedKlinikkId : null, table_count: TABLES.length, tables_backed_up: backup.status.tables_backed_up, tables_skipped: backup.status.tables_skipped, errors, skipped, backup: { ...backup, path, errors, skipped } });
});
