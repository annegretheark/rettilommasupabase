import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Mangler serverhemmeligheten ${name}`);
  return value;
}

function env(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() || fallback;
}

async function getAccessToken() {
  const applicationKey = required("POWEROFFICE_APPLICATION_KEY");
  const clientKey = required("POWEROFFICE_CLIENT_KEY");
  const subscriptionKey = required("POWEROFFICE_SUBSCRIPTION_KEY");
  const tokenUrl = env("POWEROFFICE_TOKEN_URL", "https://goapi.poweroffice.net/Demo/OAuth/Token");
  const basic = btoa(`${applicationKey}:${clientKey}`);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": subscriptionKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok || !payload.access_token) {
    throw new Error(`PowerOffice tokenfeil (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { token: String(payload.access_token), expiresIn: Number(payload.expires_in || 1200), subscriptionKey };
}

async function powerOfficeRequest(path: string, init: RequestInit = {}) {
  const { token, subscriptionKey } = await getAccessToken();
  const baseUrl = env("POWEROFFICE_BASE_URL", "https://goapi.poweroffice.net/Demo/v2").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": subscriptionKey,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    throw new Error(`PowerOffice API-feil ${init.method || "GET"} ${path} (${response.status}): ${text.slice(0, 1200)}`);
  }
  return payload;
}

function firstItem(payload: any): any | null {
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload?.items)) return payload.items[0] || null;
  if (Array.isArray(payload?.data)) return payload.data[0] || null;
  return null;
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== "")) as Partial<T>;
}

async function findOrCreateCustomer(customer: any) {
  const customersPath = env("POWEROFFICE_CUSTOMERS_PATH", "/Customers");
  const externalCode = String(customer.externalCode || customer.id || "").slice(0, 50);
  const orgNo = String(customer.organizationNumber || "").replace(/\D/g, "");
  const email = String(customer.email || "").trim();

  const queries = [
    externalCode ? `${customersPath}?$filter=ExternalCode eq '${encodeURIComponent(externalCode)}'` : "",
    orgNo ? `${customersPath}?$filter=VatNumber eq '${encodeURIComponent(orgNo)}'` : "",
    email ? `${customersPath}?$filter=EmailAddress eq '${encodeURIComponent(email.replace(/'/g, "''"))}'` : "",
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const found = firstItem(await powerOfficeRequest(query));
      if (found) return { customer: found, created: false };
    } catch (error) {
      console.warn("Customer lookup failed, trying next key", error);
    }
  }

  const isPerson = !orgNo;
  const fullName = String(customer.name || "").trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = String(
    customer.firstName ||
    (nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] || "Ukjent")
  ).trim();
  const lastName = String(
    customer.lastName ||
    (nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Kunde")
  ).trim();

  const payload = compact({
    Name: fullName || `${firstName} ${lastName}`,
    FirstName: firstName,
    LastName: lastName,
    IsPerson: isPerson,
    ExternalCode: externalCode || undefined,
    EmailAddress: email || undefined,
    PhoneNumber: customer.phone || undefined,
    VatNumber: orgNo || undefined,
    MailAddress: customer.address ? compact({
      AddressLine1: customer.address,
      ZipCode: customer.postalCode,
      City: customer.city,
      CountryCode: customer.countryCode || "NO",
    }) : undefined,
  });
  const created = await powerOfficeRequest(customersPath, { method: "POST", body: JSON.stringify(payload) });
  return { customer: created, created: true };
}

async function createInvoiceDraft(body: any) {
  if (!body?.job?.id) throw new Error("Mangler jobb-ID");
  if (!body?.customer?.name) throw new Error("Mangler kundenavn");
  const { customer, created } = await findOrCreateCustomer({ ...body.customer, externalCode: `hov-kunde-${body.customer.id || body.job.customerId || "ukjent"}` });
  const customerId = customer?.id ?? customer?.Id;
  if (!customerId) throw new Error(`PowerOffice returnerte kunde uten ID: ${JSON.stringify(customer)}`);

  const invoice = body.invoice || {};
  const job = body.job || {};
  const salesOrdersPath = env("POWEROFFICE_SALES_ORDERS_PATH", "/SalesOrders/Complete");
  const externalImportReference = (`RL-${job.id}`).substring(0, 50);
  const description = String(invoice.description || job.description || "Hovslagerarbeid");
  const amountExVat = Number(invoice.amountExVat || 0);
  const quantity = Number(invoice.quantity || 1);
  const unitPrice = quantity ? amountExVat / quantity : amountExVat;

  const line = compact({
    Description: description,
    Quantity: quantity,
    UnitPrice: unitPrice,
    ExternalLineReference: (`RL-L-${job.id}`).substring(0, 50),
    ProductCode: invoice.productCode || undefined,
    ProductId: invoice.productId || undefined,
    VatCode: invoice.vatCode || undefined,
    VatId: invoice.vatId || undefined,
  });
  const payload = compact({
    CustomerId: customerId,
    SalesOrderDate: invoice.date || job.date,
    DeliveryDate: job.date || invoice.date,
    DueDate: invoice.dueDate,
    Description: description,
    ExternalImportReference: externalImportReference,
    State: "Draft",
    SalesOrderLines: [line],
  });

  const order = await powerOfficeRequest(salesOrdersPath, { method: "POST", body: JSON.stringify(payload) });
  return { customer, customerCreated: created, order, externalImportReference };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "test_connection");
    if (action === "test_connection") {
      const { expiresIn } = await getAccessToken();
      return Response.json({ ok: true, environment: "demo", expiresIn }, { headers: corsHeaders });
    }
    if (action === "client_info") {
      const data = await powerOfficeRequest(env("POWEROFFICE_CLIENT_INFO_PATH", "/ClientIntegrationInformation"));
      return Response.json({ ok: true, data }, { headers: corsHeaders });
    }
    if (action === "create_invoice_draft") {
      const result = await createInvoiceDraft(body);
      return Response.json({ ok: true, ...result }, { headers: corsHeaders });
    }
    return Response.json({ ok: false, error: "Ukjent handling" }, { status: 400, headers: corsHeaders });
  } catch (error) {
    console.error("PowerOffice function error", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: corsHeaders });
  }
});
