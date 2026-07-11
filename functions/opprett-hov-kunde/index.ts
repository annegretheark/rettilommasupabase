// Supabase Edge Function: opprett-hov-kunde
// Idempotent versjon: feiler ikke hvis Auth-bruker eller hov_firma allerede finnes.
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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function slugify(v: string) {
  return String(v || "")
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

function fjernManglendeKolonne(payload: Record<string, unknown>, error: unknown) {
  const msg = String((error as any)?.message || "");
  const treff =
    msg.match(/'([^']+)' column/) ||
    msg.match(/column "([^"]+)"/i) ||
    msg.match(/Could not find the '([^']+)' column/i);

  if (treff?.[1] && Object.prototype.hasOwnProperty.call(payload, treff[1])) {
    delete payload[treff[1]];
    return true;
  }
  return false;
}

async function finnAuthUserId(admin: any, email: string): Promise<string | null> {
  // Supabase Admin API har ikke alltid direkte lookup-by-email i alle miljøer.
  // Vi lister i små sider og leter etter e-post.
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 100,
      });

      if (error) {
        console.warn("Kunne ikke liste Auth-brukere:", error.message);
        return null;
      }

      const users = data?.users || [];
      const funnet = users.find((u: any) =>
        String(u?.email || "").toLowerCase() === email.toLowerCase()
      );

      if (funnet?.id) return funnet.id;
      if (users.length < 100) break;
    }
  } catch (e) {
    console.warn("Auth lookup hoppet over:", e);
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Bruk POST." }, 405);
  }

  try {
    const SUPABASE_URL =
      Deno.env.get("SUPABASE_URL") ||
      Deno.env.get("APP_SUPABASE_URL");

    const SERVICE_ROLE_KEY =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("APP_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({
        ok: false,
        error: "Mangler SUPABASE_URL/APP_SUPABASE_URL eller SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY/APP_SERVICE_ROLE_KEY.",
      }, 500);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await req.json().catch(() => ({}));

    const navn = String(body.navn || body.firmanavn || "").trim();
    const epost = String(body.epost || body.email || "").trim().toLowerCase();
    const passord = String(body.passord || body.password || "").trim();
    const linknavn = slugify(String(body.linknavn || body.slug || navn || epost.split("@")[0] || "kunde"));

    if (!navn) {
      return json({ ok: false, error: "Mangler navn/firmanavn." }, 400);
    }

    if (!epost) {
      return json({ ok: false, error: "Mangler e-post." }, 400);
    }

    if (!passord || passord.length < 6) {
      return json({ ok: false, error: "Mangler passord, eller passordet er kortere enn 6 tegn." }, 400);
    }

    // 1. Sjekk om firma allerede finnes på e-post eller linknavn.
    const { data: eksisterendeFirma, error: firmaLookupError } = await supabaseAdmin
      .from("hov_firma")
      .select("*")
      .or(`epost.ilike.${epost},linknavn.eq.${linknavn}`)
      .limit(1)
      .maybeSingle();

    if (firmaLookupError) {
      throw firmaLookupError;
    }

    let authUserId: string | null = null;
    let authEksisterte = false;
    let firmaEksisterte = !!eksisterendeFirma;

    // 2. Opprett Auth-bruker, men ikke feil hvis den finnes.
    const opprettAuth = await supabaseAdmin.auth.admin.createUser({
      email: epost,
      password: passord,
      email_confirm: true,
      user_metadata: {
        navn,
        app: "hovslager",
        linknavn,
      },
    });

    if (opprettAuth.error) {
      const msg = String(opprettAuth.error.message || "").toLowerCase();

      if (
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exists") ||
        msg.includes("user already")
      ) {
        authEksisterte = true;
        authUserId = await finnAuthUserId(supabaseAdmin, epost);
      } else {
        throw opprettAuth.error;
      }
    } else {
      authUserId = opprettAuth.data?.user?.id || null;
    }

    // 3. Hvis firma finnes, oppdater manglende auth_user_id/linknavn hvis mulig, returner OK.
    if (eksisterendeFirma?.id) {
      let payload: Record<string, unknown> = {
        navn: eksisterendeFirma.navn || navn,
        epost: eksisterendeFirma.epost || epost,
        linknavn: eksisterendeFirma.linknavn || linknavn,
        auth_user_id: eksisterendeFirma.auth_user_id || authUserId,
        rolle: eksisterendeFirma.rolle || "admin",
        er_admin: eksisterendeFirma.er_admin ?? true,
      };

      let oppdatertFirma = eksisterendeFirma;

      for (let forsok = 0; forsok < 8; forsok++) {
        const { data, error } = await supabaseAdmin
          .from("hov_firma")
          .update(payload)
          .eq("id", eksisterendeFirma.id)
          .select("*")
          .maybeSingle();

        if (!error) {
          oppdatertFirma = data || eksisterendeFirma;
          break;
        }

        if (!fjernManglendeKolonne(payload, error)) {
          console.warn("Kunne ikke oppdatere eksisterende firma:", error.message);
          break;
        }
      }

      return json({
        ok: true,
        eksisterer: true,
        melding: "Hovslagerkunde finnes allerede. Returnerer eksisterende firma.",
        firma_id: oppdatertFirma.id,
        firma: oppdatertFirma,
        auth_user_id: authUserId || oppdatertFirma.auth_user_id || null,
        auth_eksisterte: authEksisterte,
        firma_eksisterte: firmaEksisterte,
        linknavn: oppdatertFirma.linknavn || linknavn,
        kundelink: `/hovslager/?firma=${encodeURIComponent(oppdatertFirma.linknavn || linknavn)}`,
      });
    }

    // 4. Opprett nytt firma.
    let payload: Record<string, unknown> = {
      navn,
      epost,
      linknavn,
      auth_user_id: authUserId,
      rolle: "admin",
      er_admin: true,
    };

    let nyFirma: any = null;

    for (let forsok = 0; forsok < 8; forsok++) {
      const { data, error } = await supabaseAdmin
        .from("hov_firma")
        .insert([payload])
        .select("*")
        .maybeSingle();

      if (!error) {
        nyFirma = data;
        break;
      }

      // Hvis unik-konflikt skjer mellom lookup og insert, hent eksisterende og returner OK.
      const msg = String(error.message || "").toLowerCase();
      const code = String((error as any).code || "");
      if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
        const { data: firmaEtterKonflikt } = await supabaseAdmin
          .from("hov_firma")
          .select("*")
          .or(`epost.ilike.${epost},linknavn.eq.${linknavn}`)
          .limit(1)
          .maybeSingle();

        if (firmaEtterKonflikt?.id) {
          return json({
            ok: true,
            eksisterer: true,
            melding: "Hovslagerkunde fantes allerede ved lagring. Returnerer eksisterende firma.",
            firma_id: firmaEtterKonflikt.id,
            firma: firmaEtterKonflikt,
            auth_user_id: authUserId || firmaEtterKonflikt.auth_user_id || null,
            auth_eksisterte: authEksisterte,
            firma_eksisterte: true,
            linknavn: firmaEtterKonflikt.linknavn || linknavn,
            kundelink: `/hovslager/?firma=${encodeURIComponent(firmaEtterKonflikt.linknavn || linknavn)}`,
          });
        }
      }

      if (!fjernManglendeKolonne(payload, error)) {
        throw error;
      }
    }

    if (!nyFirma?.id) {
      throw new Error("Kunne ikke opprette hov_firma.");
    }

    return json({
      ok: true,
      eksisterer: false,
      melding: "Hovslagerkunde opprettet.",
      firma_id: nyFirma.id,
      firma: nyFirma,
      auth_user_id: authUserId,
      auth_eksisterte: authEksisterte,
      firma_eksisterte: false,
      linknavn: nyFirma.linknavn || linknavn,
      kundelink: `/hovslager/?firma=${encodeURIComponent(nyFirma.linknavn || linknavn)}`,
    });
  } catch (e) {
    console.error("opprett-hov-kunde feil:", e);
    return json({
      ok: false,
      error: String((e as any)?.message || e),
    }, 500);
  }
});
