import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Foreldre før barn. Listen dekker alle firmadata som brukes av appen.
const TABLES = [
  "hand_firma", "hand_firma_bruker", "hand_ansatt", "hand_kunde", "hand_kunde_moduler",
  "hand_prosjekt", "hand_vare", "hand_bil", "hand_bil_lager", "hand_bil_vare",
  "hand_time", "hand_time_bilde", "hand_faktura", "hand_faktura_vare", "hand_faktura_utlegg",
  "hand_tilbud", "hand_tilbud_linje", "hand_tilbud_vedlegg", "hand_bilag", "hand_fravaer",
  "hand_lonnskjoring", "hand_timebank", "hand_trekk_type", "hand_ansatt_trekk",
  "hand_lager_bevegelse", "hand_lagerlogg", "hand_lager_bestilling", "hand_bil_bestilling",
  "hand_arbeidsordre", "hand_arbeidsordre_tildeling", "hand_innkjopsvarsel", "hand_moduler"
] as const;

// Brukes når en undertabell ikke har firma_id selv.
const RELATIONS: Record<string, Array<[string, string]>> = {
  hand_time_bilde: [["time_id", "hand_time"]],
  hand_faktura_vare: [["faktura_id", "hand_faktura"]],
  hand_faktura_utlegg: [["faktura_id", "hand_faktura"]],
  hand_tilbud_linje: [["tilbud_id", "hand_tilbud"]],
  hand_tilbud_vedlegg: [["tilbud_id", "hand_tilbud"]],
  hand_ansatt_trekk: [["ansatt_id", "hand_ansatt"], ["trekk_type_id", "hand_trekk_type"]],
  hand_arbeidsordre_tildeling: [["arbeidsordre_id", "hand_arbeidsordre"]],
  hand_bil_vare: [["bil_id", "hand_bil"], ["vare_id", "hand_vare"]],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safePart(v: string) {
  return v.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

function filterFirma(all: Record<string, any[]>, firmaId: string) {
  const selected: Record<string, any[]> = {};
  const ids: Record<string, Set<string>> = {};

  for (const table of TABLES) {
    const rows = all[table] || [];
    let picked = rows.filter((row) => {
      if (table === "hand_firma") return String(row?.id || "") === firmaId;
      if (String(row?.firma_id || "") === firmaId) return true;
      return (RELATIONS[table] || []).some(([fk, parent]) => ids[parent]?.has(String(row?.[fk] || "")));
    });

    // Globale moduldefinisjoner tas bare med dersom de er knyttet til firmaet via firma_id.
    if (table === "hand_moduler" && !picked.length) picked = [];
    selected[table] = picked;
    ids[table] = new Set(picked.map((row) => String(row?.id || "")).filter(Boolean));
  }
  return selected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const cronSecretExpected = Deno.env.get("BACKUP_CRON_SECRET") || "";
  if (!url || !serviceKey) return json({ error: "Mangler Supabase-konfigurasjon." }, 500);

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const cronSecret = req.headers.get("x-backup-secret") || body?.backup_secret || "";
  const isCron = Boolean(cronSecretExpected && cronSecret === cronSecretExpected);

  let isSys = isCron;
  let ownFirmaId = "";
  let email = "cron";
  let role = isCron ? "system" : "";

  if (!isCron) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token || !anonKey) return json({ error: "Mangler innlogging/token." }, 401);
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    email = String(userData?.user?.email || "").toLowerCase();
    if (userError || !email) return json({ error: "Kunne ikke verifisere innlogget bruker." }, 401);

    const { data: employee } = await service.from("hand_ansatt").select("rolle,aktiv,firma_id").ilike("epost", email).eq("aktiv", true).limit(1).maybeSingle();
    const { data: sysadm } = await service.from("hand_sysadm").select("id").ilike("epost", email).eq("aktiv", true).limit(1).maybeSingle();
    role = String(employee?.rolle || "").toLowerCase();
    isSys = Boolean(sysadm) || ["sysadm", "sysadmin", "systemadmin"].includes(role);
    const isAdmin = isSys || ["admin", "administrator", "eier", "firmaadmin"].includes(role);
    if (!isAdmin) return json({ error: "Kun admin eller sysadmin kan ta backup." }, 403);
    ownFirmaId = String(employee?.firma_id || "");
  }

  let requestedFirmaId = String(body?.firma_id || "");
  const wantsAll = isCron || body?.scope === "all" || requestedFirmaId === "__alle__" || (!requestedFirmaId && isSys);
  if (!isSys) {
    if (!ownFirmaId) return json({ error: "Fant ikke firma for innlogget administrator." }, 403);
    if (requestedFirmaId && requestedFirmaId !== ownFirmaId) return json({ error: "Du kan bare ta backup av eget firma." }, 403);
    requestedFirmaId = ownFirmaId;
  } else if (wantsAll) {
    requestedFirmaId = "";
  }

  await service.storage.createBucket("handverker-backups", { public: false }).catch(() => null);

  const allRows: Record<string, any[]> = {};
  const errors: Record<string, string> = {};
  for (const table of TABLES) {
    const { data, error } = await service.from(table).select("*");
    if (error) {
      errors[table] = error.message;
      allRows[table] = [];
    } else {
      allRows[table] = data || [];
    }
  }

  const tables = requestedFirmaId ? filterFirma(allRows, requestedFirmaId) : allRows;
  const backup = {
    type: "rett-i-lomma-handverker-backup",
    versjon: 3,
    laget: new Date().toISOString(),
    source: isCron ? "automatic" : (body?.source || "manual"),
    scope: requestedFirmaId ? "firma" : "all",
    firma_id: requestedFirmaId || null,
    created_by: email,
    role,
    tabeller: tables,
    errors,
  };

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const scopePart = requestedFirmaId ? `firma-${safePart(requestedFirmaId)}-` : "alle-";
  const path = `${isCron ? "auto" : "manual"}/${date}/handverker-backup-${scopePart}${stamp}.json`;
  const { error: uploadError } = await service.storage.from("handverker-backups").upload(path, JSON.stringify(backup, null, 2), {
    contentType: "application/json; charset=utf-8",
    upsert: false,
  });
  if (uploadError) return json({ error: "Kunne ikke lagre backup i Storage: " + uploadError.message }, 500);

  const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
  return json({ ok: true, bucket: "handverker-backups", path, scope: backup.scope, firma_id: backup.firma_id, table_count: TABLES.length, row_count: rowCount, errors });
});
