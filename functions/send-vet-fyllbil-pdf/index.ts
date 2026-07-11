// Supabase Edge Function: send-vet-fyllbil-pdf
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const resendApiKey = Deno.env.get("resendvet");
  const fromEmail = Deno.env.get("resendepost");
  const supabaseUrl = Deno.env.get("APP_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("APP_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl!, serviceRoleKey!);

  const body = await req.json();
  const klinikk_id = String(body.klinikk_id || "");

  const { data: admin } = await supabase
    .from("vet_klinikk_brukere")
    .select("epost")
    .eq("klinikk_id", klinikk_id)
    .eq("rolle", "klinikk-admin")
    .eq("aktiv", true)
    .single();

  return json({
    ok: true,
    admin_epost: admin?.epost || null,
    secrets_ok: !!resendApiKey && !!fromEmail
  });
});
