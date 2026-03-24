const API_CONFIG = {
  verificationUrl: "https://singularitysalesplatform.com/api/public/verify",
  customersUrl: "https://singularitysalesplatform.com/api/public/customers",
  salesOrdersUrl: "https://singularitysalesplatform.com/api/public/sales-orders"
};

const STORAGE_KEYS = {
  credentials: "encryptedCredentials",
  encryptionKey: "localEncryptionKey",
  onboarding: "verificationState"
};

const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  } catch (error) {
    return true;
  }
}

function assertConfiguredEndpoint(url, label) {
  if (isPlaceholderEndpoint(url)) {
    throw new Error(label + " endpoint is not configured yet. Update the placeholder URL before using this action.");
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

  if (!response.ok) {
    const error = new Error(`Request failed for ${url} with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  return response.json().catch(() => ({}));
}

function summarizeCustomer(customerPayload) {
  const customer = customerPayload?.customer ?? customerPayload ?? {};
  const fullName = [customer.firstname, customer.lastname].filter(Boolean).join(" ").trim();

  return {
    companyName: customer.companyname ?? "Unknown company",
    contactName: fullName || "Unknown contact",
    phone: customer.phone ?? "N/A",
    recordId: customer.recordid ?? "N/A",
    updatedAt: customer.updated_at ?? "N/A"
  };
}

function summarizeSalesOrder(orderPayload) {
  const order = orderPayload?.salesOrder ?? orderPayload ?? {};
  const items = orderPayload?.items ?? [];
  const totalValue = typeof order.total_cents === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(order.total_cents / 100)
    : "N/A";

  return {
    totalValue: totalValue,
    status: order.status ?? "Unknown",
    externalId: order.external_id ?? String(order.id ?? "N/A"),
    customerEmail: order.customer_email ?? "N/A",
    createdAt: order.created_at ?? "Unavailable",
    updatedAt: order.updated_at ?? "Unavailable",
    lineItems: items.map(function (item) {
      return (item.sku ?? "Item") + " x" + (item.quantity ?? 0);
    })
  };
}

function buildUrlWithParams(baseUrl, params) {
  const url = new URL(baseUrl);

  Object.entries(params).forEach(function ([key, value]) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function isNumericId(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

async function fetchSalesOrderRecord(salesOrderId, orderNumber, headers) {
  if (!salesOrderId && !orderNumber) {
    throw new Error("No sales order identifier was found in the current page URL.");
  }

  if (salesOrderId) {
    try {
      return await fetchJson(`${API_CONFIG.salesOrdersUrl}/${encodeURIComponent(salesOrderId)}`, {
        method: "GET",
        headers
      });
    } catch (error) {
      if (error.status !== 404 || !orderNumber) {
        throw error;
      }
    }
  }

  if (orderNumber) {
    try {
      return await fetchJson(`${API_CONFIG.salesOrdersUrl}/${encodeURIComponent(orderNumber)}`, {
        method: "GET",
        headers
      });
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  const salesOrderToken = orderNumber || salesOrderId;

  const listPayload = await fetchJson(
    buildUrlWithParams(API_CONFIG.salesOrdersUrl, { q: salesOrderToken, limit: 10, offset: 0 }),
    {
      method: "GET",
      headers
    }
  );

  const matchedOrder = listPayload?.items?.find(function (item) {
    return item.external_id === salesOrderToken;
  }) ?? listPayload?.items?.find(function (item) {
    return String(item.id) === salesOrderToken;
  }) ?? listPayload?.items?.[0];

  if (!matchedOrder?.id) {
    throw new Error(`No sales order matched "${salesOrderToken}".`);
  }

  return fetchJson(`${API_CONFIG.salesOrdersUrl}/${encodeURIComponent(matchedOrder.id)}`, {
    method: "GET",
    headers
  });
}

async function fetchCustomerRecord(customerToken, orderPayload, headers) {
  const order = orderPayload?.salesOrder ?? {};
  const orderCustomerId = order.customer_id ?? order.customer_recordid ?? "";
  const lookupToken = orderCustomerId || customerToken;

  if (lookupToken) {
    const customerSearchPayload = await fetchJson(
      buildUrlWithParams(API_CONFIG.customersUrl, { q: lookupToken, limit: 10, offset: 0 }),
      {
        method: "GET",
        headers
      }
    );

    const matchedCustomer = customerSearchPayload?.items?.find(function (item) {
      return item.recordid === lookupToken;
    }) ?? customerSearchPayload?.items?.find(function (item) {
      return item.email === lookupToken;
    }) ?? customerSearchPayload?.items?.[0];

    if (matchedCustomer?.recordid) {
      return fetchJson(`${API_CONFIG.customersUrl}/${encodeURIComponent(matchedCustomer.recordid)}`, {
        method: "GET",
        headers
      });
    }
  }

  if (order.customer_email) {
    const customerSearchPayload = await fetchJson(
      buildUrlWithParams(API_CONFIG.customersUrl, { q: order.customer_email, limit: 10, offset: 0 }),
      {
        method: "GET",
        headers
      }
    );

    const matchedCustomer = customerSearchPayload?.items?.find(function (item) {
      return item.email === order.customer_email;
    }) ?? customerSearchPayload?.items?.[0];

    if (matchedCustomer?.recordid) {
      return fetchJson(`${API_CONFIG.customersUrl}/${encodeURIComponent(matchedCustomer.recordid)}`, {
        method: "GET",
        headers
      });
    }
  }

  return null;
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
  const orderPayload = await fetchSalesOrderRecord(salesOrderId, orderNumber, headers);
  const customerPayload = await fetchCustomerRecord(customerId, orderPayload, headers);

  return {
    ok: true,
    meta: {
      salesOrderId: orderPayload?.salesOrder?.id ?? salesOrderId,
      customerId: orderPayload?.salesOrder?.customer_id ?? orderPayload?.salesOrder?.customer_recordid ?? customerPayload?.customer?.recordid ?? customerId,
      refreshedAt: new Date().toISOString()
    },
    customer: summarizeCustomer(customerPayload ?? {}),
    salesOrder: summarizeSalesOrder(orderPayload)
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
