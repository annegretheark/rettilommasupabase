import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readJsonSafe(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function createSession(baseUrl: string, consumerToken: string, employeeToken: string) {
  const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL(`${baseUrl}/token/session/:create`);
  url.searchParams.set("consumerToken", consumerToken);
  url.searchParams.set("employeeToken", employeeToken);
  url.searchParams.set("expirationDate", expirationDate);
  const response = await fetch(url, { method: "PUT", headers: { Accept: "application/json" } });
  const payload = await readJsonSafe(response);
  if (!response.ok) throw { stage: "create_session", status: response.status, details: payload };
  const token = payload?.value?.token;
  if (!token) throw { stage: "create_session", status: 502, details: { error: "Tripletex svarte uten sesjonstoken" } };
  return token as string;
}

async function txFetch(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: "Basic " + btoa(`0:${token}`),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await readJsonSafe(response);
  if (!response.ok) throw { stage: path, status: response.status, details: payload };
  return payload;
}

async function findOrCreateCustomer(baseUrl: string, token: string, customer: any) {
  const email = clean(customer?.email || customer?.epost);
  const name = clean(customer?.name || customer?.navn);
  if (!name) throw { stage: "customer", status: 400, details: { error: "Kunden mangler navn" } };

  const search = new URLSearchParams({ count: "100", fields: "id,name,email,phoneNumber,postalAddress" });
  if (email) search.set("email", email);
  else search.set("name", name);

  const found = await txFetch(baseUrl, token, `/customer?${search.toString()}`);
  const values = Array.isArray(found?.values) ? found.values : [];
  const exact = values.find((item: any) =>
    (email && clean(item?.email).toLowerCase() === email.toLowerCase()) ||
    clean(item?.name).toLowerCase() === name.toLowerCase()
  );
  if (exact?.id) return { customer: exact, created: false };

  const address = clean(customer?.address || customer?.adresse);
  const postalCode = clean(customer?.postalCode || customer?.postnr);
  const city = clean(customer?.city || customer?.poststed);
  const body: any = {
    name,
    isCustomer: true,
    email: email || undefined,
    phoneNumber: clean(customer?.phone || customer?.telefon) || undefined,
  };
  if (address || postalCode || city) {
    body.postalAddress = {
      addressLine1: address || undefined,
      postalCode: postalCode || undefined,
      city: city || undefined,
    };
  }
  const created = await txFetch(baseUrl, token, "/customer", { method: "POST", body: JSON.stringify(body) });
  return { customer: created?.value ?? created, created: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Kun POST er tillatt" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.appId !== "hov") return json({ ok: false, error: "Ugyldig appId" }, 400);

    const consumerToken = Deno.env.get("TRIPLETEX_CONSUMER_TOKEN")?.trim();
    const employeeToken = Deno.env.get("TRIPLETEX_EMPLOYEE_TOKEN")?.trim();
    const baseUrl = (Deno.env.get("TRIPLETEX_API_BASE") || "https://api-test.tripletex.tech/v2").replace(/\/$/, "");
    if (!consumerToken || !employeeToken) {
      return json({ ok: false, error: "Tripletex-hemmeligheter mangler" }, 500);
    }

    const sessionToken = await createSession(baseUrl, consumerToken, employeeToken);

    if (body?.action === "test_connection") {
      const who = await txFetch(baseUrl, sessionToken, "/token/session/>whoAmI");
      return json({ ok: true, message: "Tilkoblingen til Tripletex virker", environment: baseUrl.includes("api-test") ? "test" : "production", account: who?.value ?? who });
    }

    if (body?.action === "create_invoice") {
      const customerResult = await findOrCreateCustomer(baseUrl, sessionToken, body.customer || {});
      const customerId = Number(customerResult.customer?.id);
      if (!customerId) throw { stage: "customer", status: 502, details: { error: "Mangler kunde-ID fra Tripletex" } };

      const invoice = body.invoice || {};
      const job = body.job || {};
      const orderDate = clean(invoice.date || invoice.dato) || new Date().toISOString().slice(0, 10);
      const dueDate = clean(invoice.dueDate || invoice.forfallsdato) || orderDate;
      const amountExVat = Number(invoice.amountExVat ?? invoice.eks_mva ?? 0);
      if (!(amountExVat >= 0)) throw { stage: "invoice", status: 400, details: { error: "Ugyldig fakturabeløp" } };
      const vatTypeId = Number(Deno.env.get("TRIPLETEX_VAT_TYPE_ID") || 3);
      const description = clean(invoice.description || invoice.tekst || job.description || job.jobbtype) || "Hovslagerarbeid";

      const orderBody = {
        customer: { id: customerId },
        orderDate,
        deliveryDate: clean(job.date || job.dato) || orderDate,
        orderLines: [{
          description,
          count: 1,
          unitPriceExcludingVatCurrency: amountExVat,
          vatType: { id: vatTypeId },
        }],
      };
      const orderPayload = await txFetch(baseUrl, sessionToken, "/order", { method: "POST", body: JSON.stringify(orderBody) });
      const order = orderPayload?.value ?? orderPayload;
      const orderId = Number(order?.id);
      if (!orderId) throw { stage: "order", status: 502, details: { error: "Mangler ordre-ID fra Tripletex", order: orderPayload } };

      const invoiceBody = {
        invoiceDate: orderDate,
        invoiceDueDate: dueDate,
        orders: [{ id: orderId }],
      };

      let invoicePayload;
      try {
        invoicePayload = await txFetch(baseUrl, sessionToken, "/invoice", {
          method: "POST",
          body: JSON.stringify(invoiceBody),
        });
      } catch (error: any) {
        // Enkel kompatibilitetsfallback dersom miljøet forventer PUT på samme ressurs.
        if (Number(error?.status) !== 405) throw error;
        invoicePayload = await txFetch(baseUrl, sessionToken, "/invoice", {
          method: "PUT",
          body: JSON.stringify(invoiceBody),
        });
      }

      const createdInvoice = invoicePayload?.value ?? invoicePayload;

      return json({
        ok: true,
        message: "Kunde og faktura er overført til Tripletex",
        customerCreated: customerResult.created,
        customer: customerResult.customer,
        order,
        invoice: createdInvoice,
      });
    }

    return json({ ok: false, error: "Ukjent handling" }, 400);
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return json({ ok: false, stage: error?.stage || "unknown", error: error?.message || error?.details?.error || "Tripletex-kallet feilet", details: error?.details ?? error }, status >= 400 && status < 600 ? status : 500);
  }
});
