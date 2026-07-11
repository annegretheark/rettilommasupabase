// supabase/functions/opprett-vet-bruker/index.ts
// Oppretter Supabase Auth-bruker og kobler bruker til veterinærklinikk.
// Krever miljøvariabler i Supabase Edge Functions:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Kun POST er støttet." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return new Response(JSON.stringify({ error: "Mangler innlogging." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);

  if (callerError || !callerData?.user?.email) {
    return new Response(JSON.stringify({ error: "Kunne ikke bekrefte innlogget bruker." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const callerEmail = callerData.user.email.toLowerCase();

  const body = await req.json().catch(() => null);

  const navn = String(body?.navn || "").trim();
  const epost = String(body?.epost || "").trim().toLowerCase();
  const passord = String(body?.passord || "");
  const rolle = String(body?.rolle || "veterinaer").trim().toLowerCase();
  const klinikkId = String(body?.klinikk_id || "").trim();

  if (!epost || !passord || !klinikkId) {
    return new Response(JSON.stringify({ error: "Mangler e-post, passord eller klinikk." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!["veterinaer", "admin"].includes(rolle)) {
    return new Response(JSON.stringify({ error: "Ugyldig rolle." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (passord.length < 6) {
    return new Response(JSON.stringify({ error: "Passord må være minst 6 tegn." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const erSystemAdmin = callerEmail === "greknuts@online.no";

  if (!erSystemAdmin) {
    const { data: tilgang, error: tilgangError } = await adminClient
      .from("vet_klinikk_brukere")
      .select("klinikk_id, rolle, aktiv")
      .eq("epost", callerEmail)
      .eq("aktiv", true)
      .maybeSingle();

    if (tilgangError || !tilgang) {
      return new Response(JSON.stringify({ error: "Du er ikke koblet til en klinikk." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (String(tilgang.rolle).toLowerCase() !== "admin") {
      return new Response(JSON.stringify({ error: "Kun klinikkadmin kan opprette brukere." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (String(tilgang.klinikk_id) !== klinikkId) {
      return new Response(JSON.stringify({ error: "Du kan bare opprette brukere på egen klinikk." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Finn om brukeren finnes fra før.
  // Supabase Admin API har ikke alltid enkel lookup by email i alle klientversjoner,
  // så vi prøver createUser først og håndterer "already registered".
  let userId: string | null = null;

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: epost,
    password: passord,
    email_confirm: true,
    user_metadata: {
      navn,
      rolle,
      klinikk_id: klinikkId,
    },
  });

  if (createError) {
    const msg = createError.message || "";

    if (!msg.toLowerCase().includes("already") && !msg.toLowerCase().includes("registered")) {
      return new Response(JSON.stringify({ error: "Kunne ikke opprette Auth-bruker: " + msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    userId = created?.user?.id || null;
  }

  const { error: linkError } = await adminClient
    .from("vet_klinikk_brukere")
    .upsert({
      epost,
      navn,
      auth_user_id: userId,
      klinikk_id: klinikkId,
      rolle,
      aktiv: true,
    }, { onConflict: "epost" });

  if (linkError) {
    return new Response(JSON.stringify({ error: "Bruker ble opprettet, men kunne ikke kobles til klinikk: " + linkError.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, epost, rolle, klinikk_id: klinikkId }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
