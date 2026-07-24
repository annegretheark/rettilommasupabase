import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

async function findAuthUser(admin: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => norm(user.email) === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: "Passordtjenesten mangler Supabase-oppsett." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const email = norm(body.email || body.epost);
    const redirectTo = String(body.redirect_to || body.redirectTo || "").trim();
    if (!email || !email.includes("@")) return json({ error: "Ugyldig e-postadresse." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const publicAuth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: appRows, error: appError } = await admin
      .from("vet_klinikk_brukere")
      .select("id, navn, epost, rolle, aktiv, klinikk_id, auth_user_id")
      .eq("epost", email)
      .eq("aktiv", true)
      .limit(1);
    if (appError) throw appError;

    // Returner samme svar når adressen ikke finnes. Dette hindrer e-postkartlegging.
    const appUser = appRows?.[0] || null;
    if (!appUser) return json({ ok: true });

    let authUser: User | null = null;
    if (appUser.auth_user_id) {
      const { data } = await admin.auth.admin.getUserById(appUser.auth_user_id);
      authUser = data?.user || null;
    }
    if (!authUser) authUser = await findAuthUser(admin, email);

    if (authUser) {
      if (!appUser.auth_user_id || String(appUser.auth_user_id) !== String(authUser.id)) {
        const linkResult = await admin
          .from("vet_klinikk_brukere")
          .update({ auth_user_id: authUser.id })
          .eq("id", appUser.id);
        if (linkResult.error) throw linkResult.error;
      }

      const options = redirectTo ? { redirectTo } : undefined;
      const { error } = await publicAuth.auth.resetPasswordForEmail(email, options);
      if (error) throw error;
      return json({ ok: true });
    }

    // Eldre appbrukere kan mangle Auth-bruker. Opprett den via invitasjon slik at
    // brukeren får samme passordside og kan velge eget passord.
    const inviteOptions: { data: Record<string, unknown>; redirectTo?: string } = {
      data: {
        navn: appUser.navn || "",
        rolle: appUser.rolle || "veterinaer",
        klinikk_id: appUser.klinikk_id,
        invitert: true,
        onboarding_required: true,
        passord_opprettet: false,
      },
    };
    if (redirectTo) inviteOptions.redirectTo = redirectTo;

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, inviteOptions);
    if (inviteError) throw inviteError;
    if (invited.user?.id) {
      const linkResult = await admin
        .from("vet_klinikk_brukere")
        .update({ auth_user_id: invited.user.id })
        .eq("id", appUser.id);
      if (linkResult.error) throw linkResult.error;
    }

    return json({ ok: true });
  } catch (error) {
    console.error("vet-glemt-passord feilet", error);
    return json({ error: "Passordlenken kunne ikke sendes akkurat nå. Prøv igjen senere eller kontakt administrator." }, 400);
  }
});

