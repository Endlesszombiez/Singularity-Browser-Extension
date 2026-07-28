const TARGET_URL_PREFIX = "https://factory.katanamrp.com/salesorder/";
const METHOD_URL_PREFIX = "https://botanaway.method.me/apps/";
const GOOGLE_MAPS_URL_PREFIX = "https://www.google.com/maps/";
const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const PANEL_ID = "singularity-katana-panel-root";
const PANEL_HOST_ID = "singularity-katana-panel-host";
const PANEL_DEBUG_LOG_ID = "skp-panel-debug-log";
const GOOGLE_MAPS_CRM_HOST_ID = "skp-google-maps-crm-host";
const GOOGLE_MAPS_CRM_STATUS_ID = "skp-google-maps-crm-status";
const ORDER_NUMBER_WAIT_MS = 10000;
const ORDER_NUMBER_POLL_MS = 5000;
const METHOD_ROW_LIMIT = 50;
const METHOD_SCAN_DEBOUNCE_MS = 500;
const METHOD_ROW_PREFIXES = ["InvoiceLineItemsEditable", "EstimateLineDataTable"];
const METHOD_LOW_STOCK_CLASS = "skp-method-low-stock";
const METHOD_IN_STOCK_CLASS = "skp-method-in-stock";
const METHOD_CLOSE_STOCK_CLASS = "skp-method-close-stock";
const METHOD_DEBUG_HOST_ID = "skp-method-debug-host";
const METHOD_DEBUG_LOG_ID = "skp-method-debug-log";
const METHOD_DEBUG_TOGGLE_ID = "skp-method-debug-toggle";
const METHOD_SYNC_CONTAINER_ID = "skp-method-sync-container";
const METHOD_SYNC_STATUS_ID = "skp-method-sync-status";
const METHOD_DEBUG_MAX_ENTRIES = 80;
const DEBUG_PAYLOAD_MAX_LENGTH = 4000;

let currentUrl = window.location.href;
let elements = null;
let lastVerifiedAt = null;
let katanaDebugEntries = [];
let isKatanaPanelMinimized = false;
let currentPanelView = "auth";
let manualOrderNumberOverride = "";
let isManualOrderCollapsed = true;
let methodScanTimeoutId = null;
let methodDebugEntries = [];
let methodScanInProgress = false;
let methodScanQueued = false;
let methodDebugMinimized = true;
let methodRuntimeDisconnected = false;
let methodLastSyncCheckKey = "";
let methodSyncStatus = {
  hidden: false,
  tone: "neutral",
  text: "Checking sync status...",
  summaryText: "Checking Sync - Singularity Debug"
};
let panelBootstrapInProgress = false;
let panelBootstrapRetryTimeoutId = null;
let panelPresenceCheckTimeoutId = null;
let isRemoveCredentialsModalOpen = false;
let isWooCommerceModalOpen = false;
let isSspOrderModalOpen = false;
let focusedOrderNumber = "";
let isRequestMenuOpen = false;
let featureSettings = {
  methodEnabled: true,
  katanaEnabled: true,
  googleMapsCrmEnabled: false
};
let googleMapsRenderTimeoutId = null;
let lastGoogleMapsBusinessKey = "";
let googleMapsWebsiteEmailCache = new Map();

function isTargetUrl(url) {
  return url.startsWith(TARGET_URL_PREFIX);
}

function isMethodUrl(url) {
  return url.startsWith(METHOD_URL_PREFIX);
}

function isGoogleMapsUrl(url) {
  return url.startsWith(GOOGLE_MAPS_URL_PREFIX);
}

async function refreshFeatureSettings() {
  const result = await sendRuntimeMessage({ action: "getFeatureSettings" });

  if (result?.ok) {
    featureSettings = {
      ...featureSettings,
      ...result.featureSettings
    };
  }

  return featureSettings;
}

function isRuntimeConnectionError(error) {
  const message = String(error?.message ?? error ?? "");
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

async function sendRuntimeMessage(message) {
  try {
    console.debug("[Singularity] sendRuntimeMessage start", message);
    const response = await runtimeApi.sendMessage(message);
    console.debug("[Singularity] sendRuntimeMessage response", {
      action: message?.action,
      response
    });
    return response;
  } catch (error) {
    console.error("[Singularity] sendRuntimeMessage failed", {
      action: message?.action,
      error
    });
    if (isRuntimeConnectionError(error)) {
      methodRuntimeDisconnected = true;
      throw new Error("Extension background is unavailable. Reload the extension, then refresh this page.");
    }

    throw error;
  }
}

function ensureMethodDebugWindow() {
  let host = document.getElementById(METHOD_DEBUG_HOST_ID);

  if (host) {
    return host;
  }

  host = document.createElement("aside");
  host.id = METHOD_DEBUG_HOST_ID;
  host.style.position = "fixed";
  host.style.left = "50%";
  host.style.bottom = "16px";
  host.style.transform = "translateX(-50%)";
  host.style.width = "360px";
  host.style.maxWidth = "calc(100vw - 32px)";
  host.style.maxHeight = "45vh";
  host.style.zIndex = "2147483647";
  host.style.background = "rgba(18, 18, 18, 0.94)";
  host.style.color = "#f5f5f5";
  host.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  host.style.borderRadius = "10px";
  host.style.boxShadow = "0 12px 30px rgba(0, 0, 0, 0.35)";
  host.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  host.style.fontSize = "12px";
  host.style.lineHeight = "1.4";
  host.style.overflow = "hidden";
  host.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span>Singularity Debug</span>
      <button id="${METHOD_DEBUG_TOGGLE_ID}" type="button" style="border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f5f5f5;border-radius:6px;padding:2px 8px;cursor:pointer;">_</button>
    </div>
    <div id="${METHOD_SYNC_CONTAINER_ID}" style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);display:block;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;opacity:0.75;">Sync</div>
      <div id="${METHOD_SYNC_STATUS_ID}" style="margin-top:4px;font-size:13px;font-weight:600;">Checking sync status...</div>
    </div>
    <div id="${METHOD_DEBUG_LOG_ID}" style="padding:8px 10px;overflow:auto;max-height:calc(45vh - 36px);white-space:pre-wrap;"></div>
  `;

  document.body.appendChild(host);
  host.querySelector(`#${METHOD_DEBUG_TOGGLE_ID}`)?.addEventListener("click", () => {
    methodDebugMinimized = !methodDebugMinimized;
    updateMethodDebugWindow();
  });
  updateMethodDebugWindow();
  return host;
}

function updateMethodDebugWindow() {
  const host = document.getElementById(METHOD_DEBUG_HOST_ID);
  const logElement = document.getElementById(METHOD_DEBUG_LOG_ID);
  const toggleButton = document.getElementById(METHOD_DEBUG_TOGGLE_ID);
  const syncContainer = document.getElementById(METHOD_SYNC_CONTAINER_ID);
  const statusElement = document.getElementById(METHOD_SYNC_STATUS_ID);

  if (!host || !logElement || !toggleButton || !syncContainer || !statusElement) {
    return;
  }

  host.style.width = methodDebugMinimized ? "180px" : "360px";
  logElement.style.display = methodDebugMinimized ? "none" : "block";
  syncContainer.style.padding = methodDebugMinimized ? "8px 10px" : "8px 10px";
  statusElement.style.marginTop = methodDebugMinimized ? "0" : "4px";
  statusElement.style.whiteSpace = methodDebugMinimized ? "nowrap" : "normal";
  statusElement.style.overflow = methodDebugMinimized ? "hidden" : "visible";
  statusElement.style.textOverflow = methodDebugMinimized ? "ellipsis" : "clip";
  toggleButton.textContent = methodDebugMinimized ? "+" : "_";
  toggleButton.title = methodDebugMinimized ? "Expand debug window" : "Minimize debug window";
  updateMethodSyncWindow();
}

function pushMethodDebug(message, detail = "") {
  if (!isMethodUrl(window.location.href) || !featureSettings.methodEnabled) {
    return;
  }

  ensureMethodDebugWindow();
  const timestamp = new Date().toLocaleTimeString();
  const line = detail ? `[${timestamp}] ${message}: ${detail}` : `[${timestamp}] ${message}`;

  methodDebugEntries.push(line);

  if (methodDebugEntries.length > METHOD_DEBUG_MAX_ENTRIES) {
    methodDebugEntries = methodDebugEntries.slice(-METHOD_DEBUG_MAX_ENTRIES);
  }

  const logElement = document.getElementById(METHOD_DEBUG_LOG_ID);

  if (logElement) {
    logElement.textContent = methodDebugEntries.join("\n");
    logElement.scrollTop = logElement.scrollHeight;
  }
}

function pushMethodRequestDebugTraces(debugTrace) {
  if (!Array.isArray(debugTrace)) {
    return;
  }

  for (const entry of debugTrace) {
    if (entry) {
      pushMethodDebug("Request", entry);
    }
  }
}

function ensureMethodSyncWindow() {
  return ensureMethodDebugWindow();
}

function updateMethodSyncWindow() {
  const host = document.getElementById(METHOD_DEBUG_HOST_ID);
  const container = document.getElementById(METHOD_SYNC_CONTAINER_ID);
  const statusElement = document.getElementById(METHOD_SYNC_STATUS_ID);

  if (!host || !container || !statusElement) {
    return;
  }

  if (methodSyncStatus.hidden) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  statusElement.textContent = methodDebugMinimized
    ? methodSyncStatus.summaryText || methodSyncStatus.text
    : methodSyncStatus.text;

  if (methodSyncStatus.tone === "success") {
    container.style.background = "rgba(34, 197, 94, 0.14)";
    container.style.color = "#dcfce7";
    return;
  }

  if (methodSyncStatus.tone === "danger") {
    container.style.background = "rgba(239, 68, 68, 0.16)";
    container.style.color = "#fee2e2";
    return;
  }

  container.style.background = "rgba(255, 255, 255, 0.04)";
  container.style.color = "#e2e8f0";
}

function setMethodSyncStatus(status) {
  methodSyncStatus = {
    ...methodSyncStatus,
    ...status
  };
  ensureMethodSyncWindow();
  updateMethodSyncWindow();
}

function resetMethodSyncState() {
  methodLastSyncCheckKey = "";
  methodSyncStatus = {
    hidden: false,
    tone: "neutral",
    text: "Checking sync status...",
    summaryText: "Checking Sync - Singularity Debug"
  };
  updateMethodSyncWindow();
}

function formatDebugPayload(label, payload) {
  if (payload === undefined) {
    return `${label}: undefined`;
  }

  let serialized = "";

  try {
    serialized = typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 2);
  } catch {
    serialized = String(payload);
  }

  if (serialized.length > DEBUG_PAYLOAD_MAX_LENGTH) {
    serialized = `${serialized.slice(0, DEBUG_PAYLOAD_MAX_LENGTH)}\n... [truncated]`;
  }

  return `${label}:\n${serialized}`;
}

function isMethodInternalNode(node) {
  if (!(node instanceof Element)) {
    return false;
  }

  return Boolean(
    node.closest(`#${METHOD_DEBUG_HOST_ID}`) ||
    node.closest("#skp-method-highlight-styles")
  );
}

function extractMethodDocumentText() {
  return extractMeaningfulText(document.body?.innerText ?? document.documentElement?.innerText ?? "");
}

function getMethodDocumentReference() {
  const documentText = extractMethodDocumentText();
  const estimateMatch = documentText.match(/\bEstimate\s*:\s*(\d+)\b/i);

  if (estimateMatch) {
    return {
      type: "estimate",
      invoiceNumber: estimateMatch[1]
    };
  }

  const invoiceMatch = documentText.match(/\bInvoice\s*:\s*(\d+)\b/i);

  if (invoiceMatch) {
    return {
      type: "invoice",
      invoiceNumber: invoiceMatch[1]
    };
  }

  return {
    type: "unknown",
    invoiceNumber: ""
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "Not verified yet";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function updateKatanaDebugLog() {
  if (!elements?.panelDebugLog) {
    return;
  }

  elements.panelDebugLog.textContent = katanaDebugEntries.join("\n");
  elements.panelDebugLog.scrollTop = elements.panelDebugLog.scrollHeight;
}

function pushKatanaDebug(message, detail = "") {
  const timestamp = new Date().toLocaleTimeString();
  const line = detail ? `[${timestamp}] ${message}: ${detail}` : `[${timestamp}] ${message}`;

  katanaDebugEntries.push(line);

  if (katanaDebugEntries.length > 80) {
    katanaDebugEntries = katanaDebugEntries.slice(-80);
  }

  updateKatanaDebugLog();
}

function updateKatanaPanelMinimizedState() {
  if (!elements?.shell || !elements?.minimizeButton) {
    return;
  }

  elements.shell.classList.toggle("skp-minimized", isKatanaPanelMinimized);
  elements.minimizeButton.innerHTML = isKatanaPanelMinimized
    ? `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    `
    : `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 12h12" />
      </svg>
    `;
  elements.minimizeButton.title = isKatanaPanelMinimized ? "Expand panel" : "Minimize panel";
  elements.minimizeButton.setAttribute("aria-label", isKatanaPanelMinimized ? "Expand panel" : "Minimize panel");
  updateHeaderActionVisibility();
  updateRemoveCredentialsModalState();
  updateWooCommerceModalState();
  updateSspOrderModalState();
}

function updateHeaderActionVisibility() {
  if (!elements?.headerActionGroup || !elements?.minimizeButton) {
    return;
  }

  const isAuthView = currentPanelView === "auth";
  if (elements.refreshButton) {
    elements.refreshButton.hidden = isAuthView;
  }
  if (elements.removeCredentialsButton) {
    elements.removeCredentialsButton.hidden = isAuthView || isKatanaPanelMinimized;
  }
  elements.headerActionGroup.hidden = false;
}

function updateRemoveCredentialsModalState() {
  if (!elements?.removeCredentialsModal) {
    return;
  }

  const shouldShowModal = isRemoveCredentialsModalOpen && !isKatanaPanelMinimized;
  elements.removeCredentialsModal.hidden = !shouldShowModal;
  elements.removeCredentialsModal.setAttribute("aria-hidden", String(!shouldShowModal));
}

function updateWooCommerceModalState() {
  if (!elements?.wooCommerceModal) {
    return;
  }

  const shouldShowModal = isWooCommerceModalOpen && !isKatanaPanelMinimized;
  elements.wooCommerceModal.hidden = !shouldShowModal;
  elements.wooCommerceModal.setAttribute("aria-hidden", String(!shouldShowModal));
}

function updateSspOrderModalState() {
  if (!elements?.sspOrderModal) {
    return;
  }

  const shouldShowModal = isSspOrderModalOpen && !isKatanaPanelMinimized;
  elements.sspOrderModal.hidden = !shouldShowModal;
  elements.sspOrderModal.setAttribute("aria-hidden", String(!shouldShowModal));
}

function updateSspRequestAvailability(orderNumber = focusedOrderNumber) {
  focusedOrderNumber = extractMeaningfulText(orderNumber);

  if (!elements?.sspRequestButton) {
    return;
  }

  elements.sspRequestButton.hidden = !focusedOrderNumber.startsWith("SSP");
  if (elements.sspRequestButton.hidden) {
    isRequestMenuOpen = false;
  }
  elements.sspRequestGroup.hidden = elements.sspRequestButton.hidden;
  elements.sspRequestMenu.hidden = !isRequestMenuOpen || elements.sspRequestButton.hidden;
  elements.sspRequestButton.title = focusedOrderNumber
    ? `Request complete SSP data for ${focusedOrderNumber}`
    : "Request complete SSP order data";
}

function setRequestMenuOpen(isOpen) {
  isRequestMenuOpen = Boolean(isOpen);

  if (elements?.sspRequestMenu) {
    elements.sspRequestMenu.hidden = !isRequestMenuOpen;
  }

  elements?.sspRequestMenuButton?.setAttribute("aria-expanded", String(isRequestMenuOpen));
}

function openRemoveCredentialsModal() {
  isRemoveCredentialsModalOpen = true;
  updateRemoveCredentialsModalState();
}

function closeRemoveCredentialsModal() {
  isRemoveCredentialsModalOpen = false;
  updateRemoveCredentialsModalState();
}

function openWooCommerceModal() {
  isWooCommerceModalOpen = true;
  updateWooCommerceModalState();
}

function closeWooCommerceModal() {
  isWooCommerceModalOpen = false;
  updateWooCommerceModalState();
}

function openSspOrderModal() {
  isSspOrderModalOpen = true;
  updateSspOrderModalState();
}

function closeSspOrderModal() {
  isSspOrderModalOpen = false;
  updateSspOrderModalState();
}

function createPanel() {
  const existingHost = document.getElementById(PANEL_HOST_ID);

  if (existingHost && elements?.host === existingHost) {
    return elements;
  }

  if (!document.body) {
    return null;
  }

  if (existingHost) {
    existingHost.remove();
  }

  const host = document.createElement("div");
  host.id = PANEL_HOST_ID;
  const root = document.createElement("aside");
  const logoUrl = runtimeApi.getURL("images/CompanyLogo.png");
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="skp-shell">
      <header class="skp-header">
        <div class="skp-header-main">
          <img class="skp-header-logo" src="${logoUrl}" alt="Company logo" />
          <h2>Sales Order Intelligence</h2>
          <p class="skp-header-copy">$ singularity panel --katana --live</p>
        </div>
        <div class="skp-header-actions">
          <div class="skp-header-panel-actions" hidden>
            <div class="skp-split-action" data-ssp-request-group hidden>
              <button type="button" class="skp-primary skp-request-button" data-action="request-ssp-order">Request</button>
              <button type="button" class="skp-primary skp-request-menu-button" data-action="toggle-request-menu" aria-label="More SSP actions" aria-expanded="false">▾</button>
              <div class="skp-request-menu" data-ssp-request-menu hidden>
                <button type="button" data-action="update-katana-line-items">Update Line Items</button>
                <button type="button" data-action="update-katana-addresses">Update Address</button>
              </div>
            </div>
            <button type="button" class="skp-icon-button" data-action="refresh-data" title="Refresh panel data" aria-label="Refresh panel data">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                <path d="M20 4v6h-6" />
              </svg>
            </button>
            <button type="button" class="skp-icon-button skp-danger-icon" data-action="open-remove-api-key-modal" title="Remove stored API key" aria-label="Remove stored API key">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
            <button type="button" class="skp-icon-button skp-window-toggle" data-action="toggle-minimize" title="Minimize panel" aria-label="Minimize panel">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 12h12" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <div class="skp-body">
        <section class="skp-main-pane">
          <section class="skp-address-alert" id="skp-address-alert" hidden>
            <strong>Shipping address differs from SSP</strong>
            <p>Katana may have an outdated delivery address. Review it or use Request ▾ → Update Address.</p>
          </section>
          <section class="skp-view" data-view="auth">
            <p class="skp-copy">Verify your API keys before the panel loads customer and sales order insights.</p>
            <form class="skp-form" id="skp-auth-form">
              <label>
                <span>Public key</span>
                <input type="text" name="publicKey" autocomplete="off" spellcheck="false" required />
              </label>
              <label>
                <span>Secret key</span>
                <div class="skp-secret-field">
                  <input type="password" name="secretKey" autocomplete="off" spellcheck="false" required />
                  <button type="button" class="skp-reveal" data-action="hold-reveal-secret">Reveal</button>
                </div>
              </label>
              <button type="submit" class="skp-primary">Verify & Save</button>
            </form>
            <p class="skp-meta" id="skp-auth-status">No verified key pair stored.</p>
          </section>
          <section class="skp-view skp-verified-view" data-view="verified" hidden>
            <img class="skp-logo" src="${logoUrl}" alt="Company logo" />
            <p class="skp-verified-title">Credentials Verified</p>
            <p class="skp-meta" id="skp-verified-meta">Stored credentials are ready to use.</p>
            <p class="skp-meta" id="skp-verified-status">Loading customer and sales order data...</p>
          </section>
          <section class="skp-view" data-view="dashboard" hidden>
            <div class="skp-status-row">
              <p class="skp-meta" id="skp-refresh-status">Waiting for data refresh.</p>
            </div>
            <div class="skp-grid">
              <article class="skp-card">
                <p class="skp-card-label">Company</p>
                <strong id="skp-company-name">-</strong>
              </article>
              <article class="skp-card">
                <p class="skp-card-label">Contact</p>
                <strong id="skp-contact-name">-</strong>
              </article>
              <article class="skp-card">
                <p class="skp-card-label">Order total</p>
                <strong id="skp-order-total">-</strong>
              </article>
              <article class="skp-card">
                <p class="skp-card-label">Order status</p>
                <strong id="skp-order-status">-</strong>
              </article>
            </div>
            <div class="skp-detail-group">
              <section class="skp-detail-card">
                <h3>Customer Snapshot</h3>
                <dl>
                  <div><dt>Assigned to</dt><dd id="skp-customer-assigned-to">-</dd></div>
                  <div><dt>Phone</dt><dd id="skp-customer-phone">-</dd></div>
                  <div><dt>Email</dt><dd id="skp-customer-email">-</dd></div>
                </dl>
              </section>
              <section class="skp-detail-card">
                <h3>Sales Order Snapshot</h3>
                <dl>
                  <div><dt>Invoice #</dt><dd id="skp-order-external-id">-</dd></div>
                  <div><dt>Tracking number</dt><dd id="skp-order-tracking-number">-</dd></div>
                  <div><dt>Ship method</dt><dd id="skp-order-ship-method">-</dd></div>
                </dl>
              </section>
            </div>
          </section>
          <section class="skp-manual-order" id="skp-manual-order" hidden>
            <div class="skp-manual-order-header">
              <div class="skp-manual-order-heading">
                <h3>Manual Sales Order Lookup</h3>
                <p class="skp-meta" id="skp-manual-order-status">Katana order auto-detection is active.</p>
              </div>
              <button type="button" class="skp-ghost skp-manual-order-toggle" data-action="toggle-manual-order" aria-expanded="false">Expand</button>
            </div>
            <div class="skp-manual-order-body" id="skp-manual-order-body" hidden>
              <form class="skp-form skp-inline-form" id="skp-manual-order-form">
                <label>
                  <span>Sales Order Number</span>
                  <input type="text" name="manualOrderNumber" autocomplete="off" spellcheck="false" placeholder="Enter Sales Order number" />
                </label>
                <div class="skp-inline-actions">
                  <button type="submit" class="skp-primary">Search Order</button>
                  <button type="button" class="skp-ghost" data-action="lookup-woocommerce-order">Lookup WooCommerce</button>
                  <button type="button" class="skp-ghost" data-action="clear-manual-order">Use Katana Order</button>
                </div>
              </form>
              <p class="skp-meta" id="skp-woocommerce-lookup-status">WooCommerce lookup is ready when an order number is available.</p>
            </div>
          </section>
        </section>
        <aside class="skp-debug-pane">
          <div class="skp-debug-title">Debug Trace</div>
          <pre id="${PANEL_DEBUG_LOG_ID}" class="skp-debug-log"></pre>
        </aside>
      </div>
      <div class="skp-modal-backdrop" id="skp-remove-api-key-modal" hidden aria-hidden="true">
        <div class="skp-modal-card" role="dialog" aria-modal="true" aria-labelledby="skp-remove-api-key-title">
          <h3 id="skp-remove-api-key-title">Remove API Key?</h3>
          <p class="skp-copy">This clears the stored Singularity API keys from the extension and returns the panel to the credentials screen.</p>
          <div class="skp-modal-actions">
            <button type="button" class="skp-ghost" data-action="cancel-remove-api-key">Cancel</button>
            <button type="button" class="skp-danger" data-action="confirm-remove-api-key">Remove API Key</button>
          </div>
        </div>
      </div>
      <div class="skp-modal-backdrop" id="skp-woocommerce-modal" hidden aria-hidden="true">
        <div class="skp-modal-card skp-woocommerce-modal-card" role="dialog" aria-modal="true" aria-labelledby="skp-woocommerce-modal-title">
          <div class="skp-modal-heading">
            <div>
              <h3 id="skp-woocommerce-modal-title">WooCommerce Order Lookup</h3>
              <p class="skp-copy" id="skp-woocommerce-modal-subtitle">Search a WooCommerce order to fill in missing details.</p>
            </div>
            <button type="button" class="skp-icon-button" data-action="close-woocommerce-modal" title="Close WooCommerce modal" aria-label="Close WooCommerce modal">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div class="skp-woocommerce-modal-body">
            <div class="skp-grid skp-woocommerce-summary-grid">
              <article class="skp-card">
                <p class="skp-card-label">Store</p>
                <strong id="skp-woo-site-label">-</strong>
              </article>
              <article class="skp-card">
                <p class="skp-card-label">Order Status</p>
                <strong id="skp-woo-order-status">-</strong>
              </article>
              <article class="skp-card">
                <p class="skp-card-label">Customer</p>
                <strong id="skp-woo-customer-name">-</strong>
              </article>
              <article class="skp-card">
                <p class="skp-card-label">Email</p>
                <strong id="skp-woo-customer-email">-</strong>
              </article>
            </div>
            <div class="skp-detail-group skp-woocommerce-detail-group">
              <section class="skp-detail-card">
                <h3>Billing</h3>
                <dl>
                  <div><dt>Name</dt><dd id="skp-woo-billing-name">-</dd></div>
                  <div><dt>Company</dt><dd id="skp-woo-billing-company">-</dd></div>
                  <div><dt>Address</dt><dd id="skp-woo-billing-address">-</dd></div>
                  <div><dt>Phone</dt><dd id="skp-woo-billing-phone">-</dd></div>
                </dl>
              </section>
              <section class="skp-detail-card">
                <h3>Shipping</h3>
                <dl>
                  <div><dt>Name</dt><dd id="skp-woo-shipping-name">-</dd></div>
                  <div><dt>Company</dt><dd id="skp-woo-shipping-company">-</dd></div>
                  <div><dt>Address</dt><dd id="skp-woo-shipping-address">-</dd></div>
                  <div><dt>Methods</dt><dd id="skp-woo-shipping-lines">-</dd></div>
                </dl>
              </section>
            </div>
            <section class="skp-detail-card">
              <h3>Items</h3>
              <div class="skp-woo-items" id="skp-woo-items">No items loaded.</div>
            </section>
          </div>
          <div class="skp-modal-actions">
            <button type="button" class="skp-ghost" data-action="close-woocommerce-modal">Close</button>
          </div>
        </div>
      </div>
      <div class="skp-modal-backdrop" id="skp-ssp-order-modal" hidden aria-hidden="true">
        <div class="skp-modal-card skp-ssp-order-modal-card" role="dialog" aria-modal="true" aria-labelledby="skp-ssp-order-modal-title">
          <div class="skp-modal-heading">
            <div>
              <h3 id="skp-ssp-order-modal-title">Complete SSP Order</h3>
              <p class="skp-copy" id="skp-ssp-order-modal-subtitle">Requesting all available order fields and line items.</p>
            </div>
            <button type="button" class="skp-icon-button" data-action="close-ssp-order-modal" title="Close SSP order modal" aria-label="Close SSP order modal">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div class="skp-ssp-order-modal-body" id="skp-ssp-order-content">
            <p class="skp-meta">Waiting for SSP.</p>
          </div>
          <div class="skp-modal-actions">
            <button type="button" class="skp-ghost" data-action="close-ssp-order-modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;

  host.appendChild(root);
  document.body.appendChild(host);

  elements = {
    host,
    shell: root.querySelector(".skp-shell"),
    header: root.querySelector(".skp-header"),
    headerActionGroup: root.querySelector(".skp-header-panel-actions"),
    refreshButton: root.querySelector('[data-action="refresh-data"]'),
    sspRequestButton: root.querySelector('[data-action="request-ssp-order"]'),
    sspRequestGroup: root.querySelector("[data-ssp-request-group]"),
    sspRequestMenuButton: root.querySelector('[data-action="toggle-request-menu"]'),
    sspRequestMenu: root.querySelector("[data-ssp-request-menu]"),
    addressAlert: root.querySelector("#skp-address-alert"),
    removeCredentialsButton: root.querySelector('[data-action="open-remove-api-key-modal"]'),
    minimizeButton: root.querySelector('[data-action="toggle-minimize"]'),
    authView: root.querySelector('[data-view="auth"]'),
    verifiedView: root.querySelector('[data-view="verified"]'),
    dashboardView: root.querySelector('[data-view="dashboard"]'),
    authForm: root.querySelector("#skp-auth-form"),
    secretInput: root.querySelector('input[name="secretKey"]'),
    revealSecretButton: root.querySelector('[data-action="hold-reveal-secret"]'),
    authStatus: root.querySelector("#skp-auth-status"),
    verifiedMeta: root.querySelector("#skp-verified-meta"),
    verifiedStatus: root.querySelector("#skp-verified-status"),
    refreshStatus: root.querySelector("#skp-refresh-status"),
    manualOrderSection: root.querySelector("#skp-manual-order"),
    manualOrderBody: root.querySelector("#skp-manual-order-body"),
    manualOrderForm: root.querySelector("#skp-manual-order-form"),
    manualOrderInput: root.querySelector('input[name="manualOrderNumber"]'),
    manualOrderStatus: root.querySelector("#skp-manual-order-status"),
    wooCommerceLookupStatus: root.querySelector("#skp-woocommerce-lookup-status"),
    manualOrderToggle: root.querySelector('[data-action="toggle-manual-order"]'),
    companyName: root.querySelector("#skp-company-name"),
    contactName: root.querySelector("#skp-contact-name"),
    orderTotal: root.querySelector("#skp-order-total"),
    orderStatus: root.querySelector("#skp-order-status"),
    customerAssignedTo: root.querySelector("#skp-customer-assigned-to"),
    customerPhone: root.querySelector("#skp-customer-phone"),
    customerEmail: root.querySelector("#skp-customer-email"),
    orderExternalId: root.querySelector("#skp-order-external-id"),
    orderTrackingNumber: root.querySelector("#skp-order-tracking-number"),
    orderShipMethod: root.querySelector("#skp-order-ship-method"),
    panelDebugLog: root.querySelector(`#${PANEL_DEBUG_LOG_ID}`),
    removeCredentialsModal: root.querySelector("#skp-remove-api-key-modal"),
    wooCommerceModal: root.querySelector("#skp-woocommerce-modal"),
    wooCommerceModalSubtitle: root.querySelector("#skp-woocommerce-modal-subtitle"),
    wooSiteLabel: root.querySelector("#skp-woo-site-label"),
    wooOrderStatus: root.querySelector("#skp-woo-order-status"),
    wooCustomerName: root.querySelector("#skp-woo-customer-name"),
    wooCustomerEmail: root.querySelector("#skp-woo-customer-email"),
    wooBillingName: root.querySelector("#skp-woo-billing-name"),
    wooBillingCompany: root.querySelector("#skp-woo-billing-company"),
    wooBillingAddress: root.querySelector("#skp-woo-billing-address"),
    wooBillingPhone: root.querySelector("#skp-woo-billing-phone"),
    wooShippingName: root.querySelector("#skp-woo-shipping-name"),
    wooShippingCompany: root.querySelector("#skp-woo-shipping-company"),
    wooShippingAddress: root.querySelector("#skp-woo-shipping-address"),
    wooShippingLines: root.querySelector("#skp-woo-shipping-lines"),
    wooItems: root.querySelector("#skp-woo-items"),
    sspOrderModal: root.querySelector("#skp-ssp-order-modal"),
    sspOrderModalSubtitle: root.querySelector("#skp-ssp-order-modal-subtitle"),
    sspOrderContent: root.querySelector("#skp-ssp-order-content")
  };
  updateKatanaDebugLog();
  updateKatanaPanelMinimizedState();
  updateHeaderActionVisibility();
  updateRemoveCredentialsModalState();
  updateWooCommerceModalState();
  updateSspOrderModalState();
  updateSspRequestAvailability();

  root.addEventListener("click", async (event) => {
    if (event.target === elements.removeCredentialsModal) {
      closeRemoveCredentialsModal();
      return;
    }

    if (event.target === elements.wooCommerceModal) {
      closeWooCommerceModal();
      return;
    }

    if (event.target === elements.sspOrderModal) {
      closeSspOrderModal();
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "toggle-request-menu") {
      setRequestMenuOpen(!isRequestMenuOpen);
      return;
    }

    if (action === "toggle-minimize") {
      isKatanaPanelMinimized = !isKatanaPanelMinimized;
      updateKatanaPanelMinimizedState();
      return;
    }

    if (action === "refresh-data") {
      pushKatanaDebug("Refresh requested");
      await loadPanelData({ preserveView: true });
      return;
    }

    if (action === "request-ssp-order") {
      setRequestMenuOpen(false);
      await requestSspOrder();
      return;
    }

    if (action === "update-katana-line-items") {
      setRequestMenuOpen(false);
      await runKatanaOverwrite("line-items");
      return;
    }

    if (action === "update-katana-addresses") {
      setRequestMenuOpen(false);
      await runKatanaOverwrite("addresses");
      return;
    }

    if (action === "open-remove-api-key-modal") {
      openRemoveCredentialsModal();
      return;
    }

    if (action === "cancel-remove-api-key") {
      closeRemoveCredentialsModal();
      return;
    }

    if (action === "toggle-manual-order") {
      setManualOrderCollapsedState(!isManualOrderCollapsed);
      return;
    }

    if (action === "lookup-woocommerce-order") {
      await lookupWooCommerceOrder();
      return;
    }

    if (action === "clear-manual-order") {
      manualOrderNumberOverride = "";
      elements.manualOrderForm.reset();
      updateSspRequestAvailability(getOrderNumberFromPage());
      updateManualOrderStatus("Katana order auto-detection is active.");
      updateWooCommerceLookupStatus("WooCommerce lookup is ready when an order number is available.");
      pushKatanaDebug("Manual order override cleared");
      await loadPanelData({ preserveView: true });
      return;
    }

    if (action === "close-woocommerce-modal") {
      closeWooCommerceModal();
      return;
    }

    if (action === "close-ssp-order-modal") {
      closeSspOrderModal();
      return;
    }

    if (action === "confirm-remove-api-key") {
      closeRemoveCredentialsModal();
      pushKatanaDebug("Removing stored API key");
      elements.verifiedStatus.textContent = "Removing stored API key...";
      const result = await sendRuntimeMessage({ action: "clearCredentials" });

      if (!result?.ok) {
        elements.verifiedStatus.textContent = result?.error ?? "Unable to remove the stored API key.";
        return;
      }

      window.location.reload();
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (isRemoveCredentialsModalOpen) {
        closeRemoveCredentialsModal();
      }

      if (isWooCommerceModalOpen) {
        closeWooCommerceModal();
      }

      if (isSspOrderModalOpen) {
        closeSspOrderModal();
      }
    }
  });

  const setSecretVisibility = (isVisible) => {
    elements.secretInput.type = isVisible ? "text" : "password";
    elements.revealSecretButton.textContent = isVisible ? "Release to hide" : "Hold to reveal";
  };

  elements.revealSecretButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setSecretVisibility(true);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    elements.revealSecretButton.addEventListener(eventName, () => {
      setSecretVisibility(false);
    });
  });

  elements.manualOrderForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const orderNumber = extractMeaningfulText(elements.manualOrderInput.value);

    if (!isLikelyOrderNumber(orderNumber)) {
      updateManualOrderStatus("Enter a valid Sales Order number to search manually.");
      return;
    }

    manualOrderNumberOverride = orderNumber;
    updateSspRequestAvailability(orderNumber);
    elements.manualOrderInput.value = orderNumber;
    updateManualOrderStatus(`Manual Sales Order search active: ${orderNumber}.`);
    updateWooCommerceLookupStatus(`WooCommerce lookup ready for order ${orderNumber}.`);
    pushKatanaDebug("Manual order override set", orderNumber);
    await loadPanelData({ preserveView: true });
  });

  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(elements.authForm);
    const publicKey = String(formData.get("publicKey") ?? "").trim();
    const secretKey = String(formData.get("secretKey") ?? "").trim();

    elements.authStatus.textContent = "Verifying credentials...";

    try {
      const result = await sendRuntimeMessage({
        action: "verifyAndStoreCredentials",
        payload: {
          publicKey,
          secretKey
        }
      });

      if (!result.ok) {
        throw new Error(result.error ?? "Credential verification failed.");
      }

      lastVerifiedAt = result.verifiedAt;
      elements.authForm.reset();
      setSecretVisibility(false);
      pushKatanaDebug("Credentials verified", formatTimestamp(result.verifiedAt));
      showVerifiedSplash(result.verifiedAt, "Loading customer and sales order data...");
      await loadPanelData({ preserveView: false });
    } catch (error) {
      pushKatanaDebug("Credential verification failed", error.message);
      elements.authStatus.textContent = error.message;
    }
  });

  return elements;
}

function schedulePanelBootstrapRetry(delayMs = 250) {
  window.clearTimeout(panelBootstrapRetryTimeoutId);
  panelBootstrapRetryTimeoutId = window.setTimeout(() => {
    bootstrapPanel().catch((error) => {
      console.error("Katana panel retry failed.", error);
    });
  }, delayMs);
}

function schedulePanelPresenceCheck() {
  if (!isTargetUrl(window.location.href) || !featureSettings.katanaEnabled) {
    return;
  }

  window.clearTimeout(panelPresenceCheckTimeoutId);
  panelPresenceCheckTimeoutId = window.setTimeout(() => {
    if (panelBootstrapInProgress || document.getElementById(PANEL_HOST_ID)) {
      return;
    }

    bootstrapPanel().catch((error) => {
      console.error("Katana panel presence recovery failed.", error);
    });
  }, 150);
}

function setManualOrderCollapsedState(isCollapsed) {
  isManualOrderCollapsed = Boolean(isCollapsed);

  if (!elements?.manualOrderBody || !elements?.manualOrderToggle) {
    return;
  }

  elements.manualOrderBody.hidden = isManualOrderCollapsed;
  elements.manualOrderSection.dataset.collapsed = String(isManualOrderCollapsed);
  elements.manualOrderToggle.textContent = isManualOrderCollapsed ? "Expand" : "Collapse";
  elements.manualOrderToggle.setAttribute("aria-expanded", String(!isManualOrderCollapsed));
}

function setView(viewName) {
  currentPanelView = viewName;
  elements.authView.hidden = viewName !== "auth";
  elements.verifiedView.hidden = viewName !== "verified";
  elements.dashboardView.hidden = viewName !== "dashboard";
  elements.manualOrderSection.hidden = viewName === "auth";
  setManualOrderCollapsedState(isManualOrderCollapsed);
  updateHeaderActionVisibility();
  updateRemoveCredentialsModalState();
}

function showAuthView(message) {
  elements.authStatus.textContent = message ?? "No verified key pair stored.";
  pushKatanaDebug("Auth view", elements.authStatus.textContent);
  setView("auth");
}

function showVerifiedSplash(verifiedAt, message) {
  lastVerifiedAt = verifiedAt ?? lastVerifiedAt;
  elements.verifiedMeta.textContent = lastVerifiedAt
    ? `Verified on ${formatTimestamp(lastVerifiedAt)}.`
    : "Stored credentials are ready to use.";
  elements.verifiedStatus.textContent = message ?? "Loading customer and sales order data...";
  pushKatanaDebug("Verified view", elements.verifiedStatus.textContent);
  setView("verified");
}

function setLinkedValue(container, value) {
  const textValue = String(value ?? "N/A");
  container.innerHTML = "";

  if (textValue && textValue !== "N/A") {
    const link = document.createElement("a");
    link.href = `mailto:${textValue}`;
    link.textContent = textValue;
    link.className = "skp-inline-link";
    container.appendChild(link);
    return;
  }

  container.textContent = textValue;
}

function renderPanelData(result) {
  elements.companyName.textContent = String(result.customer.companyName || result.salesOrder.companyName);
  elements.contactName.textContent = String(result.customer.contactName || result.salesOrder.contactName);
  elements.orderTotal.textContent = String(result.salesOrder.totalValue);
  elements.orderStatus.textContent = String(result.salesOrder.status);
  elements.customerAssignedTo.textContent = String(result.salesOrder.assignedTo || result.customer.assignedTo);
  elements.customerPhone.textContent = String(result.customer.phone);
  setLinkedValue(elements.customerEmail, result.customer.email || result.salesOrder.customerEmail);
  elements.orderExternalId.textContent = String(result.salesOrder.externalId);
  elements.orderTrackingNumber.textContent = String(result.salesOrder.trackingNumber);
  elements.orderShipMethod.textContent = String(result.salesOrder.shipMethod);
  elements.refreshStatus.textContent = `Last refreshed ${formatTimestamp(result.meta.refreshedAt)}. Sales order ${result.meta.salesOrderId || "unknown"}.`;
  elements.manualOrderInput.value = manualOrderNumberOverride;
  updateSspRequestAvailability(manualOrderNumberOverride || focusedOrderNumber);
  updateManualOrderStatus(
    manualOrderNumberOverride
      ? `Manual Sales Order search active: ${manualOrderNumberOverride}.`
      : "Katana order auto-detection is active."
  );
  updateWooCommerceLookupStatus(
    manualOrderNumberOverride
      ? `WooCommerce lookup ready for order ${manualOrderNumberOverride}.`
      : "WooCommerce lookup is ready when an order number is available."
  );
  pushKatanaDebug("Panel data rendered", elements.refreshStatus.textContent);
}

function formatSspFieldLabel(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSspFieldValue(value) {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function createSspFieldList(record = {}, omittedKeys = []) {
  const list = document.createElement("dl");
  list.className = "skp-ssp-field-list";

  Object.entries(record)
    .filter(([key]) => !omittedKeys.includes(key))
    .forEach(([key, value]) => {
      const row = document.createElement("div");
      const label = document.createElement("dt");
      const fieldValue = document.createElement("dd");
      label.textContent = formatSspFieldLabel(key);
      fieldValue.textContent = formatSspFieldValue(value);
      row.append(label, fieldValue);
      list.appendChild(row);
    });

  return list;
}

function renderSspOrder(order = {}) {
  elements.sspOrderContent.innerHTML = "";

  const headerSection = document.createElement("section");
  headerSection.className = "skp-detail-card";
  const headerTitle = document.createElement("h3");
  headerTitle.textContent = "Order Header";
  headerSection.append(headerTitle, createSspFieldList(order, ["items"]));
  elements.sspOrderContent.appendChild(headerSection);

  const lineItems = Array.isArray(order.items) ? order.items : [];
  const itemsSection = document.createElement("section");
  itemsSection.className = "skp-detail-card";
  const itemsTitle = document.createElement("h3");
  itemsTitle.textContent = `Line Items (${lineItems.length})`;
  itemsSection.appendChild(itemsTitle);

  if (!lineItems.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "skp-meta";
    emptyState.textContent = "No line items returned.";
    itemsSection.appendChild(emptyState);
  } else {
    lineItems.forEach((item, index) => {
      const itemGroup = document.createElement("section");
      itemGroup.className = "skp-ssp-line-item";
      const itemTitle = document.createElement("h4");
      itemTitle.textContent = `Item ${index + 1}${item.sku ? ` · ${item.sku}` : ""}`;
      itemGroup.append(itemTitle, createSspFieldList(item));
      itemsSection.appendChild(itemGroup);
    });
  }

  elements.sspOrderContent.appendChild(itemsSection);
}

async function requestSspOrder() {
  const orderNumber = focusedOrderNumber;

  if (!orderNumber.startsWith("SSP")) {
    updateSspRequestAvailability(orderNumber);
    return;
  }

  elements.sspOrderModalSubtitle.textContent = `Requesting every available field for ${orderNumber}...`;
  elements.sspOrderContent.innerHTML = '<p class="skp-meta">Resolving the SSP order and loading its line items...</p>';
  openSspOrderModal();
  pushKatanaDebug("Complete SSP order request started", orderNumber);

  const result = await sendRuntimeMessage({
    action: "requestSspSalesOrder",
    payload: { orderNumber }
  });

  if (!result?.ok) {
    elements.sspOrderModalSubtitle.textContent = `Unable to load ${orderNumber}.`;
    elements.sspOrderContent.textContent = result?.error ?? "The SSP order request failed.";
    pushKatanaDebug("Complete SSP order request failed", result?.error ?? "Unknown error");
    return;
  }

  elements.sspOrderModalSubtitle.textContent = `${orderNumber} · internal ID ${result.order?.id ?? "unknown"}`;
  renderSspOrder(result.order);
  pushKatanaDebug("Complete SSP order received", formatDebugPayload("sspOrder", result.apiPayload));
}

function getKatanaSalesOrderIdFromUrl() {
  return new URL(window.location.href).pathname.split("/").filter(Boolean).pop() ?? "";
}

function setAddressMismatchAlert(hasMismatch, differences = []) {
  if (!elements?.addressAlert) {
    return;
  }

  const shippingMismatch = differences.includes("shipping");
  elements.addressAlert.hidden = !hasMismatch;
  elements.addressAlert.querySelector("strong").textContent = shippingMismatch
    ? "Shipping address differs from SSP"
    : "Billing address differs from SSP";
  elements.addressAlert.querySelector("p").textContent = shippingMismatch
    ? "Katana may have an outdated delivery address. Review it or use Request ▾ → Update Address."
    : "Katana may have outdated billing details. Review them or use Request ▾ → Update Address.";
}

async function checkAddressMismatch(orderNumber) {
  setAddressMismatchAlert(false);

  if (!orderNumber.startsWith("SSP")) {
    return;
  }

  const result = await sendRuntimeMessage({
    action: "checkSspKatanaAddressMismatch",
    payload: {
      orderNumber,
      salesOrderId: getKatanaSalesOrderIdFromUrl()
    }
  });

  if (!result?.ok) {
    pushKatanaDebug("Address comparison unavailable", result?.error ?? "Unknown error");
    return;
  }

  setAddressMismatchAlert(result.hasMismatch, result.differences);
  pushKatanaDebug(
    "Address comparison complete",
    result.hasMismatch ? `Mismatch: ${result.differences.join(", ")}` : "Addresses match"
  );
}

async function runKatanaOverwrite(type) {
  const isLineItemUpdate = type === "line-items";
  const label = isLineItemUpdate ? "line items" : "billing and shipping addresses";
  const confirmed = window.confirm(
    `Overwrite Katana ${label} with SSP data for ${focusedOrderNumber}?\n\nThis changes the live Katana sales order and cannot be undone automatically.`
  );

  if (!confirmed) {
    return;
  }

  const action = isLineItemUpdate ? "overwriteKatanaLineItems" : "overwriteKatanaAddresses";
  elements.refreshStatus.textContent = `Updating Katana ${label}...`;
  pushKatanaDebug(`Katana ${label} overwrite started`, focusedOrderNumber);
  const result = await sendRuntimeMessage({
    action,
    payload: {
      orderNumber: focusedOrderNumber,
      salesOrderId: getKatanaSalesOrderIdFromUrl()
    }
  });

  if (!result?.ok) {
    elements.refreshStatus.textContent = result?.error ?? `Unable to update Katana ${label}.`;
    pushKatanaDebug(`Katana ${label} overwrite failed`, result?.error ?? "Unknown error");
    return;
  }

  elements.refreshStatus.textContent = isLineItemUpdate
    ? `Updated ${result.updatedCount} Katana line item(s) from SSP.`
    : "Updated Katana billing and shipping addresses from SSP.";
  pushKatanaDebug(`Katana ${label} overwrite complete`, elements.refreshStatus.textContent);

  if (!isLineItemUpdate) {
    await checkAddressMismatch(focusedOrderNumber);
  }
}

function updateManualOrderStatus(message) {
  if (!elements?.manualOrderStatus) {
    return;
  }

  elements.manualOrderStatus.textContent = message;
}

function updateWooCommerceLookupStatus(message) {
  if (!elements?.wooCommerceLookupStatus) {
    return;
  }

  elements.wooCommerceLookupStatus.textContent = message;
}

function setTextContent(element, value) {
  if (!element) {
    return;
  }

  element.textContent = String(value ?? "N/A");
}

function renderWooCommerceItems(items = []) {
  if (!elements?.wooItems) {
    return;
  }

  elements.wooItems.innerHTML = "";

  if (!items.length) {
    elements.wooItems.textContent = "No line items found.";
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "skp-woo-item-row";
    row.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <p class="skp-meta">SKU: ${item.sku}</p>
      </div>
      <div class="skp-woo-item-meta">
        <span>Qty ${item.quantity}</span>
        <span>${item.total}</span>
      </div>
    `;
    elements.wooItems.appendChild(row);
  });
}

function renderWooCommerceOrder(result) {
  const order = result?.order;

  if (!order) {
    return;
  }

  setTextContent(elements.wooSiteLabel, order.site.label);
  setTextContent(elements.wooOrderStatus, order.order.status);
  setTextContent(elements.wooCustomerName, order.customer.name);
  setLinkedValue(elements.wooCustomerEmail, order.customer.email);
  setTextContent(elements.wooBillingName, order.billing.name);
  setTextContent(elements.wooBillingCompany, order.billing.company);
  setTextContent(elements.wooBillingAddress, order.billing.addressText);
  setTextContent(elements.wooBillingPhone, order.billing.phone);
  setTextContent(elements.wooShippingName, order.shipping.name);
  setTextContent(elements.wooShippingCompany, order.shipping.company);
  setTextContent(elements.wooShippingAddress, order.shipping.addressText);
  setTextContent(
    elements.wooShippingLines,
    order.shippingLines.length
      ? order.shippingLines.map((line) => `${line.method} (${line.total})`).join(", ")
      : "No shipping lines"
  );
  elements.wooCommerceModalSubtitle.textContent = `Order #${order.order.number} from ${order.site.baseUrl}`;
  renderWooCommerceItems(order.items);
  openWooCommerceModal();
}

function extractMeaningfulText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text && text !== "-" && text !== "N/A" ? text : "";
}

function isLikelyOrderNumber(value) {
  const text = extractMeaningfulText(value);

  if (!text || text.length > 40) {
    return false;
  }

  if (/[<>]/.test(text) || /\b(if you're seeing this message|javascript has been disabled|enable js)\b/i.test(text)) {
    return false;
  }

  return /^[A-Z0-9][A-Z0-9._/-]*$/i.test(text) && /[0-9]/.test(text);
}

function getOrderNumberFromLabeledContent() {
  const labelPattern = /\b(sales\s*order\s*#?|sales\s*order\s*number|order\s*#?|order\s*number|order\s*no\.?)\b/i;
  const ignoredValues = new Set(["copy", "copied", "edit", "save"]);
  const candidates = document.querySelectorAll("label, dt, th, div, span, p, h1, h2, h3");

  for (const element of candidates) {
    if (element.closest("noscript")) {
      continue;
    }

    const labelText = extractMeaningfulText(element.textContent);

    if (!labelPattern.test(labelText)) {
      continue;
    }

    const siblingCandidates = [
      element.nextElementSibling,
      element.parentElement?.nextElementSibling,
      ...Array.from(element.parentElement?.children ?? []).filter((node) => node !== element)
    ];

    for (const candidate of siblingCandidates) {
      if (!candidate || candidate.closest("noscript")) {
        continue;
      }

      const candidateText = extractMeaningfulText(candidate?.textContent);

      if (!candidateText) {
        continue;
      }

      const normalizedCandidate = candidateText.toLowerCase();

      if (labelPattern.test(candidateText) || ignoredValues.has(normalizedCandidate) || !isLikelyOrderNumber(candidateText)) {
        continue;
      }

      return candidateText;
    }

    const inlineMatch = labelText.match(/(?:#|number|no\.?)[:\s-]*([A-Z0-9][A-Z0-9._/-]*)$/i);

    if (inlineMatch?.[1] && isLikelyOrderNumber(inlineMatch[1])) {
      return inlineMatch[1];
    }
  }

  return "";
}

function getOrderNumberFromPage() {
  const selectorCandidates = [
    'input[name="orderNo"]',
    'input[name="orderNumber"]',
    'input[name="order_number"]',
    'input[placeholder*="Order" i]',
    'input[aria-label*="Order" i]',
    '[data-testid*="order" i] input',
    '[data-test*="order" i] input'
  ];

  for (const selector of selectorCandidates) {
    const inputValue = extractMeaningfulText(document.querySelector(selector)?.value);

    if (isLikelyOrderNumber(inputValue)) {
      return inputValue;
    }
  }

  return getOrderNumberFromLabeledContent();
}

function wait(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function getOrderNumberWithDelay() {
  const deadline = Date.now() + ORDER_NUMBER_WAIT_MS;
  let orderNumber = "";

  while (Date.now() <= deadline) {
    orderNumber = getOrderNumberFromPage();

    if (orderNumber) {
      return orderNumber;
    }

    await wait(ORDER_NUMBER_POLL_MS);
  }

  return getOrderNumberFromPage();
}

async function lookupWooCommerceOrder() {
  const inferredOrderNumber = extractMeaningfulText(elements?.manualOrderInput?.value)
    || manualOrderNumberOverride
    || getOrderNumberFromPage();

  if (!isLikelyOrderNumber(inferredOrderNumber)) {
    updateWooCommerceLookupStatus("Enter a valid order number before running WooCommerce lookup.");
    return;
  }

  manualOrderNumberOverride = inferredOrderNumber;
  elements.manualOrderInput.value = inferredOrderNumber;
  updateManualOrderStatus(`Manual Sales Order search active: ${inferredOrderNumber}.`);
  updateWooCommerceLookupStatus(`Searching WooCommerce sites for order ${inferredOrderNumber}...`);
  pushKatanaDebug("WooCommerce lookup started", inferredOrderNumber);

  const result = await sendRuntimeMessage({
    action: "lookupWooCommerceOrder",
    payload: {
      orderNumber: inferredOrderNumber
    }
  });

  if (!result?.ok) {
    updateWooCommerceLookupStatus(result?.error ?? "WooCommerce lookup failed.");
    pushKatanaDebug("WooCommerce lookup failed", result?.error ?? "Unknown error");
    return;
  }

  if (result.apiPayload !== undefined) {
    pushKatanaDebug("WooCommerce API payload received", formatDebugPayload("woocommerce", result.apiPayload));
  }

  renderWooCommerceOrder(result);
  updateWooCommerceLookupStatus(`WooCommerce match found on ${result.site.label}.`);
  pushKatanaDebug("WooCommerce lookup matched", `${result.site.label} / ${result.order?.order?.number ?? inferredOrderNumber}`);
}

async function loadPanelData({ preserveView = false } = {}) {
  if (!elements) {
    return;
  }

  elements.refreshStatus.textContent = "Waiting for Katana order details...";
  pushKatanaDebug("Load started", "Waiting for Katana order details");

  if (!preserveView && lastVerifiedAt) {
    showVerifiedSplash(lastVerifiedAt, "Loading customer and sales order data...");
  }

  try {
    const orderNumber = manualOrderNumberOverride || await getOrderNumberWithDelay();
    updateSspRequestAvailability(orderNumber);

    if (manualOrderNumberOverride) {
      elements.manualOrderInput.value = manualOrderNumberOverride;
      updateManualOrderStatus(`Manual Sales Order search active: ${manualOrderNumberOverride}.`);
      updateWooCommerceLookupStatus(`WooCommerce lookup ready for order ${manualOrderNumberOverride}.`);
      pushKatanaDebug("Manual order override", manualOrderNumberOverride);
    } else if (!orderNumber) {
      updateManualOrderStatus("No Sales Order number found on the Katana page. Enter one here to search manually.");
      updateWooCommerceLookupStatus("No order number available yet for WooCommerce lookup.");
      pushKatanaDebug("Order number resolved", "No order number found");
      elements.refreshStatus.textContent = "Automatic lookup paused. Enter a Sales Order number to search manually.";

      if (lastVerifiedAt) {
        showVerifiedSplash(lastVerifiedAt, "No Sales Order number found on the Katana page. Enter one below to search manually.");
      }

      return;
    } else {
      updateManualOrderStatus(`Katana order detected: ${orderNumber}. You can override it below if needed.`);
      updateWooCommerceLookupStatus(`WooCommerce lookup ready for order ${orderNumber}.`);
      pushKatanaDebug("Order number resolved", orderNumber);
    }

    elements.refreshStatus.textContent = "Refreshing data from Singularity endpoints...";
    pushKatanaDebug("Fetching panel data", "Refreshing data from Singularity endpoints");
    const result = await sendRuntimeMessage({
      action: "refreshPanelData",
      payload: {
        pageUrl: window.location.href,
        orderNumber
      }
    });

    if (!result.ok) {
      throw new Error(result.error ?? "Unable to load panel data.");
    }

    if (result.apiPayloads?.salesOrder !== undefined) {
      pushKatanaDebug("Sales order API payload received", formatDebugPayload("salesOrder", result.apiPayloads.salesOrder));
    }

    if (result.apiPayloads?.customer !== undefined) {
      pushKatanaDebug("Customer API payload received", formatDebugPayload("customer", result.apiPayloads.customer));
    }

    setView("dashboard");
    renderPanelData(result);
    await checkAddressMismatch(orderNumber);
  } catch (error) {
    pushKatanaDebug("Load failed", error.message);
    if (!manualOrderNumberOverride) {
      updateManualOrderStatus("Automatic lookup did not finish. Enter a Sales Order number to search manually.");
      updateWooCommerceLookupStatus("WooCommerce lookup is available if you enter an order number manually.");
    }
    if (lastVerifiedAt) {
      showVerifiedSplash(lastVerifiedAt, error.message);
      return;
    }

    showAuthView(error.message);
  }
}

function ensureMethodHighlightStyles() {
  if (document.getElementById("skp-method-highlight-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "skp-method-highlight-styles";
  style.textContent = `
    .${METHOD_LOW_STOCK_CLASS} {
      background-color: rgba(255, 0, 0, 0.08) !important;
    }

    .${METHOD_IN_STOCK_CLASS} {
      background-color: rgba(0, 128, 0, 0.08) !important;
    }

    .${METHOD_CLOSE_STOCK_CLASS} {
      background-color: rgba(255, 204, 0, 0.18) !important;
    }
  `;
  document.head.appendChild(style);
}

function getMethodRowId(rowPrefix, rowIndex) {
  return `${rowPrefix}-ROW-${rowIndex}`;
}

function getMethodElementId(rowPrefix, rowIndex, suffix) {
  return `${getMethodRowId(rowPrefix, rowIndex)}-${suffix}`;
}

function getTextInputValueById(id) {
  const element = document.getElementById(id);

  if (!element) {
    return "";
  }

  if ("value" in element) {
    return extractMeaningfulText(element.value);
  }

  return extractMeaningfulText(element.textContent);
}

function getFirstTextInputValueByIds(ids) {
  for (const id of ids) {
    const value = getTextInputValueById(id);

    if (value) {
      return value;
    }
  }

  return "";
}

function parseNumericValue(value) {
  const normalized = String(value ?? "").replace(/,/g, "").trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function clearMethodRowHighlight(rowElement) {
  rowElement.classList.remove(METHOD_LOW_STOCK_CLASS, METHOD_IN_STOCK_CLASS, METHOD_CLOSE_STOCK_CLASS);
}

function applyMethodRowHighlight(rowElement, highlightClass) {
  rowElement.classList.remove(METHOD_LOW_STOCK_CLASS, METHOD_IN_STOCK_CLASS, METHOD_CLOSE_STOCK_CLASS);
  rowElement.classList.add(highlightClass);
}

async function evaluateMethodRow(rowPrefix, rowIndex) {
  const rowElement = document.getElementById(getMethodRowId(rowPrefix, rowIndex));

  if (!rowElement) {
    return;
  }

  clearMethodRowHighlight(rowElement);

  const itemSku = getTextInputValueById(getMethodElementId(rowPrefix, rowIndex, "3"));

  if (!itemSku) {
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, "No SKU found");
    return;
  }

  pushMethodDebug(`${rowPrefix} row ${rowIndex}`, `SKU ${itemSku}`);

  const inventoryResult = await sendRuntimeMessage({
    action: "fetchInventoryBySku",
    payload: {
      itemSku
    }
  });
  pushMethodRequestDebugTraces(inventoryResult?.debugTrace);

  if (!inventoryResult?.ok) {
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, inventoryResult?.error ?? inventoryResult?.reason ?? "Inventory lookup failed");
    return;
  }

  if (inventoryResult.apiPayload !== undefined) {
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, formatDebugPayload("inventory", inventoryResult.apiPayload));
  }

  if (!inventoryResult.inventory) {
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, `No inventory match for SKU ${itemSku}`);
    return;
  }

  pushMethodDebug(
    `${rowPrefix} row ${rowIndex}`,
    `Inventory matched itemsku=${String(inventoryResult.inventory.itemsku ?? "")} availableqty=${String(inventoryResult.inventory.availableqty ?? "")}`
  );

  const quantityRawValue = getFirstTextInputValueByIds([
    getMethodElementId(rowPrefix, rowIndex, "5-Quantity-Input"),
    getMethodElementId(rowPrefix, rowIndex, "5-Quantity-TextInput"),
    getMethodElementId(rowPrefix, rowIndex, "5")
  ]);
  const quantityValue = parseNumericValue(quantityRawValue);
  const availableQty = parseNumericValue(inventoryResult.inventory.availableqty);

  if (quantityValue === null || availableQty === null) {
    pushMethodDebug(
      `${rowPrefix} row ${rowIndex}`,
      `Non-numeric quantity check. quantityRaw=${quantityRawValue || "empty"} quantity=${String(quantityValue)} available=${String(availableQty)}`
    );
    return;
  }

  if (quantityValue > availableQty) {
    applyMethodRowHighlight(rowElement, METHOD_LOW_STOCK_CLASS);
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, `LOW STOCK quantity=${quantityValue} available=${availableQty}`);
    return;
  }

  if (availableQty - quantityValue <= 5) {
    applyMethodRowHighlight(rowElement, METHOD_CLOSE_STOCK_CLASS);
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, `CLOSE STOCK quantity=${quantityValue} available=${availableQty}`);
    return;
  }

  if (quantityValue < availableQty) {
    applyMethodRowHighlight(rowElement, METHOD_IN_STOCK_CLASS);
    pushMethodDebug(`${rowPrefix} row ${rowIndex}`, `IN STOCK quantity=${quantityValue} available=${availableQty}`);
    return;
  }

  pushMethodDebug(`${rowPrefix} row ${rowIndex}`, `EVEN quantity=${quantityValue} available=${availableQty}`);
}

async function scanMethodInvoiceRows() {
  if (methodScanInProgress) {
    methodScanQueued = true;
    pushMethodDebug("Scan deferred", "A scan is already running");
    return;
  }

  methodScanInProgress = true;
  const authState = await sendRuntimeMessage({ action: "getAuthState" });

  if (!authState?.isVerified) {
    pushMethodDebug("Scan skipped", "No verified credentials");
    setMethodSyncStatus({
      hidden: false,
      tone: "neutral",
      text: "Sync check unavailable until Katana credentials are verified.",
      summaryText: "Sync Unavailable - Singularity Debug"
    });
    methodScanInProgress = false;
    return;
  }

  ensureMethodHighlightStyles();
  ensureMethodDebugWindow();
  ensureMethodSyncWindow();
  pushMethodDebug("Scan started", `Checking rows 0-${METHOD_ROW_LIMIT}`);

  try {
    const documentReference = getMethodDocumentReference();
    const syncCheckKey = `${window.location.href}::${documentReference.type}::${documentReference.invoiceNumber}`;

    if (documentReference.type === "estimate") {
      setMethodSyncStatus({
        hidden: false,
        tone: "success",
        text: `✓ Synced. Found ${documentReference.invoiceNumber}.`,
        summaryText: "Synced - Singularity Debug"
      });
      pushMethodDebug("Sync status", `Marked synced for estimate ${documentReference.invoiceNumber}`);
    } else if (!documentReference.invoiceNumber) {
      setMethodSyncStatus({
        hidden: false,
        tone: "danger",
        text: "✕ Not Synced. Invoice number was not found on the page.",
        summaryText: "Not Synced - Singularity Debug"
      });
      pushMethodDebug("Sync status", "Invoice number not found on page");
      methodLastSyncCheckKey = syncCheckKey;
    } else if (methodLastSyncCheckKey === syncCheckKey) {
      pushMethodDebug("Sync status", `Using cached sync status for Invoice: ${documentReference.invoiceNumber}`);
    } else {
      methodLastSyncCheckKey = syncCheckKey;
      setMethodSyncStatus({
        hidden: false,
        tone: "neutral",
        text: `Checking sync for Invoice: ${documentReference.invoiceNumber}...`,
        summaryText: "Checking Sync - Singularity Debug"
      });

      const syncResult = await sendRuntimeMessage({
        action: "checkMethodOrderSync",
        payload: {
          invoiceNumber: documentReference.invoiceNumber
        }
      });
      console.debug("[Singularity] sync check result", {
        invoiceNumber: documentReference.invoiceNumber,
        syncResult
      });
      pushMethodRequestDebugTraces(syncResult?.debugTrace);

      if (!syncResult?.ok) {
        setMethodSyncStatus({
          hidden: false,
          tone: "danger",
          text: `✕ Not Synced. ${syncResult?.error ?? "Sync check failed."}`,
          summaryText: "Not Synced - Singularity Debug"
        });
        pushMethodDebug("Sync status failed", syncResult?.error ?? "Unknown sync check failure");
      } else if (syncResult.status === "hidden" || syncResult.status === "synced") {
        setMethodSyncStatus({
          hidden: false,
          tone: "success",
          text: `✓ Synced. Found ${syncResult.matchedExternalId ?? documentReference.invoiceNumber}.`,
          summaryText: "Synced - Singularity Debug"
        });
        pushMethodDebug("Sync status", `Synced via ${syncResult.matchedExternalId ?? documentReference.invoiceNumber}`);
      } else {
        setMethodSyncStatus({
          hidden: false,
          tone: "danger",
          text: `✕ Not Synced. No sales order found for Invoice: ${documentReference.invoiceNumber}.`,
          summaryText: "Not Synced - Singularity Debug"
        });
        pushMethodDebug("Sync status", `No sales order found for Invoice: ${documentReference.invoiceNumber}`);
      }
    }

    const tasks = [];

    for (const rowPrefix of METHOD_ROW_PREFIXES) {
      for (let rowIndex = 0; rowIndex <= METHOD_ROW_LIMIT; rowIndex += 1) {
        tasks.push(evaluateMethodRow(rowPrefix, rowIndex));
      }
    }

    await Promise.all(tasks);
    pushMethodDebug("Scan finished");
  } finally {
    methodScanInProgress = false;

    if (methodScanQueued) {
      methodScanQueued = false;
      scheduleMethodRowScan();
    }
  }
}

function scheduleMethodRowScan() {
  if (!featureSettings.methodEnabled) {
    return;
  }

  if (methodRuntimeDisconnected) {
    pushMethodDebug("Scan paused", "Background connection is unavailable");
    return;
  }

  window.clearTimeout(methodScanTimeoutId);
  pushMethodDebug("Scan scheduled", `${METHOD_SCAN_DEBOUNCE_MS}ms debounce`);
  methodScanTimeoutId = window.setTimeout(() => {
    scanMethodInvoiceRows().catch((error) => {
      pushMethodDebug("Scan failed", error.message);
      if (isRuntimeConnectionError(error) || /background is unavailable/i.test(String(error?.message ?? ""))) {
        setMethodSyncStatus({
          hidden: false,
          tone: "danger",
          text: error.message
        });
      }
      console.error("Method inventory scan failed.", error);
    });
  }, METHOD_SCAN_DEBOUNCE_MS);
}

async function bootstrapMethodMode() {
  if (!isMethodUrl(window.location.href)) {
    return;
  }

  await refreshFeatureSettings();

  if (!featureSettings.methodEnabled) {
    window.clearTimeout(methodScanTimeoutId);
    document.getElementById(METHOD_DEBUG_HOST_ID)?.remove();
    return;
  }

  methodRuntimeDisconnected = false;
  resetMethodSyncState();
  scheduleMethodRowScan();
}

async function bootstrapPanel() {
  if (!isTargetUrl(window.location.href) || panelBootstrapInProgress) {
    return;
  }

  await refreshFeatureSettings();

  if (!featureSettings.katanaEnabled) {
    elements?.host?.remove();
    elements = null;
    return;
  }

  const panel = createPanel();

  if (!panel) {
    schedulePanelBootstrapRetry();
    return;
  }

  panelBootstrapInProgress = true;

  try {
    const authState = await sendRuntimeMessage({ action: "getAuthState" });
    lastVerifiedAt = authState.verifiedAt ?? null;

    if (authState.isVerified) {
      showVerifiedSplash(authState.verifiedAt, "Loading customer and sales order data...");
      await loadPanelData({ preserveView: false });
    } else {
      showAuthView("No verified key pair stored.");
    }
  } finally {
    panelBootstrapInProgress = false;
  }
}

function normalizeMapsText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findVisibleEmail(container) {
  const text = normalizeMapsText(container?.innerText ?? "");
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? "";
}

function getMapsField(selector, attribute = "textContent") {
  const element = document.querySelector(selector);
  const value = attribute === "href" ? element?.href : element?.textContent;
  return normalizeMapsText(value);
}

function extractGoogleMapsBusiness() {
  const main = document.querySelector('[role="main"]') ?? document.body;
  const companyName = normalizeMapsText(document.querySelector("h1")?.textContent);
  const email = findVisibleEmail(main);
  const website = getMapsField('a[data-item-id="authority"]', "href")
    || getMapsField('a[aria-label*="Website" i]', "href");
  const phone = getMapsField('button[data-item-id^="phone"]')
    || getMapsField('[aria-label*="Phone" i]');
  const address = getMapsField('button[data-item-id="address"]')
    || getMapsField('[aria-label*="Address" i]');

  return {
    companyName,
    email,
    phone,
    website,
    address,
    sourceUrl: window.location.href
  };
}

function hasWebsiteEmailScanRequirements(business) {
  return Boolean(business.phone && business.address && business.website);
}

function getGoogleMapsInsertTarget() {
  return document.querySelector("h1")?.parentElement
    ?? document.querySelector('[role="main"]')
    ?? document.body;
}

function setGoogleMapsCrmStatus(message, tone = "neutral") {
  const status = document.getElementById(GOOGLE_MAPS_CRM_STATUS_ID);

  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.tone = tone;
}

function removeGoogleMapsCrmControl() {
  document.getElementById(GOOGLE_MAPS_CRM_HOST_ID)?.remove();
  lastGoogleMapsBusinessKey = "";
}

function createGoogleMapsCrmControl(business) {
  const host = document.createElement("section");
  host.id = GOOGLE_MAPS_CRM_HOST_ID;
  host.style.margin = "12px 0";
  host.style.padding = "12px";
  host.style.border = "1px solid rgba(0, 0, 0, 0.12)";
  host.style.borderRadius = "8px";
  host.style.background = "#fff";
  host.style.boxShadow = "0 1px 4px rgba(0, 0, 0, 0.14)";
  host.style.fontFamily = "Arial, sans-serif";
  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:700;color:#1f1f1f;">Singularity CRM</div>
        <div id="${GOOGLE_MAPS_CRM_STATUS_ID}" data-tone="neutral" style="margin-top:4px;font-size:12px;line-height:1.35;color:#5f6368;">${business.email ? `Ready to add ${business.email}.` : "Checking the business website for a contact email..."}</div>
      </div>
      <button type="button" ${business.email ? "" : "disabled"} style="border:0;border-radius:4px;padding:8px 10px;background:${business.email ? "#1a73e8" : "#dadce0"};color:${business.email ? "#fff" : "#5f6368"};font-size:12px;font-weight:700;cursor:${business.email ? "pointer" : "not-allowed"};white-space:nowrap;">Add to CRM</button>
    </div>
  `;

  const button = host.querySelector("button");
  const setButtonEnabled = (isEnabled) => {
    button.disabled = !isEnabled;
    button.style.background = isEnabled ? "#1a73e8" : "#dadce0";
    button.style.color = isEnabled ? "#fff" : "#5f6368";
    button.style.cursor = isEnabled ? "pointer" : "not-allowed";
  };

  const applyEmail = (email, sourceUrl = "") => {
    business.email = email;
    business.websiteEmailSourceUrl = sourceUrl;
    setButtonEnabled(true);
    setGoogleMapsCrmStatus(`Ready to add ${email}.`, "success");
  };

  const scanWebsiteForEmail = async () => {
    if (business.email) {
      return;
    }

    if (!hasWebsiteEmailScanRequirements(business)) {
      setGoogleMapsCrmStatus("Need a phone number, address, and website before searching for a contact email.", "neutral");
      return;
    }

    const cachedEmail = googleMapsWebsiteEmailCache.get(business.website);

    if (cachedEmail) {
      applyEmail(cachedEmail.email, cachedEmail.sourceUrl);
      return;
    }

    setButtonEnabled(false);
    setGoogleMapsCrmStatus("Searching website for a contact email...");
    const result = await sendRuntimeMessage({
      action: "findEmailOnWebsite",
      payload: {
        website: business.website
      }
    });

    if (!result?.ok || !result.email) {
      setGoogleMapsCrmStatus(result?.error ?? "No contact email found on the business website.", "neutral");
      return;
    }

    googleMapsWebsiteEmailCache.set(business.website, {
      email: result.email,
      sourceUrl: result.sourceUrl
    });
    applyEmail(result.email, result.sourceUrl);
  };

  button?.addEventListener("click", async () => {
    const latestBusiness = {
      ...extractGoogleMapsBusiness(),
      email: business.email || extractGoogleMapsBusiness().email,
      websiteEmailSourceUrl: business.websiteEmailSourceUrl
    };

    if (!latestBusiness.email) {
      setGoogleMapsCrmStatus("No contact email found yet for this business.", "danger");
      return;
    }

    button.disabled = true;
    button.textContent = "Adding...";
    setGoogleMapsCrmStatus(`Checking CRM for ${latestBusiness.email}...`);

    const result = await sendRuntimeMessage({
      action: "createCustomerFromGoogleMaps",
      payload: latestBusiness
    });

    if (!result?.ok) {
      button.disabled = false;
      button.textContent = "Add to CRM";
      setGoogleMapsCrmStatus(result?.error ?? "Unable to add this business to CRM.", "danger");
      return;
    }

    if (result.status === "already_exists") {
      button.textContent = "Already in CRM";
      setGoogleMapsCrmStatus(`${latestBusiness.email} is already a Singularity CRM customer.`, "success");
      return;
    }

    button.textContent = "Added";
    setGoogleMapsCrmStatus(`${latestBusiness.companyName} was added to Singularity CRM.`, "success");
  });

  scanWebsiteForEmail().catch((error) => {
    setGoogleMapsCrmStatus(error.message, "danger");
  });

  return host;
}

async function renderGoogleMapsCrmControl() {
  if (!isGoogleMapsUrl(window.location.href)) {
    removeGoogleMapsCrmControl();
    return;
  }

  await refreshFeatureSettings();

  if (!featureSettings.googleMapsCrmEnabled) {
    removeGoogleMapsCrmControl();
    return;
  }

  const business = extractGoogleMapsBusiness();
  const businessKey = `${business.companyName}::${business.email}::${business.phone}::${business.address}::${business.website}::${business.sourceUrl}`;

  if (!business.companyName) {
    removeGoogleMapsCrmControl();
    return;
  }

  if (businessKey === lastGoogleMapsBusinessKey && document.getElementById(GOOGLE_MAPS_CRM_HOST_ID)) {
    return;
  }

  removeGoogleMapsCrmControl();
  lastGoogleMapsBusinessKey = businessKey;
  const target = getGoogleMapsInsertTarget();
  target.insertAdjacentElement("afterend", createGoogleMapsCrmControl(business));
}

function scheduleGoogleMapsCrmRender() {
  if (!isGoogleMapsUrl(window.location.href)) {
    return;
  }

  window.clearTimeout(googleMapsRenderTimeoutId);
  googleMapsRenderTimeoutId = window.setTimeout(() => {
    renderGoogleMapsCrmControl().catch((error) => {
      console.error("Google Maps CRM control failed.", error);
    });
  }, 600);
}

function watchUrlChanges() {
  const observer = new MutationObserver(async () => {
    if (window.location.href === currentUrl) {
      if (isTargetUrl(currentUrl)) {
        schedulePanelPresenceCheck();
      }
      return;
    }

    currentUrl = window.location.href;

    if (isTargetUrl(currentUrl)) {
      await bootstrapPanel();
    } else if (isMethodUrl(currentUrl)) {
      await bootstrapMethodMode();
    } else if (isGoogleMapsUrl(currentUrl)) {
      scheduleGoogleMapsCrmRender();
    } else {
      elements?.host?.remove();
      elements = null;
      window.clearTimeout(methodScanTimeoutId);
      window.clearTimeout(panelBootstrapRetryTimeoutId);
      window.clearTimeout(panelPresenceCheckTimeoutId);
      window.clearTimeout(googleMapsRenderTimeoutId);
      removeGoogleMapsCrmControl();
      resetMethodSyncState();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

bootstrapPanel();
bootstrapMethodMode();
scheduleGoogleMapsCrmRender();
watchUrlChanges();

const methodDomObserver = new MutationObserver((mutations) => {
  if (!isMethodUrl(window.location.href) || !featureSettings.methodEnabled) {
    return;
  }

  const shouldScan = mutations.some((mutation) => {
    if (mutation.type !== "childList") {
      return false;
    }

    if (isMethodInternalNode(mutation.target)) {
      return false;
    }

    const addedNodes = Array.from(mutation.addedNodes ?? []);
    const removedNodes = Array.from(mutation.removedNodes ?? []);
    return [...addedNodes, ...removedNodes].some((node) => !isMethodInternalNode(node));
  });

  if (!shouldScan) {
    return;
  }

  scheduleMethodRowScan();
});

methodDomObserver.observe(document.body ?? document.documentElement, {
  childList: true,
  subtree: true
});

const googleMapsDomObserver = new MutationObserver(() => {
  if (!isGoogleMapsUrl(window.location.href)) {
    return;
  }

  scheduleGoogleMapsCrmRender();
});

googleMapsDomObserver.observe(document.body ?? document.documentElement, {
  childList: true,
  subtree: true
});
