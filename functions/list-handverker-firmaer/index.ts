import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const token = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!url || !serviceRoleKey || !anonKey || !token) {
    return json({ error: "Mangler Supabase-konfigurasjon eller innlogging." }, 401);
  }

  const service = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const email = String(userData?.user?.email || "").trim().toLowerCase();
  if (userError || !email) return json({ error: "Ugyldig innlogging." }, 401);

  const { data: sysadm, error: sysadmError } = await service
    .from("hand_sysadm")
    .select("id")
    .ilike("epost", email)
    .eq("aktiv", true)
    .limit(1)
    .maybeSingle();

  if (sysadmError) return json({ error: "Kunne ikke kontrollere systemadmin: " + sysadmError.message }, 500);
  if (!sysadm) return json({ error: "Kun systemadmin kan hente alle firma." }, 403);

  const { data: firmaer, error: firmaError } = await service
    .from("hand_firma")
    .select("id,navn,firma_navn,firmanavn")
    .order("navn", { ascending: true });

  if (firmaError) return json({ error: "Kunne ikke hente firma: " + firmaError.message }, 500);

  const rows = (firmaer || [])
    .map((firma: Record<string, unknown>) => ({
      id: String(firma.id || ""),
      navn: String(firma.navn || firma.firma_navn || firma.firmanavn || firma.id || "Firma"),
    }))
    .filter((firma) => firma.id);

  return json({ ok: true, firmaer: rows });
});
