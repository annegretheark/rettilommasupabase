import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

async function requireAdmin(req: Request, admin: any): Promise<{ id: string; email: string }> {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Mangler innlogget bruker-token.");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Ugyldig eller utløpt innlogging.");

  const id = String(data.user.id);
  const email = norm(data.user.email);
  const roles = ["admin", "administrator", "eier", "owner", "firmaadmin", "sysadm", "sysadmin", "systemadmin"];

  const [{ data: a }, { data: f }, { data: s }] = await Promise.all([
    admin.from("hand_ansatt").select("rolle,aktiv").eq("user_id", id).limit(1).maybeSingle(),
    admin.from("hand_firma_bruker").select("rolle").eq("user_id", id).limit(1).maybeSingle(),
    admin.from("hand_sysadm").select("aktiv").ilike("epost", email).eq("aktiv", true).limit(1).maybeSingle(),
  ]);

  const role = norm(a?.rolle || f?.rolle);
  if (!s && (a?.aktiv === false || !roles.includes(role))) {
    throw new Error("Kun administrator kan utføre handlingen.");
  }
  return { id, email };
}

async function findAuthUser(admin: any, email: string): Promise<any | null> {
  const [{ data: ansatt }, { data: firmaBruker }] = await Promise.all([
    admin.from("hand_ansatt").select("user_id").ilike("epost", email).not("user_id", "is", null).limit(1).maybeSingle(),
    admin.from("hand_firma_bruker").select("user_id").ilike("epost", email).not("user_id", "is", null).limit(1).maybeSingle(),
  ]);

  const knownId = String(ansatt?.user_id || firmaBruker?.user_id || "").trim();
  if (knownId) {
    const { data } = await admin.auth.admin.getUserById(knownId);
    if (data?.user && norm(data.user.email) === email) return data.user;
  }

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data?.users?.find((u: any) => norm(u.email) === email);
    if (user) return user;
    if (!data?.users || data.users.length < 1000) break;
  }
  return null;
}

async function upsertAdminRows(admin: any, input: {
  userId: string;
  email: string;
  navn: string;
  firmaId: string;
  rolle: string;
}) {
  const ansatt = {
    user_id: input.userId,
    navn: input.navn,
    epost: input.email,
    rolle: input.rolle,
    firma_id: input.firmaId,
    aktiv: true,
    ma_bytte_passord: true,
  };

  const { data: existingAnsatt } = await admin
    .from("hand_ansatt")
    .select("id")
    .or(`user_id.eq.${input.userId},epost.ilike.${input.email}`)
    .limit(1)
    .maybeSingle();

  const ansattResult = existingAnsatt?.id
    ? await admin.from("hand_ansatt").update(ansatt).eq("id", existingAnsatt.id)
    : await admin.from("hand_ansatt").insert(ansatt);
  if (ansattResult.error) throw ansattResult.error;

  const firmaBruker = {
    user_id: input.userId,
    firma_id: input.firmaId,
    epost: input.email,
    rolle: input.rolle,
  };

  const { data: existingFirmaBruker } = await admin
    .from("hand_firma_bruker")
    .select("id")
    .or(`user_id.eq.${input.userId},epost.ilike.${input.email}`)
    .limit(1)
    .maybeSingle();

  const firmaResult = existingFirmaBruker?.id
    ? await admin.from("hand_firma_bruker").update(firmaBruker).eq("id", existingFirmaBruker.id)
    : await admin.from("hand_firma_bruker").insert(firmaBruker);
  if (firmaResult.error) throw firmaResult.error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Bruk POST." }, { status: 405, headers: CORS });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) throw new Error("Mangler Supabase-secrets.");

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await requireAdmin(req, admin);

    const body = await req.json().catch(() => ({}));
    const email = norm(body.epost || body.email);
    const navn = String(body.navn || "").trim();
    const firmaId = String(body.firma_id || "").trim();
    const rolle = norm(body.rolle || "admin") || "admin";
    const redirectTo = String(body.redirect_to || body.redirectTo || "").trim() || undefined;

    if (!email.includes("@") || !navn || !firmaId) {
      throw new Error("Mangler gyldig e-post, navn eller firma_id.");
    }

    let user = await findAuthUser(admin, email);
    let emailType: "invite" | "recovery";

    if (user) {
      const { error } = await admin.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
      emailType = "recovery";
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { navn, firma_id: firmaId, rolle, ma_bytte_passord: true },
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (error || !data?.user) throw error || new Error("Invitasjonen ble ikke opprettet.");
      user = data.user;
      emailType = "invite";
    }

    await upsertAdminRows(admin, {
      userId: String(user.id),
      email,
      navn,
      firmaId,
      rolle,
    });

    return Response.json({
      ok: true,
      user_id: String(user.id),
      email_type: emailType,
      message: emailType === "invite"
        ? "Invitasjon er sendt til firmaets e-postadresse."
        : "Brukeren finnes allerede. E-post for å bytte passord er sendt.",
    }, { headers: CORS });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /Kun administrator|token|innlogging/i.test(message) ? 403 : 400;
    return Response.json({ ok: false, error: message }, { status, headers: CORS });
  }
});
