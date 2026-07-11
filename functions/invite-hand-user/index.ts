import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function requireAdmin(req: Request, admin: any): Promise<{ id: string; email: string }> {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Mangler innlogget bruker-token.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Ugyldig eller utløpt innlogging.");
  const id = String(data.user.id);
  const email = String(data.user.email || "").trim().toLowerCase();
  const roles = ["admin","administrator","eier","owner","firmaadmin","sysadm","sysadmin","systemadmin"];
  const [{ data: a }, { data: f }, { data: s }] = await Promise.all([
    admin.from("hand_ansatt").select("rolle,aktiv").eq("user_id", id).limit(1).maybeSingle(),
    admin.from("hand_firma_bruker").select("rolle").eq("user_id", id).limit(1).maybeSingle(),
    admin.from("hand_sysadm").select("aktiv").ilike("epost", email).eq("aktiv", true).limit(1).maybeSingle(),
  ]);
  const role = String(a?.rolle || f?.rolle || "").toLowerCase();
  if (!s && (a?.aktiv === false || !roles.includes(role))) throw new Error("Kun administrator kan utføre handlingen.");
  return { id, email };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ ok:false, error:"Bruk POST." }, { status:405, headers:corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) throw new Error("Mangler Supabase-secrets.");
    const admin = createClient(url, key, { auth:{ persistSession:false, autoRefreshToken:false } });
    await requireAdmin(req, admin);
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const redirectTo = String(body.redirectTo || "").trim();
    if (!email || !email.includes("@")) throw new Error("Ugyldig e-postadresse.");
    if (!redirectTo) throw new Error("Mangler redirectTo.");
    const parsed = new URL(redirectTo);
    if (!['https:','http:'].includes(parsed.protocol)) throw new Error("Ugyldig redirectTo.");
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) throw error;
    return Response.json({ ok:true, user_id:data?.user?.id || null }, { headers:corsHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /Kun administrator|token|innlogging/i.test(msg) ? 403 : 400;
    return Response.json({ ok:false, error:msg }, { status, headers:corsHeaders });
  }
});
