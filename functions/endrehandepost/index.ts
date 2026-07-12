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
function isColumnError(error: unknown): boolean {
  return /column|schema cache|Could not find|does not exist|PGRST/i.test(String((error as any)?.message || error || ""));
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

async function requesterIsAdmin(admin: any, requesterId: string, requesterEmail: string): Promise<{ok:boolean; source:string; role:string; sysadmin:boolean}> {
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
    if (!inactive && ADMIN_ROLES.has(role)) return { ok: true, source: `${c.table}.${c.column}`, role, sysadmin: false };
  }

  if (await requesterIsSysadmin(admin, requesterEmail)) return { ok: true, source: "hand_sysadmin", role: "sysadm", sysadmin: true };
  return { ok: false, source: "", role: "", sysadmin: false };
}

async function readFirma(admin: any, firmaId: string): Promise<any> {
  for (const cols of ["id,epost,email", "id,epost", "id,email", "id"]) {
    const r = await admin.from("hand_firma").select(cols).eq("id", firmaId).maybeSingle();
    if (!r.error) return r.data;
    if (!isColumnError(r.error)) throw r.error;
  }
  return null;
}

async function readFirmaBrukere(admin: any, firmaId: string): Promise<any[]> {
  const r = await admin.from("hand_firma_bruker").select("*").eq("firma_id", firmaId);
  if (r.error) throw r.error;
  return Array.isArray(r.data) ? r.data : [];
}

async function patchFirmaEmail(admin: any, firmaId: string, newEmail: string): Promise<string | null> {
  for (const patch of [{ epost: newEmail }, { email: newEmail }]) {
    const r = await admin.from("hand_firma").update(patch).eq("id", firmaId);
    if (!r.error) return null;
    if (!isColumnError(r.error)) return String(r.error.message || r.error);
  }
  return "Fant ikke epost- eller email-kolonne i hand_firma.";
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
    const firmaId = raw(body.firma_id || body.firmaId);
    const newEmail = norm(body.new_email || body.nyEpost || body.newEmail);
    const oldEmailFromClient = norm(body.old_email || body.gammelEpost || body.oldEmail);
    let authUserId = raw(body.user_id || body.userId);

    if ((!ansattId && !firmaId) || !newEmail) {
      return json(400, { ok: false, error: "Mangler ansatt_id eller firma_id, eller new_email." });
    }

    const { data: requesterData, error: requesterError } = await admin.auth.getUser(accessToken);
    if (requesterError || !requesterData?.user) return json(401, { ok: false, error: "Kunne ikke lese innlogget bruker fra token.", details: requesterError?.message || null });
    const requesterId = raw(requesterData.user.id);
    const requesterEmail = norm(requesterData.user.email);

    const adminCheck = await requesterIsAdmin(admin, requesterId, requesterEmail);
    if (!adminCheck.ok) return json(403, {
      ok: false,
      error: "Innlogget bruker er ikke admin i hand_firma_bruker eller hand_ansatt.",
      requester_id: requesterId,
      requester_email: requesterEmail
    });

    // FIRMA: finn firmaets admin/eier i hand_firma_bruker, og oppdater denne Auth-brukeren.
    if (firmaId) {
      const firma = await readFirma(admin, firmaId);
      if (!firma) return json(404, { ok: false, error: "Fant ikke firma i hand_firma.", firma_id: firmaId });

      const firmaBrukere = await readFirmaBrukere(admin, firmaId);
      const adminRows = firmaBrukere.filter((r: any) => ADMIN_ROLES.has(norm(r.rolle || r.role)) && r.aktiv !== false && r.active !== false);
      const candidates = adminRows.length ? adminRows : firmaBrukere;
      const oldEmail = oldEmailFromClient || norm(firma.epost || firma.email);
      const owner = candidates.find((r: any) => authUserId && raw(r.user_id || r.auth_user_id) === authUserId)
        || candidates.find((r: any) => oldEmail && norm(r.epost || r.email) === oldEmail)
        || candidates[0]
        || null;

      authUserId = authUserId || raw(owner?.user_id || owner?.auth_user_id);
      if (!authUserId) authUserId = await findAuthUserIdByEmail(admin, oldEmail || norm(owner?.epost || owner?.email));
      if (!authUserId) return json(409, {
        ok: false,
        error: "Fant ikke firmaets Supabase Auth-bruker. Sjekk hand_firma_bruker.user_id eller gammel e-post.",
        firma_id: firmaId,
        old_email: oldEmail || null
      });

      const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, { email: newEmail, email_confirm: true });
      if (updateError) return json(500, { ok: false, error: "Auth kunne ikke oppdateres.", details: updateError.message, user_id: authUserId, firma_id: firmaId });

      const { data: verifyData, error: verifyError } = await admin.auth.admin.getUserById(authUserId);
      if (verifyError || norm(verifyData?.user?.email) !== newEmail) {
        return json(500, { ok: false, error: "Auth-oppdatering ble ikke verifisert.", details: verifyError?.message || null, auth_email: verifyData?.user?.email || null });
      }

      const firmaWarning = await patchFirmaEmail(admin, firmaId, newEmail);
      let brukerWarning: string | null = null;
      let brukerUpdated = false;

      const patches = [{ epost: newEmail, user_id: authUserId }, { epost: newEmail }, { email: newEmail, user_id: authUserId }, { email: newEmail }];
      for (const patch of patches) {
        let q = admin.from("hand_firma_bruker").update(patch);
        q = owner?.id ? q.eq("id", owner.id) : q.eq("user_id", authUserId);
        const r = await q;
        if (!r.error) { brukerUpdated = true; brukerWarning = null; break; }
        brukerWarning = String(r.error.message || r.error);
        if (!isColumnError(r.error)) break;
      }
      if (!brukerUpdated && oldEmail) {
        const r = await admin.from("hand_firma_bruker").update({ epost: newEmail, user_id: authUserId }).eq("firma_id", firmaId).ilike("epost", oldEmail);
        if (!r.error) { brukerUpdated = true; brukerWarning = null; }
        else brukerWarning = String(r.error.message || r.error);
      }

      return json(200, {
        ok: true,
        mode: "firma",
        authUpdated: true,
        firmaUpdated: !firmaWarning,
        firmaBrukerUpdated: brukerUpdated,
        firma_id: firmaId,
        user_id: authUserId,
        auth_email: newEmail,
        admin_source: adminCheck.source,
        admin_role: adminCheck.role,
        hand_firma_warning: firmaWarning,
        hand_firma_bruker_warning: brukerWarning
      });
    }

    // ANSATT: behold eksisterende og fungerende ansatte-flyt.
    let ansatt: any = null;
    let ansattError: any = null;
    for (const cols of ["id,user_id,epost,email", "id,user_id,epost", "id,epost,email", "id,epost", "id"]) {
      const r = await admin.from("hand_ansatt").select(cols).eq("id", ansattId).maybeSingle();
      if (!r.error) { ansatt = r.data; ansattError = null; break; }
      ansattError = r.error;
      if (!isColumnError(r.error)) break;
    }
    const ansattReadWarning = ansattError ? String(ansattError.message || ansattError) : (!ansatt ? "Fant ikke ansatt i hand_ansatt." : "");

    authUserId = authUserId || raw(ansatt?.user_id);
    if (!authUserId) authUserId = await findAuthUserIdByEmail(admin, oldEmailFromClient || ansatt?.epost || ansatt?.email);
    if (!authUserId) return json(409, {
      ok: false,
      error: "Fant ikke Supabase Auth-bruker. Send user_id fra klienten eller sjekk gammel e-post.",
      ansatt_id: ansattId,
      old_email: oldEmailFromClient || null,
      ansatt_email: ansatt?.epost || ansatt?.email || null,
      hand_ansatt_warning: ansattReadWarning || null
    });

    const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, { email: newEmail, email_confirm: true });
    if (updateError) return json(500, { ok: false, error: "Auth kunne ikke oppdateres.", details: updateError.message, user_id: authUserId, ansatt_id: ansattId });

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
      if (!isColumnError(r.error)) break;
    }

    const firma1 = await admin.from("hand_firma_bruker").update({ epost: newEmail }).eq("user_id", authUserId);
    if (oldEmailFromClient) await admin.from("hand_firma_bruker").update({ epost: newEmail, user_id: authUserId }).ilike("epost", oldEmailFromClient);

    return json(200, {
      ok: true,
      mode: "ansatt",
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
