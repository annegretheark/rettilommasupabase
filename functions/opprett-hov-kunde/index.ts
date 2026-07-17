// Supabase Edge Function: opprett-hov-kunde
// Oppretter/oppdaterer firma, sender første invitasjon og kan sende invitasjon på nytt.
// Modi:
//   mode: "opprett"              -> lagre firma + send første invitasjon
//   mode: "send_invite_pa_nytt" -> send ny invitasjon til eksisterende firma
// Krever secrets:
// - SUPABASE_URL eller APP_SUPABASE_URL
// - SERVICE_ROLE_KEY eller SUPABASE_SERVICE_ROLE_KEY eller APP_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function manglendeKolonne(error: unknown): string | null {
  const message = String((error as any)?.message || "");
  const match =
    message.match(/'([^']+)' column/) ||
    message.match(/column "([^"]+)"/i) ||
    message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
}

async function finnAuthBruker(admin: any, email: string): Promise<any | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const users = data?.users || [];
    const user = users.find(
      (item: any) => String(item?.email || "").toLowerCase() === email.toLowerCase(),
    );

    if (user) return user;
    if (users.length < 100) break;
  }
  return null;
}

async function finnFirma(admin: any, firmaId: string, epost: string, linknavn: string) {
  if (firmaId) {
    const { data, error } = await admin
      .from("hov_firma")
      .select("*")
      .eq("id", firmaId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const filters: string[] = [];
  if (epost) filters.push(`epost.ilike.${epost}`);
  if (linknavn) filters.push(`linknavn.eq.${linknavn}`);
  if (!filters.length) return null;

  const { data, error } = await admin
    .from("hov_firma")
    .select("*")
    .or(filters.join(","))
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function lagreFirma(
  admin: any,
  eksisterendeFirma: any,
  values: { navn: string; epost: string; linknavn: string; authUserId?: string | null },
) {
  let payload: Record<string, unknown> = {
    navn: values.navn,
    epost: values.epost,
    linknavn: values.linknavn,
    rolle: "admin",
    er_admin: true,
  };

  if (values.authUserId !== undefined) {
    payload.auth_user_id = values.authUserId;
  }

  for (let forsok = 0; forsok < 10; forsok++) {
    const query = eksisterendeFirma?.id
      ? admin.from("hov_firma").update(payload).eq("id", eksisterendeFirma.id)
      : admin.from("hov_firma").insert([payload]);

    const { data, error } = await query.select("*").maybeSingle();
    if (!error) return data;

    const kolonne = manglendeKolonne(error);
    if (!kolonne || !Object.prototype.hasOwnProperty.call(payload, kolonne)) throw error;
    delete payload[kolonne];
  }

  throw new Error("Kunne ikke lagre hov_firma.");
}

async function oppdaterFirmaAuthId(admin: any, firmaId: string, authUserId: string | null) {
  if (!firmaId || !authUserId) return;

  let payload: Record<string, unknown> = { auth_user_id: authUserId };
  for (let forsok = 0; forsok < 3; forsok++) {
    const { error } = await admin.from("hov_firma").update(payload).eq("id", firmaId);
    if (!error) return;

    const kolonne = manglendeKolonne(error);
    if (!kolonne || !Object.prototype.hasOwnProperty.call(payload, kolonne)) throw error;
    delete payload[kolonne];
    if (!Object.keys(payload).length) return;
  }
}

async function lagreProfil(
  admin: any,
  values: { authUserId: string; firmaId: string; epost: string; navn: string },
) {
  // Ulike installasjoner kan ha litt forskjellige kolonnenavn. Vi prøver de vanligste.
  let payload: Record<string, unknown> = {
    auth_user_id: values.authUserId,
    firma_id: values.firmaId,
    epost: values.epost,
    navn: values.navn,
    rolle: "hovslager",
  };

  for (let forsok = 0; forsok < 10; forsok++) {
    const { error } = await admin
      .from("hov_profiles")
      .upsert(payload, { onConflict: "auth_user_id" });

    if (!error) return;

    // Hvis auth_user_id ikke er konfliktkolonne i denne installasjonen, prøv vanlig lookup/update.
    const message = String(error.message || "").toLowerCase();
    if (message.includes("on conflict") || message.includes("unique") || message.includes("constraint")) {
      const { data: eksisterende, error: lookupError } = await admin
        .from("hov_profiles")
        .select("*")
        .eq("epost", values.epost)
        .limit(1)
        .maybeSingle();

      if (!lookupError && eksisterende?.id) {
        const { error: updateError } = await admin
          .from("hov_profiles")
          .update(payload)
          .eq("id", eksisterende.id);
        if (!updateError) return;
      }
    }

    const kolonne = manglendeKolonne(error);
    if (!kolonne || !Object.prototype.hasOwnProperty.call(payload, kolonne)) {
      console.warn("Kunne ikke lagre hov_profiles:", error.message);
      return;
    }
    delete payload[kolonne];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Bruk POST." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("APP_SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("APP_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, error: "Mangler Supabase URL eller service-role key." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "opprett").trim().toLowerCase();
    const firmaId = String(body.firma_id || body.firmaId || "").trim();
    const navn = String(body.navn || body.firmanavn || "").trim();
    const epost = String(body.epost || body.email || "").trim().toLowerCase();
    const redirectTo = String(body.redirect_to || body.redirectTo || "").trim();
    const requestedLinknavn = String(body.linknavn || body.slug || "").trim();

    if (!epost) return json({ ok: false, error: "Mangler e-post." }, 400);
    if (!["opprett", "send_invite_pa_nytt"].includes(mode)) {
      return json({ ok: false, error: `Ukjent mode: ${mode}` }, 400);
    }

    const forelopigLinknavn = slugify(requestedLinknavn || navn || epost.split("@")[0] || "kunde");
    let eksisterendeFirma = await finnFirma(admin, firmaId, epost, forelopigLinknavn);

    if (mode === "send_invite_pa_nytt" && !eksisterendeFirma) {
      return json({
        ok: false,
        error: "Fant ikke firmaet. Lagre firmaet før du sender invitasjonen på nytt.",
      }, 404);
    }

    const faktiskNavn = navn || eksisterendeFirma?.navn || "HOVslager-bruker";
    const faktiskLinknavn = slugify(
      requestedLinknavn || eksisterendeFirma?.linknavn || faktiskNavn || epost.split("@")[0],
    );

    // Ved vanlig opprettelse lagres firmaet først. Da kan firma-ID legges i Auth-metadata.
    let lagretFirma = eksisterendeFirma;
    if (mode === "opprett") {
      if (!navn && !eksisterendeFirma?.navn) {
        return json({ ok: false, error: "Mangler navn/firmanavn." }, 400);
      }
      lagretFirma = await lagreFirma(admin, eksisterendeFirma, {
        navn: faktiskNavn,
        epost,
        linknavn: faktiskLinknavn,
      });
      eksisterendeFirma = lagretFirma;
    }

    let authUser = await finnAuthBruker(admin, epost);
    let slettetUaktivertBruker = false;

    if (mode === "send_invite_pa_nytt" && authUser) {
      const erAktivert = Boolean(authUser.email_confirmed_at || authUser.confirmed_at);
      if (erAktivert) {
        const { error: recoveryError } = await admin.auth.resetPasswordForEmail(
          epost,
          redirectTo ? { redirectTo } : undefined,
        );
        if (recoveryError) throw recoveryError;
        return json({
          ok: true,
          bruker_aktivert: true,
          recovery_sendt: true,
          auth_user_id: authUser.id,
          firma_id: eksisterendeFirma?.id || null,
          melding: "Brukeren finnes allerede. E-post for gjenoppretting av passord er sendt.",
        });
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(authUser.id);
      if (deleteError) throw deleteError;
      slettetUaktivertBruker = true;
      authUser = null;
    }

    let invitasjonSendt = false;
    let authUserId: string | null = authUser?.id || null;

    if (!authUser) {
      const options: Record<string, unknown> = {
        data: {
          navn: faktiskNavn,
          app: "hovslager",
          linknavn: faktiskLinknavn,
          firma_id: eksisterendeFirma?.id || null,
          rolle: "hovslager",
        },
      };
      if (redirectTo) options.redirectTo = redirectTo;

      const { data, error } = await admin.auth.admin.inviteUserByEmail(epost, options as any);

      console.log("inviteUserByEmail", {
        mode,
        epost,
        firmaId: eksisterendeFirma?.id || null,
        redirectTo: redirectTo || null,
        userId: data?.user?.id || null,
        error: error?.message || null,
      });

      if (error) {
        const { error: recoveryError } = await admin.auth.resetPasswordForEmail(
          epost,
          redirectTo ? { redirectTo } : undefined,
        );
        if (recoveryError) throw error;
        return json({
          ok: true,
          recovery_sendt: true,
          firma_id: eksisterendeFirma?.id || null,
          melding: "Invitasjon kunne ikke brukes. E-post for gjenoppretting av passord er sendt.",
        });
      }
      authUserId = data?.user?.id || null;
      invitasjonSendt = true;
    }

    if (!eksisterendeFirma?.id) {
      throw new Error("Firmaet mangler etter lagring.");
    }

    await oppdaterFirmaAuthId(admin, eksisterendeFirma.id, authUserId);

    if (authUserId) {
      await lagreProfil(admin, {
        authUserId,
        firmaId: eksisterendeFirma.id,
        epost,
        navn: faktiskNavn,
      });
    }

    // Hent oppdatert firma for korrekt retur.
    const { data: oppdatertFirma } = await admin
      .from("hov_firma")
      .select("*")
      .eq("id", eksisterendeFirma.id)
      .maybeSingle();

    const firma = oppdatertFirma || eksisterendeFirma;

    return json({
      ok: true,
      mode,
      melding: mode === "send_invite_pa_nytt"
        ? "Ny invitasjon er sendt på e-post."
        : invitasjonSendt
        ? "Firmaet er lagret og invitasjonen er sendt på e-post."
        : "Firmaet er lagret. Brukeren finnes allerede i Auth, så ny invitasjon ble ikke sendt.",
      invitasjon_sendt: invitasjonSendt,
      slettet_uaktivert_bruker: slettetUaktivertBruker,
      auth_bruker_eksisterte: Boolean(authUser),
      auth_user_id: authUserId,
      firma_id: firma.id,
      firma,
      linknavn: firma.linknavn || faktiskLinknavn,
      kundelink: `/hovslager/?firma=${encodeURIComponent(firma.linknavn || faktiskLinknavn)}`,
    });
  } catch (error) {
    console.error("opprett-hov-kunde feil:", error);
    return json({
      ok: false,
      error: String((error as any)?.message || error),
    }, 500);
  }
});
