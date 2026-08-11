const API_CONFIG = {
  verificationUrl: "https://singularitysalesplatform.com/api/public/verify",
  customersUrl: "https://singularitysalesplatform.com/api/public/customers",
  salesOrdersUrl: "https://singularitysalesplatform.com/api/public/sales-orders",
  inventoryUrl: "https://singularitysalesplatform.com/api/public/inventory"
};

const STORAGE_KEYS = {
  credentials: "encryptedCredentials",
  wooCommerceSites: "encryptedWooCommerceSites",
  encryptionKey: "localEncryptionKey",
  onboarding: "verificationState",
  featureSettings: "featureSettings",
  katanaCredentials: "encryptedKatanaCredentials"
};

const DEFAULT_FEATURE_SETTINGS = {
  methodEnabled: true,
  katanaEnabled: true,
  googleMapsCrmEnabled: false
};

const WEBSITE_EMAIL_SCAN_MAX_BYTES = 250000;
const WEBSITE_EMAIL_SCAN_TIMEOUT_MS = 8000;
const WEBSITE_EMAIL_SCAN_PATH_HINTS = [
  "/contact",
  "/contact-us",
  "/about",
  "/about-us"
];

const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;
const actionApi = globalThis.browser?.action
  ?? globalThis.chrome?.action
  ?? globalThis.browser?.browserAction
  ?? globalThis.chrome?.browserAction;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

if (actionApi?.onClicked?.addListener && runtimeApi?.openOptionsPage) {
  actionApi.onClicked.addListener(() => {
    runtimeApi.openOptionsPage();
  });
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getOrCreateEncryptionKey(storageApiRef, storageKeyName) {
  const stored = await storageApiRef.get(storageKeyName);
  const existingKey = stored[storageKeyName];

  if (existingKey) {
    return existingKey;
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const base64Key = bytesToBase64(rawKey);
  await storageApiRef.set({ [storageKeyName]: base64Key });

  return base64Key;
}

async function importAesKey(base64Key) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(base64Key),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(value, base64Key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await importAesKey(base64Key);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(JSON.stringify(value))
  );

  return {
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(cipherBuffer))
  };
}

async function decryptJson(value, base64Key) {
  if (!value?.iv || !value?.payload) {
    return null;
  }

  const aesKey = await importAesKey(base64Key);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(value.iv) },
    aesKey,
    base64ToBytes(value.payload)
  );

  return JSON.parse(decoder.decode(plainBuffer));
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

async function getKatanaCredentials() {
  return readEncryptedStorage(STORAGE_KEYS.katanaCredentials);
}

async function clearKatanaApiKey() {
  await storageApi.remove(STORAGE_KEYS.katanaCredentials);
}

async function getFeatureSettings() {
  const stored = await storageApi.get(STORAGE_KEYS.featureSettings);
  const featureSettings = stored[STORAGE_KEYS.featureSettings] ?? {};

  return {
    ...DEFAULT_FEATURE_SETTINGS,
    ...Object.fromEntries(
      Object.entries(featureSettings).filter(([, value]) => typeof value === "boolean")
    )
  };
}

async function saveFeatureSettings(nextSettings = {}) {
  const existingSettings = await getFeatureSettings();
  const featureSettings = {
    ...existingSettings,
    methodEnabled: typeof nextSettings.methodEnabled === "boolean"
      ? nextSettings.methodEnabled
      : existingSettings.methodEnabled,
    katanaEnabled: typeof nextSettings.katanaEnabled === "boolean"
      ? nextSettings.katanaEnabled
      : existingSettings.katanaEnabled,
    googleMapsCrmEnabled: typeof nextSettings.googleMapsCrmEnabled === "boolean"
      ? nextSettings.googleMapsCrmEnabled
      : existingSettings.googleMapsCrmEnabled
  };

  await storageApi.set({ [STORAGE_KEYS.featureSettings]: featureSettings });
  return featureSettings;
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

async function katanaRequest(path, { apiKey, method = "GET", body } = {}) {
  const credentials = apiKey ? { apiKey } : await getKatanaCredentials();

  if (!credentials?.apiKey) {
    throw new Error("Add a Katana API key in the extension settings first.");
  }

  const response = await fetch(`https://api.katanamrp.com/v1${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const responseText = await response.text();
  let payload = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  if (!response.ok) {
    const detail = getErrorDetail(payload);
    throw new Error(`Katana request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  return payload;
}

async function verifyAndStoreKatanaApiKey(apiKey = "") {
  const normalizedApiKey = String(apiKey ?? "").trim();

  if (!normalizedApiKey) {
    throw new Error("Katana API key is required.");
  }

  await katanaRequest("/sales_orders?limit=1", { apiKey: normalizedApiKey });
  await writeEncryptedStorage(STORAGE_KEYS.katanaCredentials, { apiKey: normalizedApiKey });
  return { verifiedAt: new Date().toISOString() };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
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
    const detail = getErrorDetail(payload);
    const suffix = detail ? `: ${detail}` : ".";
    throw new Error(`Customer create failed with status ${response.status}${suffix}`);
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

async function fetchCompleteSspSalesOrder(orderNumber = "") {
  const normalizedOrderNumber = String(orderNumber ?? "").trim();

  if (!normalizedOrderNumber.startsWith("SSP")) {
    throw new Error("SSP order requests are only available for order numbers beginning with SSP.");
  }

  const { credentials } = await getStoredCredentials();

  if (!credentials) {
    return {
      ok: false,
      reason: "missing_credentials",
      error: "Verify Singularity API keys before requesting an SSP order."
    };
  }

  assertConfiguredEndpoint(API_CONFIG.salesOrdersUrl, "Sales orders");
  const headers = buildAuthHeaders(credentials);
  const resolvedLookup = await fetchSalesOrderByExternalId(normalizedOrderNumber, headers);
  const resolvedId = resolvedLookup.record?.id;

  if (resolvedLookup.payload?.ok !== true || Number(resolvedLookup.payload?.total) !== 1 || !resolvedId) {
    throw new Error("Sales order was not found for this organization.");
  }

  const fullPayload = await fetchJson(
    buildUrlWithParams(API_CONFIG.salesOrdersUrl, { id: resolvedId, limit: 1 }),
    { method: "GET", headers }
  );
  const order = fullPayload?.items?.[0];

  if (fullPayload?.ok !== true || Number(fullPayload?.total) !== 1 || !order) {
    throw new Error("Sales order was not found for this organization.");
  }

  return {
    ok: true,
    orderNumber: normalizedOrderNumber,
    order: clonePayload(order),
    apiPayload: clonePayload(fullPayload)
  };
}

function getKatanaResponseRecord(payload) {
  if (payload?.data && !Array.isArray(payload.data)) {
    return payload.data;
  }

  return payload;
}

function requireKatanaSalesOrderId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("The Katana sales order ID in the page URL is invalid.");
  }

  return id;
}

function parseRequiredNumber(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`${label} is missing or invalid.`);
  }

  return number;
}

function buildKatanaRowFromSsp(item, salesOrderId, index, resolvedVariantId) {
  const variantId = resolvedVariantId ?? item?.katana_id;
  const quantity = parseRequiredNumber(item?.qty ?? item?.quantity, `Line item ${index + 1} quantity`);
  const pricePerUnit = parseRequiredNumber(
    item?.unit_cents ?? item?.price_per_unit,
    `Line item ${index + 1} price per unit`
  );
  const discountPercent = Number(item?.discount_percent ?? 0);

  if (variantId === undefined || variantId === null || variantId === "") {
    throw new Error(`Line item ${index + 1} does not have an SSP katana_id mapping.`);
  }

  const normalizedVariantId = parseRequiredNumber(variantId, `Line item ${index + 1} katana_id`);

  if (!Number.isInteger(normalizedVariantId) || normalizedVariantId <= 0) {
    throw new Error(`Line item ${index + 1} does not have a valid SSP katana_id mapping.`);
  }

  if (quantity <= 0 || pricePerUnit < 0) {
    throw new Error(`Line item ${index + 1} quantity and price must be valid positive values.`);
  }

  return {
    sales_order_id: salesOrderId,
    variant_id: normalizedVariantId,
    quantity,
    price_per_unit: pricePerUnit,
    total_discount: Number.isFinite(discountPercent)
      ? Number((quantity * pricePerUnit * discountPercent / 100).toFixed(10))
      : 0
  };
}

async function resolveKatanaVariantIdForSspItem(item, index) {
  const directVariantId = item?.katana_id;

  if (directVariantId !== undefined && directVariantId !== null && directVariantId !== "") {
    return {
      variantId: directVariantId,
      source: "ssp"
    };
  }

  const sku = String(item?.sku ?? "").trim();

  if (!sku) {
    throw new Error(
      `Line item ${index + 1} has no SSP katana_id and no SKU for a Katana fallback lookup.`
    );
  }

  const payload = await katanaRequest(`/variants?sku=${encodeURIComponent(sku)}&limit=50`);
  const normalizedSku = sku.toLowerCase();
  const matches = normalizeQueryRows(payload).filter(
    (variant) => String(variant?.sku ?? "").trim().toLowerCase() === normalizedSku
  );

  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `Katana returned multiple exact variant matches for SKU "${sku}".`
        : `SSP did not return katana_id and Katana has no exact variant match for SKU "${sku}".`
    );
  }

  return {
    variantId: matches[0]?.id ?? matches[0]?.variant_id,
    source: "katana_sku_fallback"
  };
}

async function enrichSspOrderWithKatanaIds(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const resolved = await Promise.all(
    items.map(async (item, index) => {
      try {
        return await resolveKatanaVariantIdForSspItem(item, index);
      } catch (error) {
        return {
          variantId: item?.katana_id ?? null,
          source: "unresolved",
          error: error instanceof Error ? error.message : "Katana ID resolution failed."
        };
      }
    })
  );

  return {
    ...order,
    items: items.map((item, index) => ({
      ...item,
      katana_id: resolved[index].variantId,
      ...(resolved[index].source === "ssp"
        ? {}
        : {
            katana_id_source: resolved[index].source,
            ...(resolved[index].error ? { katana_id_error: resolved[index].error } : {})
          })
    }))
  };
}

function splitFullName(value = "") {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || null,
    last_name: parts.length ? parts.join(" ") : null
  };
}

function buildKatanaAddressFromSsp(order, type) {
  const name = splitFullName(order?.fullname);
  const prefix = type === "billing" ? "billing" : "shipping";
  const line1 = order?.[`${prefix}_line1`];
  const line2 = order?.[`${prefix}_line2`];
  const line3 = order?.[`${prefix}_line3`];
  const line4 = order?.[`${prefix}_line4`];
  const hasExpandedAddressLines = Boolean(line3);

  return {
    ...name,
    company: hasExpandedAddressLines ? line1 ?? order?.companyname ?? null : order?.companyname ?? null,
    line_1: line3 ?? line1 ?? null,
    line_2: [line2, line4].filter(Boolean).join(", ") || null,
    city: order?.[`${prefix}_city`] ?? null,
    state: order?.[`${prefix}_state`] ?? null,
    zip: order?.[`${prefix}_postal_code`] ?? null,
    country: order?.[`${prefix}_country`] ?? null
  };
}

function normalizeAddressValue(value, field) {
  let normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (field === "country") {
    const countryAliases = {
      "united states": "us",
      "united states of america": "us",
      usa: "us"
    };
    normalized = countryAliases[normalized] ?? normalized;
  }

  if (field === "zip") {
    return normalized.replace(/[\s-]/g, "");
  }

  return normalized
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressForComparison(address = {}) {
  // Recipient and company labels do not change the physical delivery destination,
  // so alerts compare only the address fields that affect where a parcel is sent.
  const fields = ["line_1", "line_2", "city", "state", "zip", "country"];
  return fields.map((field) => normalizeAddressValue(address?.[field], field)).join("|");
}

async function getKatanaOrderContext(salesOrderId) {
  const id = requireKatanaSalesOrderId(salesOrderId);
  const [orderPayload, rowPayload, addressPayload] = await Promise.all([
    katanaRequest(`/sales_orders/${id}`),
    katanaRequest(`/sales_order_rows?sales_order_ids=${id}&limit=50`),
    katanaRequest(`/sales_order_addresses?sales_order_ids=${id}&limit=50`)
  ]);

  return {
    id,
    order: getKatanaResponseRecord(orderPayload),
    rows: normalizeQueryRows(rowPayload),
    addresses: normalizeQueryRows(addressPayload)
  };
}

async function getSspAndKatanaOrder(orderNumber, salesOrderId) {
  const [sspResult, katana] = await Promise.all([
    fetchCompleteSspSalesOrder(orderNumber),
    getKatanaOrderContext(salesOrderId)
  ]);

  if (!sspResult.ok) {
    throw new Error(sspResult.error ?? "Unable to load the SSP sales order.");
  }

  return { ssp: sspResult.order, katana };
}

async function checkSspKatanaAddressMismatch(orderNumber, salesOrderId) {
  const { ssp, katana } = await getSspAndKatanaOrder(orderNumber, salesOrderId);
  const differences = ["shipping", "billing"].filter((type) => {
    const current = katana.addresses.find((address) => address.entity_type === type);
    return normalizeAddressForComparison(current) !== normalizeAddressForComparison(buildKatanaAddressFromSsp(ssp, type));
  });

  return {
    ok: true,
    hasMismatch: differences.length > 0,
    differences
  };
}

async function overwriteKatanaLineItems(orderNumber, salesOrderId) {
  const { ssp, katana } = await getSspAndKatanaOrder(orderNumber, salesOrderId);

  if (!["NOT_SHIPPED", "PENDING"].includes(katana.order?.status)) {
    throw new Error(`Katana order rows cannot be changed while the order status is ${katana.order?.status ?? "unknown"}.`);
  }

  const sspItems = Array.isArray(ssp.items) ? ssp.items : [];
  const resolvedVariantIds = await Promise.all(
    sspItems.map((item, index) => resolveKatanaVariantIdForSspItem(item, index))
  );
  const desiredRows = sspItems.map(
    (item, index) => buildKatanaRowFromSsp(item, katana.id, index, resolvedVariantIds[index].variantId)
  );

  if (!desiredRows.length) {
    throw new Error("SSP returned no line items; the Katana order was not changed.");
  }

  const sharedCount = Math.min(katana.rows.length, desiredRows.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const { sales_order_id, ...body } = desiredRows[index];
    await katanaRequest(`/sales_order_rows/${katana.rows[index].id}`, { method: "PATCH", body });
  }

  for (let index = sharedCount; index < desiredRows.length; index += 1) {
    await katanaRequest("/sales_order_rows", { method: "POST", body: desiredRows[index] });
  }

  for (let index = sharedCount; index < katana.rows.length; index += 1) {
    await katanaRequest(`/sales_order_rows/${katana.rows[index].id}`, { method: "DELETE" });
  }

  return { ok: true, updatedCount: desiredRows.length };
}

async function overwriteKatanaAddresses(orderNumber, salesOrderId) {
  const { ssp, katana } = await getSspAndKatanaOrder(orderNumber, salesOrderId);
  const updated = [];

  for (const type of ["billing", "shipping"]) {
    const address = buildKatanaAddressFromSsp(ssp, type);
    const current = katana.addresses.find((entry) => entry.entity_type === type);

    if (current?.id) {
      await katanaRequest(`/sales_order_addresses/${current.id}`, { method: "PATCH", body: address });
    } else {
      await katanaRequest("/sales_order_addresses", {
        method: "POST",
        body: { sales_order_id: katana.id, entity_type: type, ...address }
      });
    }
    updated.push(type);
  }

  return { ok: true, updated };
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

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function findEmailInText(value) {
  const match = String(value ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return normalizeEmail(match?.[0] ?? "");
}

function normalizeWebsiteUrl(value) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    throw new Error("A website URL is required.");
  }

  const url = new URL(/^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS websites can be scanned.");
  }

  url.hash = "";
  return url;
}

async function fetchWebsiteText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBSITE_EMAIL_SCAN_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Website returned status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Website did not return a readable page.");
    }

    return (await response.text()).slice(0, WEBSITE_EMAIL_SCAN_MAX_BYTES);
  } finally {
    clearTimeout(timeoutId);
  }
}

function getContactPageCandidates(baseUrl, html) {
  const candidates = new Set();

  for (const path of WEBSITE_EMAIL_SCAN_PATH_HINTS) {
    candidates.add(new URL(path, baseUrl).toString());
  }

  const linkMatches = String(html ?? "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis);

  for (const match of linkMatches) {
    const href = match?.[1] ?? "";
    const label = match?.[2]?.replace(/<[^>]+>/g, " ") ?? "";

    if (!/contact|about|support|team/i.test(`${href} ${label}`)) {
      continue;
    }

    try {
      const candidateUrl = new URL(href, baseUrl);

      if (candidateUrl.origin === baseUrl.origin && ["http:", "https:"].includes(candidateUrl.protocol)) {
        candidateUrl.hash = "";
        candidates.add(candidateUrl.toString());
      }
    } catch {
      // Ignore malformed links found in third-party websites.
    }
  }

  return [...candidates].slice(0, 6);
}

async function findEmailOnWebsite(websiteUrl) {
  const baseUrl = normalizeWebsiteUrl(websiteUrl);
  const homeHtml = await fetchWebsiteText(baseUrl);
  const homeEmail = findEmailInText(homeHtml);

  if (homeEmail) {
    return {
      ok: true,
      email: homeEmail,
      sourceUrl: baseUrl.toString()
    };
  }

  const contactUrls = getContactPageCandidates(baseUrl, homeHtml);
  const errors = [];

  for (const contactUrl of contactUrls) {
    try {
      const contactHtml = await fetchWebsiteText(new URL(contactUrl));
      const contactEmail = findEmailInText(contactHtml);

      if (contactEmail) {
        return {
          ok: true,
          email: contactEmail,
          sourceUrl: contactUrl
        };
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    ok: false,
    error: errors.length
      ? `No contact email found. ${errors.slice(0, 2).join(" ")}`
      : "No contact email found on the website."
  };
}

function normalizeGoogleMapsCustomerPayload(payload = {}) {
  const email = normalizeEmail(payload.email);
  const companyName = normalizeDisplayText(payload.companyName, "");

  if (!email) {
    throw new Error("A contact email address is required before adding a Google Maps business.");
  }

  if (!companyName) {
    throw new Error("A business name is required before adding a Google Maps business.");
  }

  return {
    companyname: companyName,
    email,
    phone: normalizeDisplayText(payload.phone, ""),
    website: normalizeDisplayText(payload.website, ""),
    billing_line1: normalizeDisplayText(payload.address, ""),
    source: "Google Maps",
    source_url: normalizeDisplayText(payload.sourceUrl, "")
  };
}

async function findCustomerByEmail(email, headers) {
  const payload = await fetchJson(
    buildUrlWithParams(API_CONFIG.customersUrl, {
      email,
      limit: 1
    }),
    {
      method: "GET",
      headers
    }
  );
  const rows = normalizeQueryRows(payload);
  const normalizedEmail = normalizeEmail(email);

  return rows.find((row) => normalizeEmail(row?.email) === normalizedEmail) ?? rows[0] ?? null;
}

async function createCustomerFromGoogleMaps(payload = {}) {
  const { credentials } = await getStoredCredentials();

  if (!credentials) {
    return {
      ok: false,
      status: "missing_credentials",
      error: "Verify Singularity API keys before adding Google Maps businesses."
    };
  }

  assertConfiguredEndpoint(API_CONFIG.customersUrl, "Customers");
  const customerPayload = normalizeGoogleMapsCustomerPayload(payload);
  const headers = buildAuthHeaders(credentials);
  const existingCustomer = await findCustomerByEmail(customerPayload.email, headers);

  if (existingCustomer) {
    return {
      ok: true,
      status: "already_exists",
      customer: summarizeCustomer(existingCustomer)
    };
  }

  const createdPayload = await postJson(API_CONFIG.customersUrl, customerPayload, headers);

  return {
    ok: true,
    status: "created",
    customer: summarizeCustomer(Array.isArray(createdPayload) ? createdPayload[0] : createdPayload),
    apiPayload: clonePayload(createdPayload)
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
        const [{ credentials, verifiedAt }, wooCommerceSites, katanaCredentials] = await Promise.all([
          getStoredCredentials(),
          getWooCommerceSites(),
          getKatanaCredentials()
        ]);
        sendResponse({
          isVerified: Boolean(credentials),
          verifiedAt,
          wooCommerceSiteCount: wooCommerceSites.length,
          hasKatanaApiKey: Boolean(katanaCredentials?.apiKey)
        });
        break;
      }
      case "verifyAndStoreKatanaApiKey": {
        const state = await verifyAndStoreKatanaApiKey(message.payload?.apiKey ?? "");
        sendResponse({ ok: true, verifiedAt: state.verifiedAt });
        break;
      }
      case "clearKatanaApiKey": {
        await clearKatanaApiKey();
        sendResponse({ ok: true });
        break;
      }
      case "getFeatureSettings": {
        const featureSettings = await getFeatureSettings();
        sendResponse({
          ok: true,
          featureSettings
        });
        break;
      }
      case "saveFeatureSettings": {
        const featureSettings = await saveFeatureSettings(message.payload ?? {});
        sendResponse({
          ok: true,
          featureSettings
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
      case "requestSspSalesOrder": {
        const result = await fetchCompleteSspSalesOrder(message.payload?.orderNumber ?? "");
        const order = result.ok ? await enrichSspOrderWithKatanaIds(result.order) : result.order;
        sendResponse({
          ...result,
          order
        });
        break;
      }
      case "checkSspKatanaAddressMismatch": {
        const result = await checkSspKatanaAddressMismatch(
          message.payload?.orderNumber ?? "",
          message.payload?.salesOrderId ?? ""
        );
        sendResponse(result);
        break;
      }
      case "overwriteKatanaLineItems": {
        const result = await overwriteKatanaLineItems(
          message.payload?.orderNumber ?? "",
          message.payload?.salesOrderId ?? ""
        );
        sendResponse(result);
        break;
      }
      case "overwriteKatanaAddresses": {
        const result = await overwriteKatanaAddresses(
          message.payload?.orderNumber ?? "",
          message.payload?.salesOrderId ?? ""
        );
        sendResponse(result);
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
      case "createCustomerFromGoogleMaps": {
        const result = await createCustomerFromGoogleMaps(message.payload ?? {});
        sendResponse(result);
        break;
      }
      case "findEmailOnWebsite": {
        const result = await findEmailOnWebsite(message.payload?.website ?? "");
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
