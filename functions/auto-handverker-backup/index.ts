import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TABLES = [
  "hand_firma",
  "hand_firma_bruker",
  "hand_ansatt",
  "hand_kunde",
  "hand_prosjekt",
  "hand_time",
  "hand_faktura",
  "hand_faktura_vare",
  "hand_faktura_utlegg",
  "hand_vare",
  "hand_bil",
  "hand_bil_lager",
  "hand_bil_vare",
  "hand_lager_bevegelse",
  "hand_lager_bestilling",
  "hand_bil_bestilling",
  "hand_bilag",
  "hand_tilbud",
  "hand_tilbud_linje",
  "hand_tilbud_vedlegg",
  "hand_fravaer",
  "hand_lonnskjoring",
  "hand_timebank",
  "hand_trekk_type",
  "hand_ansatt_trekk"
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const BACKUP_CRON_SECRET = Deno.env.get("BACKUP_CRON_SECRET") || "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i Edge Function secrets." }, 500);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => ({}));
  const cronSecret = req.headers.get("x-backup-secret") || body?.backup_secret || "";
  const isCron = Boolean(BACKUP_CRON_SECRET && cronSecret === BACKUP_CRON_SECRET);

  if (!isCron) {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || !ANON_KEY) return json({ error: "Mangler innlogging/token." }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    const email = String(userData?.user?.email || "").toLowerCase();

    if (userError || !email) return json({ error: "Kunne ikke verifisere innlogget bruker." }, 401);

    const { data: bruker } = await service
      .from("hand_ansatt")
      .select("rolle, aktiv")
      .ilike("epost", email)
      .eq("aktiv", true)
      .limit(1)
      .maybeSingle();

    const rolle = String(bruker?.rolle || "").toLowerCase();
    const { data: sysadm } = await service.from("hand_sysadm").select("epost, aktiv").ilike("epost", email).eq("aktiv", true).limit(1).maybeSingle();
    const erAdmin = Boolean(sysadm) || ["admin", "administrator", "eier", "firmaadmin", "sysadm", "sysadmin", "systemadmin"].includes(rolle);

    if (!erAdmin) return json({ error: "Kun admin kan ta Supabase-backup." }, 403);
  }

  await service.storage.createBucket("handverker-backups", { public: false }).catch(() => null);

  const backup: Record<string, unknown> = {
   type: "rett-i-lomma-handverker-auto-backup",
    versjon: 1,
    laget: new Date().toISOString(),
    source: isCron ? "automatic" : (body?.source || "manual"),
    tabeller: {},
  };

  const errors: Record<string, string> = {};

  for (const table of TABLES) {
    const { data, error } = await service.from(table).select("*");
    if (error) {
      errors[table] = error.message;
      (backup.tabeller as Record<string, unknown>)[table] = [];
    } else {
      (backup.tabeller as Record<string, unknown>)[table] = data || [];
    }
  }

  const now = new Date();
  const dato = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const path = `${isCron ? "auto" : "manual"}/${dato}/handverker-backup-${stamp}.json`;

  const { error: uploadError } = await service.storage
    .from("handverker-backups")
    .upload(path, JSON.stringify({ ...backup, errors }, null, 2), {
      contentType: "application/json; charset=utf-8",
      upsert: true,
    });

  if (uploadError) return json({ error: "Kunne ikke lagre backup i Storage: " + uploadError.message }, 500);

  return json({
    ok: true,
    bucket: "handverker-backups",
    path,
    table_count: TABLES.length,
    errors,
  });
});
