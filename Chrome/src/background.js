import { API_CONFIG, STORAGE_KEYS } from "./config.js";
import { decryptJson, encryptJson, getOrCreateEncryptionKey } from "./crypto.js";

const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;
const actionApi = globalThis.browser?.action
  ?? globalThis.chrome?.action
  ?? globalThis.browser?.browserAction
  ?? globalThis.chrome?.browserAction;

if (actionApi?.onClicked?.addListener && runtimeApi?.openOptionsPage) {
  actionApi.onClicked.addListener(() => {
    runtimeApi.openOptionsPage();
  });
}

async function getEncryptionKeyMaterial() {
  return getOrCreateEncryptionKey(storageApi, STORAGE_KEYS.encryptionKey);
}

async function readEncryptedStorage(storageKey) {
  const keyMaterial = await getEncryptionKeyMaterial();
  const stored = await storageApi.get(storageKey);
  const encryptedValue = stored[storageKey];

  if (!encryptedValue) {
    return null;
  }

  try {
    return await decryptJson(encryptedValue, keyMaterial);
  } catch (error) {
    console.error(`Unable to decrypt stored value for ${storageKey}.`, error);
    return null;
  }
}

async function writeEncryptedStorage(storageKey, value) {
  const keyMaterial = await getEncryptionKeyMaterial();
  const encryptedValue = await encryptJson(value, keyMaterial);
  await storageApi.set({ [storageKey]: encryptedValue });
}

async function getStoredCredentials() {
  const [credentials, onboardingState] = await Promise.all([
    readEncryptedStorage(STORAGE_KEYS.credentials),
    storageApi.get(STORAGE_KEYS.onboarding)
  ]);

  return {
    credentials,
    verifiedAt: onboardingState[STORAGE_KEYS.onboarding]?.verifiedAt ?? null
  };
}

async function getWooCommerceSites() {
  const storedSites = await readEncryptedStorage(STORAGE_KEYS.wooCommerceSites);
  return Array.isArray(storedSites) ? storedSites : [];
}

async function storeWooCommerceSites(sites) {
  await writeEncryptedStorage(STORAGE_KEYS.wooCommerceSites, sites);
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

function buildAuthHeaders(credentials) {
  return {
    "x-ssp-public-key": credentials.publicKey,
    "x-ssp-secret-key": credentials.secretKey
  };
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
  const verificationState = {
    verifiedAt: new Date().toISOString()
  };

  await Promise.all([
    writeEncryptedStorage(STORAGE_KEYS.credentials, { publicKey, secretKey }),
    storageApi.set({ [STORAGE_KEYS.onboarding]: verificationState })
  ]);

  return verificationState;
}

async function clearCredentials() {
  await storageApi.remove([STORAGE_KEYS.credentials, STORAGE_KEYS.onboarding]);
}

function getErrorDetail(payload) {
  if (typeof payload !== "string") {
    return payload?.error ?? payload?.message ?? "";
  }

  const trimmed = payload.trim();

  if (!trimmed || /^<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function isSensitiveDebugParam(key) {
  return /(key|secret|token|auth|password|signature)/i.test(String(key ?? ""));
}

function sanitizeUrlForDebug(url) {
  try {
    const parsedUrl = new URL(url);
    const searchParamKeys = [...parsedUrl.searchParams.keys()];

    for (const key of searchParamKeys) {
      if (isSensitiveDebugParam(key)) {
        parsedUrl.searchParams.set(key, "[redacted]");
      }
    }

    return parsedUrl.toString();
  } catch {
    return String(url ?? "");
  }
}

function appendRequestDebugTrace(debugTrace, url, options = {}) {
  if (!Array.isArray(debugTrace)) {
    return;
  }

  const method = String(options.method ?? "GET").toUpperCase();

  if (method !== "GET") {
    return;
  }

  debugTrace.push(`${method} ${sanitizeUrlForDebug(url)}`);
}

function summarizeDebugPayload(payload) {
  if (payload === undefined) {
    return "undefined";
  }

  if (payload === null) {
    return "null";
  }

  let summary = "";

  if (typeof payload === "string") {
    summary = payload;
  } else {
    try {
      summary = JSON.stringify(payload);
    } catch {
      summary = String(payload);
    }
  }

  const singleLineSummary = summary.replace(/\s+/g, " ").trim();
  return singleLineSummary.length > 400
    ? `${singleLineSummary.slice(0, 400)}...`
    : singleLineSummary;
}

function appendResponseDebugTrace(debugTrace, url, response, payload) {
  if (!Array.isArray(debugTrace)) {
    return;
  }

  const method = String(response?.url ? "GET" : "GET").toUpperCase();

  if (method !== "GET") {
    return;
  }

  debugTrace.push(
    `${response.status} ${response.statusText || "Response"} ${sanitizeUrlForDebug(response.url || url)}`
  );
  debugTrace.push(`Response body: ${summarizeDebugPayload(payload)}`);
}

async function fetchJson(url, options, debugTrace) {
  appendRequestDebugTrace(debugTrace, url, options);
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

  appendResponseDebugTrace(debugTrace, url, response, payload);
  console.debug("[Singularity] GET response", {
    url: sanitizeUrlForDebug(response.url || url),
    status: response.status,
    ok: response.ok,
    bodyPreview: summarizeDebugPayload(payload)
  });

  if (!response.ok) {
    const detail = getErrorDetail(payload);
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

function formatCurrencyAmount(amount, currency = "USD") {
  const parsedAmount = typeof amount === "number"
    ? amount
    : Number.parseFloat(String(amount ?? "").replace(/,/g, "").trim());

  if (!Number.isFinite(parsedAmount)) {
    return "N/A";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(parsedAmount);
  } catch {
    return `${parsedAmount.toFixed(2)} ${currency}`;
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

function normalizeDisplayText(value, fallback) {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value)
    .split(/\s+/)
    .filter((part) => part && part.toLowerCase() !== "none")
    .join(" ")
    .trim();

  return normalized || fallback;
}

function summarizeCustomer(customer = {}) {
  const fullName = customer.fullname
    ?? [customer.firstname, customer.lastname].filter(Boolean).join(" ").trim();

  return {
    companyName: normalizeDisplayText(customer.companyname, "Unknown company"),
    contactName: normalizeDisplayText(fullName, "Unknown"),
    assignedTo: normalizeDisplayText(
      customer.assigned_user?.display_name ?? customer.assignedto_display_name,
      "Unassigned"
    ),
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
    companyName: normalizeDisplayText(order.companyname, "Unknown company"),
    contactName: normalizeDisplayText(order.fullname, "Unknown"),
    totalValue: formatCurrencyAmount(order.total_cents, order.currency ?? "USD"),
    shippingCost: formatCurrencyAmount(order.shipping_cost_cents, order.currency ?? "USD"),
    status: order.status ?? "Unknown",
    externalId: order.external_id ?? String(order.id ?? "N/A"),
    customerEmail: order.customer_email ?? "N/A",
    createdAt: order.created_at ?? "Unavailable",
    updatedAt: order.updated_at ?? "Unavailable",
    assignedTo: normalizeDisplayText(order.assigned_user?.display_name, "Unassigned"),
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

function clonePayload(payload) {
  if (payload === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
}

async function fetchSalesOrderRecord(salesOrderId, orderNumber, headers) {
  let lookupError = null;

  if (orderNumber) {
    try {
      const externalIdPayload = await fetchJson(
        buildUrlWithParams(API_CONFIG.salesOrdersUrl, {
          external_id: orderNumber,
          sort: "updated_at",
          dir: "desc",
          limit: 1
        }),
        {
          method: "GET",
          headers
        }
      );
      const externalIdRows = normalizeQueryRows(externalIdPayload);

      if (externalIdRows[0]) {
        return {
          record: externalIdRows[0],
          payload: clonePayload(externalIdPayload)
        };
      }
    } catch (error) {
      lookupError = error;
    }
  }

  if (salesOrderId) {
    try {
      const katanaPayload = await fetchJson(
        buildUrlWithParams(API_CONFIG.salesOrdersUrl, {
          katana_id: salesOrderId,
          sort: "updated_at",
          dir: "desc",
          limit: 1
        }),
        {
          method: "GET",
          headers
        }
      );
      const katanaRows = normalizeQueryRows(katanaPayload);

      if (katanaRows[0]) {
        const katanaRecord = katanaRows[0];
        const normalizedExternalId = String(katanaRecord.external_id ?? "").trim().toLowerCase();
        const normalizedOrderNumber = String(orderNumber ?? "").trim().toLowerCase();

        if (!normalizedOrderNumber || !normalizedExternalId || normalizedExternalId === normalizedOrderNumber) {
          return {
            record: katanaRecord,
            payload: clonePayload(katanaPayload)
          };
        }
      }
    } catch (error) {
      lookupError = lookupError ?? error;
    }
  }

  if (lookupError) {
    throw lookupError;
  }

  throw new Error(`No sales order matched Katana ID "${salesOrderId || "N/A"}" or order number "${orderNumber || "N/A"}".`);
}

async function fetchSalesOrderByExternalId(externalId, headers) {
  const debugTrace = [];
  const payload = await fetchJson(
    buildUrlWithParams(API_CONFIG.salesOrdersUrl, {
      external_id: externalId,
      sort: "updated_at",
      dir: "desc",
      limit: 1
    }),
    {
      method: "GET",
      headers
    },
    debugTrace
  );
  const rows = normalizeQueryRows(payload);

  return {
    record: rows[0] ?? null,
    payload: clonePayload(payload),
    debugTrace
  };
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
    return {
      record: null,
      payload: null
    };
  }

  const payload = await fetchJson(
    buildUrlWithParams(API_CONFIG.customersUrl, params),
    {
      method: "GET",
      headers
    }
  );
  const rows = normalizeQueryRows(payload);
  return {
    record: rows[0] ?? null,
    payload: clonePayload(payload)
  };
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
  const salesOrderResponse = await fetchSalesOrderRecord(salesOrderId, orderNumber, headers);
  const salesOrderRecord = salesOrderResponse.record;
  const customerResponse = await fetchCustomerRecord(customerId, salesOrderRecord, headers);
  const customerRecord = customerResponse.record;

  return {
    ok: true,
    meta: {
      salesOrderId: salesOrderRecord?.katana_id ?? salesOrderId,
      customerId: salesOrderRecord?.customer_recordid ?? customerRecord?.recordid ?? customerId,
      refreshedAt: new Date().toISOString()
    },
    apiPayloads: {
      salesOrder: salesOrderResponse.payload,
      customer: customerResponse.payload
    },
    customer: summarizeCustomer(customerRecord ?? {}),
    salesOrder: summarizeSalesOrder(salesOrderRecord ?? {})
  };
}

async function checkMethodOrderSync(invoiceNumber = "") {
  const { credentials } = await getStoredCredentials();
  console.debug("[Singularity] checkMethodOrderSync start", {
    invoiceNumber: String(invoiceNumber ?? "").trim(),
    hasCredentials: Boolean(credentials)
  });

  if (!credentials) {
    return {
      ok: false,
      reason: "missing_credentials",
      error: "Sync check unavailable until Katana credentials are verified."
    };
  }

  const normalizedInvoiceNumber = String(invoiceNumber ?? "").trim();

  if (!normalizedInvoiceNumber) {
    return {
      ok: true,
      status: "not_synced"
    };
  }

  assertConfiguredEndpoint(API_CONFIG.salesOrdersUrl, "Sales orders");
  const headers = buildAuthHeaders(credentials);
  const invoiceExternalId = normalizedInvoiceNumber;
  const estimateExternalId = normalizedInvoiceNumber;
  const [invoiceLookup, estimateLookup] = await Promise.all([
    fetchSalesOrderByExternalId(invoiceExternalId, headers),
    fetchSalesOrderByExternalId(estimateExternalId, headers)
  ]);
  const debugTrace = [
    ...(invoiceLookup.debugTrace ?? []),
    ...(estimateLookup.debugTrace ?? [])
  ];
  console.debug("[Singularity] checkMethodOrderSync lookup results", {
    invoiceNumber: normalizedInvoiceNumber,
    invoiceMatched: Boolean(invoiceLookup.record),
    estimateMatched: Boolean(estimateLookup.record),
    debugTrace
  });

  if (estimateLookup.record) {
    return {
      ok: true,
      status: "hidden",
      invoiceNumber: normalizedInvoiceNumber,
      matchedExternalId: estimateExternalId,
      debugTrace
    };
  }

  if (invoiceLookup.record) {
    return {
      ok: true,
      status: "synced",
      invoiceNumber: normalizedInvoiceNumber,
      matchedExternalId: invoiceExternalId,
      debugTrace
    };
  }

  return {
    ok: true,
    status: "not_synced",
    invoiceNumber: normalizedInvoiceNumber,
    debugTrace
  };
}

function normalizeSku(value) {
  return String(value ?? "").trim().toLowerCase();
}

async function fetchInventoryBySku(itemSku) {
  const { credentials } = await getStoredCredentials();

  if (!credentials) {
    return {
      ok: false,
      reason: "missing_credentials"
    };
  }

  const normalizedSku = normalizeSku(itemSku);

  if (!normalizedSku) {
    return {
      ok: true,
      inventory: null
    };
  }

  assertConfiguredEndpoint(API_CONFIG.inventoryUrl, "Inventory");
  const headers = buildAuthHeaders(credentials);
  const itemUrl = buildUrlWithParams(API_CONFIG.inventoryUrl, {
    itemsku: itemSku
  });
  const debugTrace = [];
  const inventoryPayload = await fetchJson(
    itemUrl,
    {
      method: "GET",
      headers
    },
    debugTrace
  );
  const inventoryRecord = inventoryPayload?.item ?? null;

  return {
    ok: true,
    apiPayload: clonePayload(inventoryPayload),
    debugTrace,
    inventory: inventoryRecord && normalizeSku(inventoryRecord?.itemsku) === normalizedSku
      ? inventoryRecord
      : null
  };
}

function normalizeWooCommerceBaseUrl(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new Error("WooCommerce site URL is required.");
  }

  const url = new URL(normalized.startsWith("http") ? normalized : `https://${normalized}`);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeWooCommerceSiteInput(site = {}) {
  const baseUrl = normalizeWooCommerceBaseUrl(site.baseUrl);
  const consumerKey = String(site.consumerKey ?? "").trim();
  const consumerSecret = String(site.consumerSecret ?? "").trim();
  const label = String(site.label ?? "").trim() || new URL(baseUrl).hostname;

  if (!consumerKey || !consumerSecret) {
    throw new Error("WooCommerce consumer key and secret are required.");
  }

  return {
    id: site.id ?? `${baseUrl.toLowerCase()}::${label.toLowerCase()}`,
    label,
    baseUrl,
    consumerKey,
    consumerSecret
  };
}

function buildWooCommerceApiUrl(site, path, params = {}) {
  return buildUrlWithParams(`${site.baseUrl}${path}`, {
    consumer_key: site.consumerKey,
    consumer_secret: site.consumerSecret,
    ...params
  });
}

async function verifyWooCommerceSite(siteInput) {
  const site = normalizeWooCommerceSiteInput(siteInput);
  const payload = await fetchJson(
    buildWooCommerceApiUrl(site, "/wp-json/wc/v3/orders", { per_page: 1 }),
    { method: "GET" }
  );

  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected WooCommerce response for ${site.label}.`);
  }

  return site;
}

function sanitizeWooCommerceSite(site) {
  return {
    id: site.id,
    label: site.label,
    baseUrl: site.baseUrl,
    consumerKeyHint: site.consumerKey ? `${site.consumerKey.slice(0, 6)}...` : "",
    consumerSecretHint: site.consumerSecret ? `${site.consumerSecret.slice(0, 4)}...` : ""
  };
}

async function saveWooCommerceSite(siteInput) {
  const site = await verifyWooCommerceSite(siteInput);
  const existingSites = await getWooCommerceSites();
  const sitesWithoutMatch = existingSites.filter((entry) => entry.id !== site.id && entry.baseUrl !== site.baseUrl);
  const nextSites = [...sitesWithoutMatch, site];
  await storeWooCommerceSites(nextSites);
  return sanitizeWooCommerceSite(site);
}

async function removeWooCommerceSite(siteId) {
  const existingSites = await getWooCommerceSites();
  const nextSites = existingSites.filter((entry) => entry.id !== siteId);
  await storeWooCommerceSites(nextSites);
}

async function clearWooCommerceSites() {
  await storageApi.remove(STORAGE_KEYS.wooCommerceSites);
}

function buildWooCommerceAddress(address = {}) {
  const lines = [address.address_1, address.address_2].filter(Boolean);
  const locality = [address.city, address.state, address.postcode].filter(Boolean).join(", ");

  if (locality) {
    lines.push(locality);
  }

  if (address.country) {
    lines.push(address.country);
  }

  return {
    name: [address.first_name, address.last_name].filter(Boolean).join(" ").trim() || "N/A",
    company: address.company || "N/A",
    addressText: lines.join(", ") || "N/A",
    email: address.email || "N/A",
    phone: address.phone || "N/A"
  };
}

function normalizeWooCommerceOrderMatch(orderNumber, orders) {
  const normalizedTarget = String(orderNumber ?? "").trim().toLowerCase();

  return orders.find((order) => {
    const candidateValues = [
      order?.number,
      order?.id,
      order?.parent_id,
      order?.transaction_id
    ];

    return candidateValues.some((value) => String(value ?? "").trim().toLowerCase() === normalizedTarget);
  }) ?? null;
}

function summarizeWooCommerceOrder(site, order) {
  const currency = order?.currency || "USD";
  const billing = buildWooCommerceAddress(order?.billing ?? {});
  const shipping = buildWooCommerceAddress(order?.shipping ?? {});
  const shippingLines = Array.isArray(order?.shipping_lines) ? order.shipping_lines : [];
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  return {
    site: {
      id: site.id,
      label: site.label,
      baseUrl: site.baseUrl
    },
    order: {
      id: order?.id ?? "N/A",
      number: order?.number ?? String(order?.id ?? "N/A"),
      status: order?.status ?? "unknown",
      createdAt: order?.date_created ?? "Unavailable",
      total: formatCurrencyAmount(order?.total, currency),
      currency,
      paymentMethod: order?.payment_method_title || "N/A"
    },
    customer: {
      name: billing.name !== "N/A" ? billing.name : shipping.name,
      email: billing.email,
      phone: billing.phone
    },
    billing,
    shipping,
    items: lineItems.map((item) => ({
      name: item?.name || "Unnamed item",
      sku: item?.sku || "N/A",
      quantity: item?.quantity ?? 0,
      total: formatCurrencyAmount(item?.total, currency)
    })),
    shippingLines: shippingLines.map((line) => ({
      method: line?.method_title || "Shipping",
      total: formatCurrencyAmount(line?.total, currency),
      tracking: line?.tracking_number || line?.meta_data?.find?.((entry) => /tracking/i.test(String(entry?.key ?? "")))?.value || "N/A"
    }))
  };
}

async function fetchWooCommerceOrder(orderNumber) {
  const sites = await getWooCommerceSites();

  if (!sites.length) {
    return {
      ok: false,
      reason: "missing_woocommerce_sites",
      error: "No WooCommerce sites are configured yet."
    };
  }

  const normalizedOrderNumber = String(orderNumber ?? "").trim();

  if (!normalizedOrderNumber) {
    return {
      ok: false,
      error: "Order number is required for WooCommerce lookup."
    };
  }

  const errors = [];

  for (const site of sites) {
    try {
      const payload = await fetchJson(
        buildWooCommerceApiUrl(site, "/wp-json/wc/v3/orders", {
          search: normalizedOrderNumber,
          per_page: 20
        }),
        { method: "GET" }
      );

      const orders = Array.isArray(payload) ? payload : [];
      const matchedOrder = normalizeWooCommerceOrderMatch(normalizedOrderNumber, orders);

      if (!matchedOrder) {
        continue;
      }

      return {
        ok: true,
        site: sanitizeWooCommerceSite(site),
        order: summarizeWooCommerceOrder(site, matchedOrder),
        apiPayload: clonePayload(payload)
      };
    } catch (error) {
      errors.push(`${site.label}: ${error.message}`);
    }
  }

  return {
    ok: false,
    error: errors.length
      ? `No WooCommerce order match found. ${errors.join(" | ")}`
      : `No WooCommerce order matched "${normalizedOrderNumber}".`
  };
}

runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;

  (async () => {
    switch (action) {
      case "getAuthState": {
        const [{ credentials, verifiedAt }, wooCommerceSites] = await Promise.all([
          getStoredCredentials(),
          getWooCommerceSites()
        ]);
        sendResponse({
          isVerified: Boolean(credentials),
          verifiedAt,
          wooCommerceSiteCount: wooCommerceSites.length
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
      case "fetchInventoryBySku": {
        const inventoryData = await fetchInventoryBySku(message.payload?.itemSku ?? "");
        sendResponse(inventoryData);
        break;
      }
      case "checkMethodOrderSync": {
        console.debug("[Singularity] runtime message received", {
          action,
          invoiceNumber: message.payload?.invoiceNumber ?? ""
        });
        const syncStatus = await checkMethodOrderSync(message.payload?.invoiceNumber ?? "");
        console.debug("[Singularity] runtime message response", {
          action,
          syncStatus
        });
        sendResponse(syncStatus);
        break;
      }
      case "getWooCommerceSites": {
        const sites = await getWooCommerceSites();
        sendResponse({
          ok: true,
          sites: sites.map(sanitizeWooCommerceSite)
        });
        break;
      }
      case "saveWooCommerceSite": {
        const site = await saveWooCommerceSite(message.payload ?? {});
        sendResponse({
          ok: true,
          site
        });
        break;
      }
      case "removeWooCommerceSite": {
        await removeWooCommerceSite(message.payload?.siteId ?? "");
        sendResponse({ ok: true });
        break;
      }
      case "clearWooCommerceSites": {
        await clearWooCommerceSites();
        sendResponse({ ok: true });
        break;
      }
      case "lookupWooCommerceOrder": {
        const result = await fetchWooCommerceOrder(message.payload?.orderNumber ?? "");
        sendResponse(result);
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
