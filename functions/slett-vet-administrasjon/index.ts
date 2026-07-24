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

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function journalOwnerFilter(bruker: any) {
  const values = [bruker?.id, bruker?.auth_user_id].filter(Boolean).map(String);
  return values.map((id) => `opprettet_av.eq.${id}`).join(",");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Edge Function mangler Supabase-oppsett." }, 500);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Mangler innlogging." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData?.user?.email) return json({ error: "Ugyldig innlogging." }, 401);

    const callerId = callerData.user.id;
    const callerEmail = norm(callerData.user.email);
    const { data: callerRows, error: accessError } = await admin
      .from("vet_klinikk_brukere")
      .select("id, klinikk_id, rolle, aktiv")
      .eq("epost", callerEmail);
    if (accessError) throw accessError;

    const systemadmin = callerEmail === "greknuts@online.no" || (callerRows || []).some((r: any) =>
      norm(r.rolle) === "systemadmin" && r.aktiv !== false
    );
    const body = await req.json().catch(() => ({}));
    const action = norm(body.action);

    if (action === "preview_user" || action === "delete_user") {
      const brukerId = String(body.bruker_id || "").trim();
      if (!brukerId) return json({ error: "Mangler bruker-ID." }, 400);

      const { data: bruker, error: brukerError } = await admin
        .from("vet_klinikk_brukere")
        .select("id, klinikk_id, navn, epost, rolle, aktiv, auth_user_id")
        .eq("id", brukerId)
        .maybeSingle();
      if (brukerError) throw brukerError;
      if (!bruker) return json({ error: "Fant ikke veterinæren." }, 404);

      const clinicAdmin = (callerRows || []).some((r: any) =>
        String(r.klinikk_id) === String(bruker.klinikk_id) &&
        ["admin", "klinikkadmin", "systemadmin"].includes(norm(r.rolle)) &&
        r.aktiv !== false
      );
      if (!systemadmin && !clinicAdmin) return json({ error: "Kun klinikkadmin eller systemadmin kan slette veterinærer." }, 403);
      if (String(bruker.auth_user_id || "") === String(callerId) || norm(bruker.epost) === callerEmail) {
        return json({ error: "Du kan ikke slette brukeren du selv er innlogget som." }, 409);
      }

      const ownerFilter = journalOwnerFilter(bruker);
      let journalCount = 0;
      if (ownerFilter) {
        const countResult = await admin
          .from("vet_journal")
          .select("id", { count: "exact", head: true })
          .eq("klinikk_id", bruker.klinikk_id)
          .or(ownerFilter);
        if (countResult.error) throw countResult.error;
        journalCount = countResult.count || 0;
      }

      const { data: alternativer, error: altError } = await admin
        .from("vet_klinikk_brukere")
        .select("id, navn, epost, rolle")
        .eq("klinikk_id", bruker.klinikk_id)
        .eq("aktiv", true)
        .neq("id", bruker.id)
        .order("navn", { ascending: true });
      if (altError) throw altError;

      if (action === "preview_user") {
        return json({ ok: true, bruker, journal_count: journalCount, alternativer: alternativer || [] });
      }

      const mode = norm(body.journal_handling || (journalCount ? "" : "none"));
      if (journalCount > 0 && !["transfer", "unassign"].includes(mode)) {
        return json({ error: "Velg om journalene skal overføres eller stå uten veterinær." }, 400);
      }

      if (journalCount > 0 && mode === "transfer") {
        const replacementId = String(body.ny_bruker_id || "").trim();
        const replacement = (alternativer || []).find((r: any) => String(r.id) === replacementId);
        if (!replacement) return json({ error: "Velg en aktiv veterinær på samme klinikk." }, 400);
        const updateResult = await admin
          .from("vet_journal")
          .update({ opprettet_av: replacement.id, behandler_navn: replacement.navn || replacement.epost || null })
          .eq("klinikk_id", bruker.klinikk_id)
          .or(ownerFilter);
        if (updateResult.error) throw updateResult.error;
      }

      if (journalCount > 0 && mode === "unassign") {
        const updateResult = await admin
          .from("vet_journal")
          .update({
            opprettet_av: null,
            behandler_navn: "Uten veterinær",
          })
          .eq("klinikk_id", bruker.klinikk_id)
          .or(ownerFilter);
        if (updateResult.error) throw updateResult.error;
      }

      const userUpdate = await admin
        .from("vet_klinikk_brukere")
        .update({ aktiv: false, slettet_at: new Date().toISOString(), slettet_av: callerId })
        .eq("id", bruker.id);
      if (userUpdate.error) throw userUpdate.error;

      let authDeleted = false;
      if (bruker.auth_user_id) {
        const { count, error: remainingError } = await admin
          .from("vet_klinikk_brukere")
          .select("id", { count: "exact", head: true })
          .eq("auth_user_id", bruker.auth_user_id)
          .eq("aktiv", true);
        if (remainingError) throw remainingError;
        if (!count) {
          const { error: authDeleteError } = await admin.auth.admin.deleteUser(bruker.auth_user_id);
          if (authDeleteError) throw authDeleteError;
          authDeleted = true;
        }
      }

      return json({ ok: true, journal_count: journalCount, journal_handling: mode, auth_deleted: authDeleted });
    }

    if (action === "preview_clinic" || action === "delete_clinic") {
      if (!systemadmin) return json({ error: "Bare systemadmin kan slette en klinikk." }, 403);
      const klinikkId = String(body.klinikk_id || "").trim();
      if (!klinikkId) return json({ error: "Mangler klinikk-ID." }, 400);

      const { data: klinikk, error: clinicError } = await admin
        .from("vet_klinikker")
        .select("*")
        .eq("id", klinikkId)
        .maybeSingle();
      if (clinicError) throw clinicError;
      if (!klinikk) return json({ error: "Fant ikke klinikken." }, 404);

      const journalResult = await admin
        .from("vet_journal")
        .select("id", { count: "exact", head: true })
        .eq("klinikk_id", klinikkId);
      if (journalResult.error) throw journalResult.error;
      const userResult = await admin
        .from("vet_klinikk_brukere")
        .select("id", { count: "exact", head: true })
        .eq("klinikk_id", klinikkId)
        .eq("aktiv", true);
      if (userResult.error) throw userResult.error;

      if (action === "preview_clinic") {
        return json({ ok: true, klinikk, journal_count: journalResult.count || 0, user_count: userResult.count || 0 });
      }

      const now = new Date().toISOString();
      const archiveResult = await admin
        .from("vet_journal")
        .update({
          arkivert: true,
          arkivert_at: now,
          arkivert_av: callerId,
          arkivert_grunn: `Klinikk deaktivert: ${klinikk.navn || klinikk.id}`,
          aktiv: false,
          status: "arkivert",
        })
        .eq("klinikk_id", klinikkId);
      if (archiveResult.error) throw archiveResult.error;

      const usersResult = await admin
        .from("vet_klinikk_brukere")
        .update({ aktiv: false, slettet_at: now, slettet_av: callerId })
        .eq("klinikk_id", klinikkId);
      if (usersResult.error) throw usersResult.error;

      const clinicUpdate = await admin
        .from("vet_klinikker")
        .update({ aktiv: false, deaktivert_at: now, deaktivert_av: callerId, deaktivert_grunn: "Slettet fra klinikkadministrasjon" })
        .eq("id", klinikkId);
      if (clinicUpdate.error) throw clinicUpdate.error;

      return json({ ok: true, journal_count: journalResult.count || 0, user_count: userResult.count || 0 });
    }

    return json({ error: "Ukjent handling." }, 400);
  } catch (error) {
    console.error("slett-vet-administrasjon feilet", error);
    return json({ error: String((error as any)?.message || error || "Ukjent feil") }, 400);
  }
});
