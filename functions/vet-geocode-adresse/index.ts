import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Bruk POST." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!supabaseUrl || !anonKey || !token) return json({ error: "Mangler innlogging." }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Ugyldig innlogging." }, 401);

    const body = await req.json().catch(() => ({}));
    const address = String(body.adresse || body.address || "").trim();
    if (address.length < 4 || address.length > 300) return json({ error: "Skriv en gyldig adresse." }, 400);

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "no");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Language": "no,nb;q=0.9,en;q=0.5",
        "User-Agent": "Rett-i-Lomma-Veterinaer/1.0 (https://rettilomma.com)",
      },
    });
    if (!response.ok) return json({ error: "Karttjenesten svarte ikke. Prøv igjen senere." }, 502);
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    const lat = Number(first?.lat);
    const lon = Number(first?.lon);
    if (!first || !Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: "Fant ingen GPS-posisjon for adressen." }, 404);

    return json({ ok: true, lat, lon, visningsnavn: first.display_name || address });
  } catch (error) {
    console.error("vet-geocode-adresse feilet", error);
    return json({ error: "GPS-oppslaget feilet. Prøv igjen." }, 400);
  }
});

