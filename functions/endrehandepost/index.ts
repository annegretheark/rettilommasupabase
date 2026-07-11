import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_ROLES = new Set([
  "admin", "administrator", "eier", "owner",
  "firmaeier", "firma_admin", "firmaadmin",
  "bedrift_admin", "bedriftadmin", "bedriftsadmin",
  "daglig_leder", "dagligleder",
  "sysadm", "sysadmin", "systemadmin"
]);

function norm(v: unknown): string { return String(v ?? "").trim().toLowerCase(); }
function raw(v: unknown): string { return String(v ?? "").trim(); }
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
function getServiceKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("ENDREHANDEPOST") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch (_) { return ""; }
}

async function findAuthUserIdByEmail(admin: any, email: string): Promise<string> {
  email = norm(email);
  if (!email) return "";
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u: any) => norm(u.email) === email);
    if (hit?.id) return String(hit.id);
    if (users.length < 100) break;
  }
  return "";
}

async function requesterIsSysadmin(admin: any, email: string): Promise<boolean> {
  if (!email) return false;
  for (const table of ["hand_sysadmin", "handsysadmin", "hand_sysadm"]) {
    for (const col of ["epost", "email"]) {
      const { data, error } = await admin.from(table).select("*").ilike(col, email).limit(1);
      if (!error && Array.isArray(data) && data.length) {
        const r = data[0] || {};
        return !(r.aktiv === false || r.active === false || r.deaktivert === true);
      }
    }
  }
  return false;
}

async function requesterIsAdmin(admin: any, requesterId: string, requesterEmail: string): Promise<{ok:boolean; source:string; role:string}> {
  const checks: Array<{table:string; column:string; value:string}> = [];
  if (requesterId) {
    checks.push({ table: "hand_firma_bruker", column: "user_id", value: requesterId });
    checks.push({ table: "hand_ansatt", column: "user_id", value: requesterId });
  }
  if (requesterEmail) {
    checks.push({ table: "hand_firma_bruker", column: "epost", value: requesterEmail });
    checks.push({ table: "hand_ansatt", column: "epost", value: requesterEmail });
    checks.push({ table: "hand_ansatt", column: "email", value: requesterEmail });
  }

  for (const c of checks) {
    let q = admin.from(c.table).select("*").limit(1);
    q = c.column === "user_id" ? q.eq(c.column, c.value) : q.ilike(c.column, c.value);
    const { data, error } = await q;
    if (error || !Array.isArray(data) || !data.length) continue;
    const r = data[0] || {};
    const inactive = r.aktiv === false || r.active === false || r.deaktivert === true;
    const role = norm(r.rolle || r.role);
    if (!inactive && ADMIN_ROLES.has(role)) return { ok: true, source: `${c.table}.${c.column}`, role };
  }

  if (await requesterIsSysadmin(admin, requesterEmail)) return { ok: true, source: "hand_sysadmin", role: "sysadm" };
  return { ok: false, source: "", role: "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = getServiceKey();
  if (!url || !serviceKey) return json(500, { ok: false, error: "Mangler SUPABASE_URL eller service key. Sett SUPABASE_SERVICE_ROLE_KEY som secret på Edge Function." });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const accessToken = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(401, { ok: false, error: "Mangler innlogget bruker-token. Test fra appen som innlogget admin, ikke bare publishable key." });

  try {
    const body = await req.json().catch(() => ({}));
    const ansattId = raw(body.ansatt_id || body.ansattId);
    const newEmail = norm(body.new_email || body.nyEpost || body.newEmail);
    const oldEmail = norm(body.old_email || body.gammelEpost || body.oldEmail);
    let authUserId = raw(body.user_id || body.userId);
    if (!ansattId || !newEmail) return json(400, { ok: false, error: "Mangler ansatt_id eller new_email." });

    const { data: requesterData, error: requesterError } = await admin.auth.getUser(accessToken);
    if (requesterError || !requesterData?.user) return json(401, { ok: false, error: "Kunne ikke lese innlogget bruker fra token.", details: requesterError?.message || null });
    const requesterId = raw(requesterData.user.id);
    const requesterEmail = norm(requesterData.user.email);

    const adminCheck = await requesterIsAdmin(admin, requesterId, requesterEmail);
    if (!adminCheck.ok) return json(403, {
      ok: false,
      error: "Innlogget bruker er ikke admin i hand_firma_bruker eller hand_ansatt.",
      requester_id: requesterId,
      requester_email: requesterEmail,
      checked: ["hand_firma_bruker.user_id", "hand_firma_bruker.epost", "hand_ansatt.user_id", "hand_ansatt.epost", "hand_sysadmin"]
    });

    // Les hand_ansatt robust: noen databaser mangler email og/eller user_id.
    // Supabase feiler hele selecten hvis en valgt kolonne ikke finnes, derfor prøver vi smalere selects.
    let ansatt: any = null;
    let ansattError: any = null;
    for (const cols of ["id,user_id,epost,email", "id,user_id,epost", "id,epost,email", "id,epost", "id"]) {
      const r = await admin.from("hand_ansatt").select(cols).eq("id", ansattId).maybeSingle();
      if (!r.error) { ansatt = r.data; ansattError = null; break; }
      ansattError = r.error;
      const msg = String(r.error.message || "");
      if (!/column|schema cache|Could not find|does not exist|PGRST/i.test(msg)) break;
    }
    // Ikke stopp her hvis hand_ansatt ikke kan leses. På noen installasjoner har tabellen
    // annen RLS/skjema/cache enn forventet. Vi kan fortsatt oppdatere Supabase Auth når
    // klienten sender user_id eller gammel e-post. Tabellen oppdateres best-effort etterpå.
    const ansattReadWarning = ansattError ? String(ansattError.message || ansattError) : (!ansatt ? "Fant ikke ansatt i hand_ansatt." : "");

    authUserId = authUserId || raw(ansatt?.user_id);
    if (!authUserId) authUserId = await findAuthUserIdByEmail(admin, oldEmail || ansatt?.epost || ansatt?.email);
    if (!authUserId) return json(409, {
      ok: false,
      error: "Fant ikke Supabase Auth-bruker. Send user_id fra klienten eller sjekk gammel e-post.",
      ansatt_id: ansattId,
      old_email: oldEmail || null,
      ansatt_email: ansatt?.epost || ansatt?.email || null,
      hand_ansatt_warning: ansattReadWarning || null
    });

    const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, {
      email: newEmail,
      email_confirm: true
    });
    if (updateError) return json(500, {
      ok: false,
      error: "Auth kunne ikke oppdateres.",
      details: updateError.message,
      user_id: authUserId,
      ansatt_id: ansattId,
      requested_email: newEmail,
      admin_source: adminCheck.source,
      admin_role: adminCheck.role
    });

    const { data: verifyData, error: verifyError } = await admin.auth.admin.getUserById(authUserId);
    if (verifyError || norm(verifyData?.user?.email) !== newEmail) {
      return json(500, { ok: false, error: "Auth-oppdatering ble ikke verifisert.", details: verifyError?.message || null, auth_email: verifyData?.user?.email || null });
    }

    let patchAnsattError: any = null;
    let ansattUpdated = false;
    for (const patch of [{ epost: newEmail, user_id: authUserId }, { epost: newEmail }, { email: newEmail, user_id: authUserId }, { email: newEmail }]) {
      const r = await admin.from("hand_ansatt").update(patch).eq("id", ansattId);
      if (!r.error) { patchAnsattError = null; ansattUpdated = true; break; }
      patchAnsattError = r.error;
      const msg = String(r.error.message || "");
      if (!/column|schema cache|Could not find|does not exist|PGRST/i.test(msg)) break;
    }

    // Auth er viktigst. Ikke returner feil etter vellykket Auth-oppdatering bare fordi
    // hand_ansatt ikke kan patches; klienten lagrer hand_ansatt etterpå.
    const firma1 = await admin.from("hand_firma_bruker").update({ epost: newEmail }).eq("user_id", authUserId);
    if (oldEmail) await admin.from("hand_firma_bruker").update({ epost: newEmail, user_id: authUserId }).ilike("epost", oldEmail);

    return json(200, {
      ok: true,
      authUpdated: true,
      ansattUpdated,
      user_id: authUserId,
      auth_email: newEmail,
      admin_source: adminCheck.source,
      admin_role: adminCheck.role,
      hand_ansatt_warning: ansattReadWarning || (patchAnsattError ? String(patchAnsattError.message || patchAnsattError) : null),
      hand_firma_bruker_warning: firma1.error ? String(firma1.error.message || firma1.error) : null
    });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
