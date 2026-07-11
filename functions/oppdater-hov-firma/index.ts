// Supabase Edge Function: oppdater-hov-firma
// Brukes fra SYSADM for å redigere eksisterende firma og opprette/koble innloggingsbruker.
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
  if (!email) return null;
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) return null;
      const users = data?.users || [];
      const funnet = users.find((u: any) => String(u?.email || "").toLowerCase() === email.toLowerCase());
      if (funnet?.id) return funnet.id;
      if (users.length < 100) break;
    }
  } catch (_) {}
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Bruk POST." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("APP_SUPABASE_URL");
    const SERVICE_ROLE_KEY =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("APP_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "Mangler SUPABASE_URL/APP_SUPABASE_URL eller SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY/APP_SERVICE_ROLE_KEY." }, 500);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const firmaId = String(body.firma_id || body.id || "").trim();
    if (!firmaId) return json({ ok: false, error: "Mangler firma_id." }, 400);

    const { data: eksisterendeFirma, error: firmaError } = await supabaseAdmin
      .from("hov_firma")
      .select("*")
      .eq("id", firmaId)
      .maybeSingle();
    if (firmaError) throw firmaError;
    if (!eksisterendeFirma?.id) return json({ ok: false, error: "Fant ikke firma." }, 404);

    const nyEpost = String(body.epost || body.email || eksisterendeFirma.epost || "").trim().toLowerCase();
    const passord = String(body.passord || body.password || "").trim();
    const rolle = String(body.rolle || body.role || "hovslager").trim() || "hovslager";
    const navnBruker = String(body.navn_bruker || body.brukernavn || body.navn || eksisterendeFirma.navn || "").trim();

    let authUserId: string | null = eksisterendeFirma.auth_user_id || null;
    let authOpprettet = false;
    let authOppdatert = false;

    if (nyEpost) {
      if (!authUserId) authUserId = await finnAuthUserId(supabaseAdmin, nyEpost);

      if (!authUserId && passord) {
        const created = await supabaseAdmin.auth.admin.createUser({
          email: nyEpost,
          password: passord,
          email_confirm: body.email_confirm !== false,
          user_metadata: { navn: navnBruker, app: "hovslager", firma_id: firmaId },
        });
        if (created.error) {
          const msg = String(created.error.message || "").toLowerCase();
          if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("user already")) {
            authUserId = await finnAuthUserId(supabaseAdmin, nyEpost);
          } else {
            throw created.error;
          }
        } else {
          authUserId = created.data?.user?.id || null;
          authOpprettet = true;
        }
      }

      if (authUserId) {
        const updateAuth: Record<string, unknown> = {
          email: nyEpost,
          user_metadata: { navn: navnBruker, app: "hovslager", firma_id: firmaId },
        };
        if (passord) updateAuth.password = passord;
        const upAuth = await supabaseAdmin.auth.admin.updateUserById(authUserId, updateAuth);
        if (upAuth.error) throw upAuth.error;
        authOppdatert = true;
      }
    }

    let payload: Record<string, unknown> = {};
    const map: Record<string, string[]> = {
      navn: ["navn", "firmanavn"],
      epost: ["epost", "email"],
      telefon: ["telefon", "phone"],
      adresse: ["adresse"],
      orgnr: ["orgnr", "org_nr", "bedriftsnr"],
      mva_nr: ["mva_nr", "mvaNr", "mva_nr"],
      nettside: ["nettside"],
      postnr: ["postnr"],
      poststed: ["poststed"],
      kontonr: ["kontonr"],
      vippsnummer: ["vippsnummer", "vipps_nr"],
      vipps_mottaker: ["vipps_mottaker", "vippsMottaker"],
      betalingsfrist_dager: ["betalingsfrist_dager", "betalingsfrist"],
      faktura_prefix: ["faktura_prefix", "fakturaPrefix"],
      neste_fakturanr: ["neste_fakturanr", "nesteFakturanr"],
      standard_mva_sats: ["standard_mva_sats", "mva_sats"],
      logo_url: ["logo_url"],
      logo_path: ["logo_path"],
    };

    for (const [col, keys] of Object.entries(map)) {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          const value = body[key];
          payload[col] = value === "" ? null : value;
          break;
        }
      }
    }

    if (!payload.linknavn && (payload.navn || eksisterendeFirma.navn)) {
      payload.linknavn = eksisterendeFirma.linknavn || slugify(String(payload.navn || eksisterendeFirma.navn));
    }
    if (authUserId) payload.auth_user_id = authUserId;

    let oppdatertFirma = eksisterendeFirma;
    for (let forsok = 0; forsok < 10; forsok++) {
      const { data, error } = await supabaseAdmin
        .from("hov_firma")
        .update(payload)
        .eq("id", firmaId)
        .select("*")
        .maybeSingle();
      if (!error) {
        oppdatertFirma = data || eksisterendeFirma;
        break;
      }
      if (!fjernManglendeKolonne(payload, error)) throw error;
    }

    if (authUserId) {
      let profilePayload: Record<string, unknown> = {
        auth_user_id: authUserId,
        firma_id: firmaId,
        rolle,
        epost: nyEpost || oppdatertFirma.epost || null,
        navn: navnBruker || oppdatertFirma.navn || null,
      };
      for (let forsok = 0; forsok < 8; forsok++) {
        const { error } = await supabaseAdmin.from("hov_profiles").upsert(profilePayload, { onConflict: "auth_user_id" });
        if (!error) break;
        if (!fjernManglendeKolonne(profilePayload, error)) {
          console.warn("Kunne ikke oppdatere hov_profiles:", error.message);
          break;
        }
      }
    }

    return json({
      ok: true,
      melding: "Firma er oppdatert.",
      firma_id: oppdatertFirma.id,
      firma: oppdatertFirma,
      auth_user_id: authUserId,
      auth_opprettet: authOpprettet,
      auth_oppdatert: authOppdatert,
      kundelink: `/hovslager/?firma=${encodeURIComponent(oppdatertFirma.linknavn || slugify(oppdatertFirma.navn || "firma"))}`,
    });
  } catch (e) {
    console.error("oppdater-hov-firma feil:", e);
    return json({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
});
