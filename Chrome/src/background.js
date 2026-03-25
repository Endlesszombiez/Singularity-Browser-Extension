import { API_CONFIG, STORAGE_KEYS } from "./config.js";
import { decryptJson, encryptJson, getOrCreateEncryptionKey } from "./crypto.js";

const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;

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

async function fetchFilteredRows(url, params, headers) {
  const payload = await fetchJson(
    buildUrlWithParams(url, params),
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

async function fetchSalesOrderRecord(salesOrderId, orderNumber, headers) {
  if (orderNumber) {
    const externalIdRows = await fetchFilteredRows(
      API_CONFIG.salesOrdersUrl,
      {
        external_id: orderNumber,
        sort: "updated_at",
        dir: "desc",
        limit: 1
      },
      headers
    );

    if (externalIdRows[0]) {
      return externalIdRows[0];
    }
  }

  if (salesOrderId) {
    const katanaRows = await fetchFilteredRows(
      API_CONFIG.salesOrdersUrl,
      {
        katana_id: salesOrderId,
        sort: "updated_at",
        dir: "desc",
        limit: 1
      },
      headers
    );

    if (katanaRows[0]) {
      return katanaRows[0];
    }
  }

  throw new Error(`No sales order matched Katana ID "${salesOrderId || "N/A"}" or order number "${orderNumber || "N/A"}".`);
}

function buildCustomerLookupParams(customerToken, salesOrder) {
  const recordId = salesOrder?.customer_recordid ?? customerToken ?? "";
  const customerEmail = salesOrder?.customer_email ?? "";

  if (!recordId && !customerEmail) {
    return null;
  }

  return {
    recordid: recordId,
    email: customerEmail,
    sort: "last_sales_date",
    dir: "desc",
    limit: 1
  };
}

async function fetchCustomerRecord(customerToken, salesOrder, headers) {
  const params = buildCustomerLookupParams(customerToken, salesOrder);

  if (!params) {
    return null;
  }

  const payload = await fetchJson(
    buildUrlWithParams(API_CONFIG.customersUrl, params),
    {
      method: "GET",
      headers
    }
  );
  const rows = normalizeQueryRows(payload);
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
      salesOrderId: salesOrderRecord?.katana_id ?? salesOrderId,
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
