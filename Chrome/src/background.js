import { API_CONFIG, STORAGE_KEYS } from "./config.js";
import { decryptJson, encryptJson, getOrCreateEncryptionKey } from "./crypto.js";

const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;

const CUSTOMER_FIELDS = [
  "companyname",
  "firstname",
  "lastname",
  "assignedto",
  "email",
  "phone",
  "recordid",
  "fullname",
  "created_at",
  "last_sales_date",
  "discount_percent",
  "tags",
  "billing_line1",
  "billing_line2",
  "billing_line3",
  "billing_line4",
  "billing_city",
  "billing_state",
  "billing_postal_code",
  "billing_country",
  "shipping_line1",
  "shipping_line2",
  "shipping_line3",
  "shipping_line4",
  "shipping_city",
  "shipping_state",
  "shipping_postal_code",
  "shipping_country"
];

const SALES_ORDER_FIELDS = [
  "id",
  "external_id",
  "customer_email",
  "status",
  "total_cents",
  "created_at",
  "assigned_to",
  "payment_due_date",
  "updated_at",
  "ship_method",
  "tracking_number",
  "customer_recordid",
  "companyname",
  "fullname",
  "shipping_cost_cents",
  "currency",
  "class_name",
  "order_terms",
  "method_id",
  "is_archived",
  "billing_line1",
  "billing_line2",
  "billing_line3",
  "billing_line4",
  "billing_city",
  "billing_state",
  "billing_postal_code",
  "billing_country",
  "shipping_line1",
  "shipping_line2",
  "shipping_line3",
  "shipping_line4",
  "shipping_city",
  "shipping_state",
  "shipping_postal_code",
  "shipping_country"
];

async function getStoredCredentials() {
  const keyMaterial = await getOrCreateEncryptionKey(storageApi, STORAGE_KEYS.encryptionKey);
  const stored = await storageApi.get([STORAGE_KEYS.credentials, STORAGE_KEYS.onboarding]);
  const encryptedCredentials = stored[STORAGE_KEYS.credentials];

  if (!encryptedCredentials) {
    return {
      credentials: null,
      verifiedAt: stored[STORAGE_KEYS.onboarding]?.verifiedAt ?? null
    };
  }

  try {
    const credentials = await decryptJson(encryptedCredentials, keyMaterial);

    return {
      credentials,
      verifiedAt: stored[STORAGE_KEYS.onboarding]?.verifiedAt ?? null
    };
  } catch (error) {
    console.error("Unable to decrypt stored credentials.", error);
    return {
      credentials: null,
      verifiedAt: null
    };
  }
}

function isPlaceholderEndpoint(url) {
  try {
    return new URL(url).hostname === "example.com";
  } catch {
    return true;
  }
}

function assertConfiguredEndpoint(url, label) {
  if (isPlaceholderEndpoint(url)) {
    throw new Error(`${label} endpoint is not configured yet. Update src/config.js with the real URL.`);
  }
}

async function verifyCredentials(publicKey, secretKey) {
  assertConfiguredEndpoint(API_CONFIG.verificationUrl, "Verification");
  const response = await fetch(API_CONFIG.verificationUrl, {
    method: "GET",
    headers: buildAuthHeaders({ publicKey, secretKey })
  });

  if (!response.ok) {
    throw new Error(`Verification failed with status ${response.status}.`);
  }

  return response.json().catch(() => true);
}

async function storeCredentials(publicKey, secretKey) {
  const keyMaterial = await getOrCreateEncryptionKey(storageApi, STORAGE_KEYS.encryptionKey);
  const encryptedCredentials = await encryptJson({ publicKey, secretKey }, keyMaterial);
  const verificationState = {
    verifiedAt: new Date().toISOString()
  };

  await storageApi.set({
    [STORAGE_KEYS.credentials]: encryptedCredentials,
    [STORAGE_KEYS.onboarding]: verificationState
  });

  return verificationState;
}

async function clearCredentials() {
  await storageApi.remove([STORAGE_KEYS.credentials, STORAGE_KEYS.onboarding]);
}

function buildAuthHeaders(credentials) {
  return {
    "x-ssp-public-key": credentials.publicKey,
    "x-ssp-secret-key": credentials.secretKey
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let payload = {};

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  if (!response.ok) {
    const detail = typeof payload === "string"
      ? payload
      : payload?.error ?? payload?.message ?? "";
    const suffix = detail ? `: ${detail}` : ".";
    const error = new Error(`Request failed for ${url} with status ${response.status}${suffix}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function escapeSqlValue(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function buildEqualityClause(fieldName, value) {
  return `${fieldName} = '${escapeSqlValue(value)}'`;
}

function buildScopedSelectQuery({ fields, whereClauses = [], orderBy = "", limit = 1 }) {
  let query = `SELECT ${fields.join(", ")}`;

  if (whereClauses.length) {
    query += ` WHERE ${whereClauses.join(" OR ")}`;
  }

  if (orderBy) {
    query += ` ORDER BY ${orderBy}`;
  }

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  return query;
}

function buildUrlWithParams(baseUrl, params) {
  const url = new URL(baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function normalizeQueryRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.records)) {
    return payload.records;
  }

  if (Array.isArray(payload?.result)) {
    return payload.result;
  }

  if (payload && typeof payload === "object") {
    return [payload];
  }

  return [];
}

async function fetchQueryRows(url, query, headers) {
  try {
    const payload = await fetchJson(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    return normalizeQueryRows(payload);
  } catch (error) {
    if (![400, 404, 405, 415].includes(error.status ?? 0)) {
      throw error;
    }
  }

  const payload = await fetchJson(
    buildUrlWithParams(url, { query }),
    {
      method: "GET",
      headers
    }
  );

  return normalizeQueryRows(payload);
}

function formatCurrencyFromCents(amountInCents, currency = "USD") {
  if (typeof amountInCents !== "number") {
    return "N/A";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(amountInCents / 100);
  } catch {
    return `${(amountInCents / 100).toFixed(2)} ${currency}`;
  }
}

function formatAddress(record, prefix) {
  const lines = [
    record?.[`${prefix}_line1`],
    record?.[`${prefix}_line2`],
    record?.[`${prefix}_line3`],
    record?.[`${prefix}_line4`]
  ].filter(Boolean);
  const locality = [
    record?.[`${prefix}_city`],
    record?.[`${prefix}_state`],
    record?.[`${prefix}_postal_code`]
  ].filter(Boolean).join(", ");

  if (locality) {
    lines.push(locality);
  }

  if (record?.[`${prefix}_country`]) {
    lines.push(record[`${prefix}_country`]);
  }

  return lines.length ? lines.join(", ") : "N/A";
}

function summarizeCustomer(customer = {}) {
  const fullName = customer.fullname
    ?? [customer.firstname, customer.lastname].filter(Boolean).join(" ").trim();

  return {
    companyName: customer.companyname ?? "Unknown company",
    contactName: fullName || "Unknown contact",
    assignedTo: customer.assignedto ?? "Unassigned",
    email: customer.email ?? "N/A",
    phone: customer.phone ?? "N/A",
    recordId: customer.recordid ?? "N/A",
    createdAt: customer.created_at ?? "Unavailable",
    lastSalesDate: customer.last_sales_date ?? "Unavailable",
    discountPercent: customer.discount_percent ?? "N/A",
    tags: customer.tags ?? "N/A",
    billingAddress: formatAddress(customer, "billing"),
    shippingAddress: formatAddress(customer, "shipping")
  };
}

function summarizeSalesOrder(order = {}) {
  return {
    companyName: order.companyname ?? "Unknown company",
    contactName: order.fullname ?? "Unknown contact",
    totalValue: formatCurrencyFromCents(order.total_cents, order.currency ?? "USD"),
    shippingCost: formatCurrencyFromCents(order.shipping_cost_cents, order.currency ?? "USD"),
    status: order.status ?? "Unknown",
    externalId: order.external_id ?? String(order.id ?? "N/A"),
    customerEmail: order.customer_email ?? "N/A",
    createdAt: order.created_at ?? "Unavailable",
    updatedAt: order.updated_at ?? "Unavailable",
    assignedTo: order.assigned_to ?? "Unassigned",
    paymentDueDate: order.payment_due_date ?? "Unavailable",
    trackingNumber: order.tracking_number ?? "N/A",
    shipMethod: order.ship_method ?? "N/A",
    orderTerms: order.order_terms ?? "N/A",
    className: order.class_name ?? "N/A",
    customerRecordId: order.customer_recordid ?? "",
    billingAddress: formatAddress(order, "billing"),
    shippingAddress: formatAddress(order, "shipping")
  };
}

function buildSalesOrderLookupQuery(salesOrderId, orderNumber) {
  if (!salesOrderId && !orderNumber) {
    throw new Error("No sales order identifier was found in the current page URL.");
  }

  const candidateTokens = [...new Set([salesOrderId, orderNumber].filter(Boolean))];
  const whereClauses = candidateTokens.flatMap((token) => ([
    buildEqualityClause("id", token),
    buildEqualityClause("external_id", token)
  ]));

  return buildScopedSelectQuery({
    fields: SALES_ORDER_FIELDS,
    whereClauses,
    orderBy: "updated_at DESC",
    limit: 1
  });
}

async function fetchSalesOrderRecord(salesOrderId, orderNumber, headers) {
  const query = buildSalesOrderLookupQuery(salesOrderId, orderNumber);
  const rows = await fetchQueryRows(API_CONFIG.salesOrdersUrl, query, headers);
  const matchedOrder = rows[0] ?? null;

  if (!matchedOrder) {
    throw new Error(`No sales order matched "${orderNumber || salesOrderId}".`);
  }

  return matchedOrder;
}

function buildCustomerLookupQuery(customerToken, salesOrder) {
  const whereClauses = [];
  const recordId = salesOrder?.customer_recordid ?? customerToken ?? "";
  const customerEmail = salesOrder?.customer_email ?? "";

  if (recordId) {
    whereClauses.push(buildEqualityClause("recordid", recordId));
  }

  if (customerEmail) {
    whereClauses.push(buildEqualityClause("email", customerEmail));
  }

  if (!whereClauses.length) {
    return "";
  }

  return buildScopedSelectQuery({
    fields: CUSTOMER_FIELDS,
    whereClauses,
    orderBy: "last_sales_date DESC",
    limit: 1
  });
}

async function fetchCustomerRecord(customerToken, salesOrder, headers) {
  const query = buildCustomerLookupQuery(customerToken, salesOrder);

  if (!query) {
    return null;
  }

  const rows = await fetchQueryRows(API_CONFIG.customersUrl, query, headers);
  return rows[0] ?? null;
}

async function fetchPanelData(pageUrl, orderNumber = "") {
  const { credentials } = await getStoredCredentials();

  if (!credentials) {
    return {
      ok: false,
      reason: "missing_credentials"
    };
  }

  const url = new URL(pageUrl);
  assertConfiguredEndpoint(API_CONFIG.customersUrl, "Customers");
  assertConfiguredEndpoint(API_CONFIG.salesOrdersUrl, "Sales orders");
  const salesOrderId = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const customerId = url.searchParams.get("customerId") ?? "";
  const headers = buildAuthHeaders(credentials);
  const salesOrderRecord = await fetchSalesOrderRecord(salesOrderId, orderNumber, headers);
  const customerRecord = await fetchCustomerRecord(customerId, salesOrderRecord, headers);

  return {
    ok: true,
    meta: {
      salesOrderId: salesOrderRecord?.id ?? salesOrderId,
      customerId: salesOrderRecord?.customer_recordid ?? customerRecord?.recordid ?? customerId,
      refreshedAt: new Date().toISOString()
    },
    customer: summarizeCustomer(customerRecord ?? {}),
    salesOrder: summarizeSalesOrder(salesOrderRecord ?? {})
  };
}

runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;

  (async () => {
    switch (action) {
      case "getAuthState": {
        const { credentials, verifiedAt } = await getStoredCredentials();
        sendResponse({
          isVerified: Boolean(credentials),
          verifiedAt
        });
        break;
      }
      case "verifyAndStoreCredentials": {
        const { publicKey, secretKey } = message.payload ?? {};
        await verifyCredentials(publicKey, secretKey);
        const verificationState = await storeCredentials(publicKey, secretKey);
        sendResponse({
          ok: true,
          verifiedAt: verificationState.verifiedAt
        });
        break;
      }
      case "refreshPanelData": {
        const panelData = await fetchPanelData(
          message.payload?.pageUrl ?? sender?.url ?? "",
          message.payload?.orderNumber ?? ""
        );
        sendResponse(panelData);
        break;
      }
      case "clearCredentials": {
        await clearCredentials();
        sendResponse({ ok: true });
        break;
      }
      default: {
        sendResponse({
          ok: false,
          error: `Unknown action: ${action}`
        });
      }
    }
  })().catch((error) => {
    console.error("Background action failed.", error);
    sendResponse({
      ok: false,
      error: error.message
    });
  });

  return true;
});
