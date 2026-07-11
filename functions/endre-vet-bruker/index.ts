import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function norm(v: unknown) { return String(v || "").trim().toLowerCase(); }

function lagMidlertidigPassord() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%&";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}


async function finnAuthUser(adminClient: any, eposter: string[]) {
  const targets = new Set(eposter.map(norm).filter(Boolean));
  if (!targets.size) return null;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of (data?.users || [])) {
      if (targets.has(norm(u.email))) return u;
    }
    if ((data?.users || []).length < 1000) break;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Mangler SUPABASE_URL, SUPABASE_ANON_KEY eller SUPABASE_SERVICE_ROLE_KEY i function secrets." }, 500);
    }

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Mangler innlogging." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: callerData, error: callerError } = await userClient.auth.getUser(token);
    if (callerError || !callerData?.user?.email) return json({ error: "Ugyldig innlogging." }, 401);

    const body = await req.json().catch(() => ({}));
    const bruker_id = String(body.bruker_id || "").trim();
    const navn = String(body.navn || "").trim() || null;
    const epost = norm(body.epost);
    const gammel_epost_fra_klient = norm(body.gammel_epost);
    const rolle = norm(body.rolle || "veterinaer");
    const aktiv = body.aktiv !== false;

    if (!bruker_id) return json({ error: "Mangler bruker_id." }, 400);
    if (!epost) return json({ error: "E-post kan ikke være tom." }, 400);
    if (!["veterinaer", "admin", "systemadmin"].includes(rolle)) return json({ error: "Ugyldig rolle." }, 400);

    const { data: rad, error: radError } = await adminClient
      .from("vet_klinikk_brukere")
      .select("id, klinikk_id, epost, auth_user_id")
      .eq("id", bruker_id)
      .maybeSingle();
    if (radError) throw radError;
    if (!rad) return json({ error: "Fant ikke brukeren." }, 404);

    const callerEmail = norm(callerData.user.email);
    const { data: callerRows, error: callerRowsError } = await adminClient
      .from("vet_klinikk_brukere")
      .select("rolle, aktiv, klinikk_id")
      .eq("epost", callerEmail);
    if (callerRowsError) throw callerRowsError;

    const erSystemadmin = callerEmail === "greknuts@online.no" || callerRows?.some((r: any) => r.rolle === "systemadmin" && r.aktiv !== false);
    const erKlinikkAdmin = callerRows?.some((r: any) => String(r.klinikk_id) === String(rad.klinikk_id) && ["admin", "systemadmin"].includes(String(r.rolle)) && r.aktiv !== false);
    if (!erSystemadmin && !erKlinikkAdmin) return json({ error: "Kun admin kan redigere brukere." }, 403);

    const { data: epostFinnes, error: epostError } = await adminClient
      .from("vet_klinikk_brukere")
      .select("id, navn")
      .eq("epost", epost)
      .neq("id", bruker_id)
      .maybeSingle();
    if (epostError) throw epostError;
    if (epostFinnes) return json({ error: `E-post er allerede brukt av en annen bruker${epostFinnes.navn ? " (" + epostFinnes.navn + ")" : ""}.` }, 409);

    const gammelEpost = norm(rad.epost);
    let authUserId = rad.auth_user_id || null;
    let authFør = null;
    let authEtter = null;
    let auth_epost_endret = false;
    let auth_koblet = false;
    let auth_advarsel: string | null = null;

    if (authUserId) {
      const { data, error } = await adminClient.auth.admin.getUserById(authUserId);
      if (error) throw error;
      authFør = norm(data?.user?.email);
    } else {
      const funnet = await finnAuthUser(adminClient, [gammelEpost, gammel_epost_fra_klient, epost]);
      if (funnet?.id) {
        authUserId = funnet.id;
        authFør = norm(funnet.email);
        auth_koblet = true;
      }
    }

    if (authUserId && authFør !== epost) {
      const { error: authError } = await adminClient.auth.admin.updateUserById(authUserId, {
        email: epost,
        email_confirm: true,
        user_metadata: { navn },
      });
      if (authError) throw authError;

      const { data: kontroll, error: kontrollError } = await adminClient.auth.admin.getUserById(authUserId);
      if (kontrollError) throw kontrollError;
      authEtter = norm(kontroll?.user?.email);
      auth_epost_endret = authEtter === epost;
      if (!auth_epost_endret) {
        auth_advarsel = `Auth svarte OK, men kontroll viste fortsatt ${authEtter || "tom e-post"}. Sjekk Supabase Auth manuelt.`;
      }
    } else if (authUserId) {
      authEtter = authFør;
      auth_epost_endret = authFør === epost;
    } else {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: epost,
        password: lagMidlertidigPassord(),
        email_confirm: true,
        user_metadata: { navn, rolle, klinikk_id: rad.klinikk_id },
      });
      if (createError) throw createError;
      authUserId = created?.user?.id || null;
      authFør = null;
      authEtter = norm(created?.user?.email);
      auth_koblet = Boolean(authUserId);
      auth_epost_endret = authEtter === epost;
      auth_advarsel = authUserId
        ? "Fant ingen eksisterende Auth-bruker, så ny Auth-bruker ble opprettet og koblet. Brukeren må bruke Glemt passord / passordlenke før innlogging."
        : "Forsøkte å opprette Auth-bruker, men fikk ikke auth_user_id tilbake fra Supabase.";
    }

    const updateData: Record<string, unknown> = { navn, epost, rolle, aktiv };
    if (authUserId && !rad.auth_user_id) updateData.auth_user_id = authUserId;
    const { error: updateError } = await adminClient.from("vet_klinikk_brukere").update(updateData).eq("id", bruker_id);
    if (updateError) throw updateError;

    return json({ ok: true, auth_epost_endret, auth_koblet, auth_advarsel, auth_for: authFør, auth_etter: authEtter });
  } catch (e) {
    return json({ error: String(e?.message || e || "Ukjent feil") }, 400);
  }
});
