// supabase/functions/opprett-vet-bruker/index.ts
// Felles flyt for klinikkadmin og vanlig bruker:
// - Ny bruker + invitasjon: inviteUserByEmail
// - Eksisterende bruker + invitasjon: resetPasswordForEmail
// - Uten invitasjon: createUser med midlertidig passord

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  return ["1", "true", "ja", "yes", "on"].includes(value.trim().toLowerCase());
}

async function findUserByEmail(adminClient: SupabaseClient, email: string): Promise<User | null> {
  const perPage = 200;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  throw new Error("Brukersøket ble for stort. Begrens søket eller bruk en egen brukerindeks.");
}

function invitationText(role: string, clinicName: string): string {
  return role === "admin"
    ? `Du er invitert som admin av ${clinicName}.`
    : `Du er invitert som bruker hos ${clinicName}.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Kun POST er støttet." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: "Edge Function mangler Supabase-miljøvariabler." }, 500);
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Mangler innlogging." }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const publicAuthClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !callerData?.user?.email) {
      return jsonResponse({ error: "Kunne ikke bekrefte innlogget bruker." }, 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Ugyldig forespørsel." }, 400);
    }

    const callerEmail = callerData.user.email.toLowerCase();
    const navn = String(body.navn || "").trim();
    const epost = String(body.epost || body.email || "").trim().toLowerCase();
    const passord = String(body.passord || body.password || "");
    const rolle = String(body.rolle || body.role || "veterinaer").trim().toLowerCase();
    const klinikkId = String(body.klinikk_id || body.klinikkId || body.clinic_id || "").trim();
    const sendInvitasjon = asBoolean(
      body.send_invitasjon ?? body.sendInvite ?? body.send_invite ?? body.invitasjon ?? body.invite ?? body.inviter,
    );

    const redirectTo = String(
      body.redirect_to || body.redirectTo || Deno.env.get("INVITE_REDIRECT_URL") || "",
    ).trim();

    if (!epost || !klinikkId) {
      return jsonResponse({ error: "Mangler e-post eller klinikk." }, 400);
    }

    if (!["veterinaer", "admin"].includes(rolle)) {
      return jsonResponse({ error: "Ugyldig rolle." }, 400);
    }

    if (!sendInvitasjon && passord.length < 6) {
      return jsonResponse({ error: "Passord må være minst 6 tegn når invitasjon ikke er valgt." }, 400);
    }

    const erSystemAdmin = callerEmail === "greknuts@online.no";

    if (!erSystemAdmin) {
      const { data: tilgang, error: tilgangError } = await adminClient
        .from("vet_klinikk_brukere")
        .select("klinikk_id, rolle, aktiv")
        .eq("epost", callerEmail)
        .eq("klinikk_id", klinikkId)
        .eq("aktiv", true)
        .maybeSingle();

      if (tilgangError || !tilgang) {
        return jsonResponse({ error: "Du er ikke koblet til valgt klinikk." }, 403);
      }
      if (String(tilgang.rolle).toLowerCase() !== "admin") {
        return jsonResponse({ error: "Kun klinikkadmin kan opprette eller invitere brukere." }, 403);
      }
    }

    // Hent klinikknavn. Feltet kan variere mellom eldre databaseversjoner.
    let klinikkNavn = String(body.klinikk_navn || body.klinikkNavn || body.clinic_name || "").trim();
    if (!klinikkNavn) {
      const { data: clinic } = await adminClient
        .from("vet_klinikker")
        .select("*")
        .eq("id", klinikkId)
        .maybeSingle();

      klinikkNavn = String(
        clinic?.navn || clinic?.klinikk_navn || clinic?.name || "klinikken",
      ).trim();
    }

    const invitasjonstekst = invitationText(rolle, klinikkNavn || "klinikken");
    const invitationMetadata = {
      navn,
      rolle,
      klinikk_id: klinikkId,
      klinikk_navn: klinikkNavn,
      invitasjonstekst,
      invitert: true,
      onboarding_required: true,
      passord_opprettet: false,
    };

    const passwordMetadata = {
      navn,
      rolle,
      klinikk_id: klinikkId,
      klinikk_navn: klinikkNavn,
      invitasjonstekst,
      invitert: false,
      onboarding_required: false,
      passord_opprettet: true,
    };

    let existingUser = await findUserByEmail(adminClient, epost);
    let authUserId: string | null = existingUser?.id || null;
    let handling: "invite" | "password_reset" | "created_with_password";

    if (sendInvitasjon) {
      if (existingUser) {
        // Oppdater metadata før passord-e-posten sendes, slik at malen kan bruke Data.invitasjonstekst.
        const { error: updateError } = await adminClient.auth.admin.updateUserById(existingUser.id, {
          user_metadata: { ...(existingUser.user_metadata || {}), ...invitationMetadata },
        });
        if (updateError) {
          return jsonResponse({ error: "Kunne ikke oppdatere eksisterende bruker: " + updateError.message }, 400);
        }

        const resetOptions = redirectTo ? { redirectTo } : undefined;
        const { error: resetError } = await publicAuthClient.auth.resetPasswordForEmail(epost, resetOptions);
        if (resetError) {
          return jsonResponse({ error: "Kunne ikke sende e-post for passordbytte: " + resetError.message }, 400);
        }
        handling = "password_reset";
      } else {
        const inviteOptions: { data: Record<string, unknown>; redirectTo?: string } = { data: invitationMetadata };
        if (redirectTo) inviteOptions.redirectTo = redirectTo;

        const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
          epost,
          inviteOptions,
        );
        if (inviteError) {
          return jsonResponse({ error: "Kunne ikke sende invitasjon: " + inviteError.message }, 400);
        }
        authUserId = invited.user?.id || null;
        existingUser = invited.user || null;
        handling = "invite";
      }
    } else {
      if (existingUser) {
        return jsonResponse({
          error: "E-postadressen er allerede registrert. Velg Send invitasjon for å sende passordbytte.",
        }, 409);
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: epost,
        password: passord,
        email_confirm: true,
        user_metadata: passwordMetadata,
      });
      if (createError) {
        return jsonResponse({ error: "Kunne ikke opprette Auth-bruker: " + createError.message }, 400);
      }
      authUserId = created.user?.id || null;
      handling = "created_with_password";
    }

    const { error: linkError } = await adminClient
      .from("vet_klinikk_brukere")
      .upsert({
        epost,
        navn,
        auth_user_id: authUserId,
        klinikk_id: klinikkId,
        rolle,
        aktiv: true,
      }, { onConflict: "epost" });

    if (linkError) {
      return jsonResponse({
        error: "E-posthandlingen ble utført, men brukeren kunne ikke kobles til klinikken: " + linkError.message,
      }, 400);
    }

    return jsonResponse({
      ok: true,
      handling,
      epost,
      rolle,
      klinikk_id: klinikkId,
      klinikk_navn: klinikkNavn,
      melding: handling === "invite"
        ? "Invitasjon er sendt."
        : handling === "password_reset"
        ? "E-post for passordbytte er sendt."
        : "Brukeren er opprettet med passord.",
    });
  } catch (error) {
    console.error("opprett-vet-bruker feilet", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "Uventet feil: " + message }, 500);
  }
});
