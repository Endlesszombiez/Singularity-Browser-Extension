const TARGET_URL_PREFIX = "https://factory.katanamrp.com/salesorder/";
const METHOD_URL_PREFIX = "https://botanaway.method.me/apps/";
const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const PANEL_ID = "singularity-katana-panel-root";
const PANEL_HOST_ID = "singularity-katana-panel-host";
const PANEL_DEBUG_LOG_ID = "skp-panel-debug-log";
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
let panelBootstrapInProgress = false;
let panelBootstrapRetryTimeoutId = null;
let panelPresenceCheckTimeoutId = null;
let isRemoveCredentialsModalOpen = false;

function isTargetUrl(url) {
  return url.startsWith(TARGET_URL_PREFIX);
}

function isMethodUrl(url) {
  return url.startsWith(METHOD_URL_PREFIX);
}

function sendRuntimeMessage(message) {
  return runtimeApi.sendMessage(message);
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
  host.style.top = "50%";
  host.style.transform = "translate(-50%, -50%)";
  host.style.width = "360px";
  host.style.maxHeight = "45vh";
  host.style.zIndex = "2147483647";
  host.style.background = "rgba(18, 18, 18, 0.75)";
  host.style.color = "#f5f5f5";
  host.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  host.style.borderRadius = "5px";
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
    <div id="${METHOD_DEBUG_LOG_ID}" style="padding:8px 10px;overflow:auto;max-height:calc(45vh - 36px);white-space:pre-wrap;"></div>
  `;

  document.body.appendChild(host);
  const toggleButton = host.querySelector("#" + METHOD_DEBUG_TOGGLE_ID);
  if (toggleButton) {
    toggleButton.addEventListener("click", function () {
      methodDebugMinimized = !methodDebugMinimized;
      updateMethodDebugWindow();
    });
  }
  updateMethodDebugWindow();
  return host;
}

function updateMethodDebugWindow() {
  const host = document.getElementById(METHOD_DEBUG_HOST_ID);
  const logElement = document.getElementById(METHOD_DEBUG_LOG_ID);
  const toggleButton = document.getElementById(METHOD_DEBUG_TOGGLE_ID);

  if (!host || !logElement || !toggleButton) {
    return;
  }

  host.style.width = methodDebugMinimized ? "180px" : "360px";
  logElement.style.display = methodDebugMinimized ? "none" : "block";
  toggleButton.textContent = methodDebugMinimized ? "+" : "_";
  toggleButton.title = methodDebugMinimized ? "Expand debug window" : "Minimize debug window";
}

function pushMethodDebug(message, detail) {
  if (!isMethodUrl(window.location.href)) {
    return;
  }

  ensureMethodDebugWindow();
  const timestamp = new Date().toLocaleTimeString();
  const suffix = detail ? ": " + detail : "";
  const line = "[" + timestamp + "] " + message + suffix;

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

function formatDebugPayload(label, payload) {
  if (payload === undefined) {
    return label + ": undefined";
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
    serialized = serialized.slice(0, DEBUG_PAYLOAD_MAX_LENGTH) + "\n... [truncated]";
  }

  return label + ":\n" + serialized;
}

function isMethodInternalNode(node) {
  if (!(node instanceof Element)) {
    return false;
  }

  return Boolean(
    node.closest("#" + METHOD_DEBUG_HOST_ID) ||
    node.closest("#skp-method-highlight-styles")
  );
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

function pushKatanaDebug(message, detail) {
  const timestamp = new Date().toLocaleTimeString();
  const suffix = detail ? ": " + detail : "";
  const line = "[" + timestamp + "] " + message + suffix;

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
  elements.minimizeButton.textContent = isKatanaPanelMinimized ? "+" : "_";
  elements.minimizeButton.title = isKatanaPanelMinimized ? "Expand panel" : "Minimize panel";
  updateHeaderActionVisibility();
  updateRemoveCredentialsModalState();
}

function updateHeaderActionVisibility() {
  if (!elements?.headerActionGroup) {
    return;
  }

  elements.headerActionGroup.hidden = isKatanaPanelMinimized || currentPanelView === "auth";
}

function updateRemoveCredentialsModalState() {
  if (!elements?.removeCredentialsModal) {
    return;
  }

  const shouldShowModal = isRemoveCredentialsModalOpen && !isKatanaPanelMinimized;
  elements.removeCredentialsModal.hidden = !shouldShowModal;
  elements.removeCredentialsModal.setAttribute("aria-hidden", String(!shouldShowModal));
}

function openRemoveCredentialsModal() {
  isRemoveCredentialsModalOpen = true;
  updateRemoveCredentialsModalState();
}

function closeRemoveCredentialsModal() {
  isRemoveCredentialsModalOpen = false;
  updateRemoveCredentialsModalState();
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
          </div>
          <button type="button" class="skp-window-toggle" data-action="toggle-minimize" title="Minimize panel">_</button>
        </div>
      </header>
      <div class="skp-body">
        <section class="skp-main-pane">
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
                  <button type="button" class="skp-ghost" data-action="clear-manual-order">Use Katana Order</button>
                </div>
              </form>
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
    </div>
  `;

  host.appendChild(root);
  document.body.appendChild(host);

  elements = {
    host,
    shell: root.querySelector(".skp-shell"),
    header: root.querySelector(".skp-header"),
    headerActionGroup: root.querySelector(".skp-header-panel-actions"),
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
    panelDebugLog: root.querySelector("#" + PANEL_DEBUG_LOG_ID),
    removeCredentialsModal: root.querySelector("#skp-remove-api-key-modal")
  };
  updateKatanaDebugLog();
  updateKatanaPanelMinimizedState();
  updateHeaderActionVisibility();
  updateRemoveCredentialsModalState();

  root.addEventListener("click", async function (event) {
    if (event.target === elements.removeCredentialsModal) {
      closeRemoveCredentialsModal();
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;

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

    if (action === "clear-manual-order") {
      manualOrderNumberOverride = "";
      elements.manualOrderForm.reset();
      updateManualOrderStatus("Katana order auto-detection is active.");
      pushKatanaDebug("Manual order override cleared");
      await loadPanelData({ preserveView: true });
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

  root.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isRemoveCredentialsModalOpen) {
      closeRemoveCredentialsModal();
    }
  });

  function setSecretVisibility(isVisible) {
    elements.secretInput.type = isVisible ? "text" : "password";
    elements.revealSecretButton.textContent = isVisible ? "Release to hide" : "Hold to reveal";
  }

  elements.revealSecretButton.addEventListener("pointerdown", function (event) {
    event.preventDefault();
    setSecretVisibility(true);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach(function (eventName) {
    elements.revealSecretButton.addEventListener(eventName, function () {
      setSecretVisibility(false);
    });
  });

  elements.manualOrderForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const orderNumber = extractMeaningfulText(elements.manualOrderInput.value);

    if (!isLikelyOrderNumber(orderNumber)) {
      updateManualOrderStatus("Enter a valid Sales Order number to search manually.");
      return;
    }

    manualOrderNumberOverride = orderNumber;
    elements.manualOrderInput.value = orderNumber;
    updateManualOrderStatus("Manual Sales Order search active: " + orderNumber + ".");
    pushKatanaDebug("Manual order override set", orderNumber);
    await loadPanelData({ preserveView: true });
  });

  elements.authForm.addEventListener("submit", async function (event) {
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

function schedulePanelBootstrapRetry(delayMs) {
  const retryDelay = typeof delayMs === "number" ? delayMs : 250;
  window.clearTimeout(panelBootstrapRetryTimeoutId);
  panelBootstrapRetryTimeoutId = window.setTimeout(function () {
    bootstrapPanel().catch(function (error) {
      console.error("Katana panel retry failed.", error);
    });
  }, retryDelay);
}

function schedulePanelPresenceCheck() {
  if (!isTargetUrl(window.location.href)) {
    return;
  }

  window.clearTimeout(panelPresenceCheckTimeoutId);
  panelPresenceCheckTimeoutId = window.setTimeout(function () {
    if (panelBootstrapInProgress || document.getElementById(PANEL_HOST_ID)) {
      return;
    }

    bootstrapPanel().catch(function (error) {
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
  updateManualOrderStatus(
    manualOrderNumberOverride
      ? "Manual Sales Order search active: " + manualOrderNumberOverride + "."
      : "Katana order auto-detection is active."
  );
  pushKatanaDebug("Panel data rendered", elements.refreshStatus.textContent);
}

function updateManualOrderStatus(message) {
  if (!elements?.manualOrderStatus) {
    return;
  }

  elements.manualOrderStatus.textContent = message;
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

    if (manualOrderNumberOverride) {
      elements.manualOrderInput.value = manualOrderNumberOverride;
      updateManualOrderStatus("Manual Sales Order search active: " + manualOrderNumberOverride + ".");
      pushKatanaDebug("Manual order override", manualOrderNumberOverride);
    } else if (!orderNumber) {
      updateManualOrderStatus("No Sales Order number found on the Katana page. Enter one here to search manually.");
      pushKatanaDebug("Order number resolved", "No order number found");
      elements.refreshStatus.textContent = "Automatic lookup paused. Enter a Sales Order number to search manually.";

      if (lastVerifiedAt) {
        showVerifiedSplash(lastVerifiedAt, "No Sales Order number found on the Katana page. Enter one below to search manually.");
      }

      return;
    } else {
      updateManualOrderStatus("Katana order detected: " + orderNumber + ". You can override it below if needed.");
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
  } catch (error) {
    pushKatanaDebug("Load failed", error.message);
    if (!manualOrderNumberOverride) {
      updateManualOrderStatus("Automatic lookup did not finish. Enter a Sales Order number to search manually.");
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
    pushMethodDebug(rowPrefix + " row " + rowIndex, "No SKU found");
    return;
  }

  pushMethodDebug(rowPrefix + " row " + rowIndex, "SKU " + itemSku);

  const inventoryResult = await sendRuntimeMessage({
    action: "fetchInventoryBySku",
    payload: {
      itemSku: itemSku
    }
  });

  if (!inventoryResult?.ok) {
    pushMethodDebug(rowPrefix + " row " + rowIndex, inventoryResult?.error ?? inventoryResult?.reason ?? "Inventory lookup failed");
    return;
  }

  if (inventoryResult.apiPayload !== undefined) {
    pushMethodDebug(
      rowPrefix + " row " + rowIndex,
      formatDebugPayload("inventory", inventoryResult.apiPayload)
    );
  }

  if (!inventoryResult.inventory) {
    pushMethodDebug(rowPrefix + " row " + rowIndex, "No inventory match for SKU " + itemSku);
    return;
  }

  pushMethodDebug(
    rowPrefix + " row " + rowIndex,
    "Inventory matched itemsku=" + String(inventoryResult.inventory.itemsku ?? "") +
      " availableqty=" + String(inventoryResult.inventory.availableqty ?? "")
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
      rowPrefix + " row " + rowIndex,
      "Non-numeric quantity check. quantityRaw=" + (quantityRawValue || "empty") +
        " quantity=" + String(quantityValue) + " available=" + String(availableQty)
    );
    return;
  }

  if (quantityValue > availableQty) {
    applyMethodRowHighlight(rowElement, METHOD_LOW_STOCK_CLASS);
    pushMethodDebug(rowPrefix + " row " + rowIndex, "LOW STOCK quantity=" + quantityValue + " available=" + availableQty);
    return;
  }

  if (availableQty - quantityValue <= 5) {
    applyMethodRowHighlight(rowElement, METHOD_CLOSE_STOCK_CLASS);
    pushMethodDebug(rowPrefix + " row " + rowIndex, "CLOSE STOCK quantity=" + quantityValue + " available=" + availableQty);
    return;
  }

  if (quantityValue < availableQty) {
    applyMethodRowHighlight(rowElement, METHOD_IN_STOCK_CLASS);
    pushMethodDebug(rowPrefix + " row " + rowIndex, "IN STOCK quantity=" + quantityValue + " available=" + availableQty);
    return;
  }

  pushMethodDebug(rowPrefix + " row " + rowIndex, "EVEN quantity=" + quantityValue + " available=" + availableQty);
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
    methodScanInProgress = false;
    return;
  }

  ensureMethodHighlightStyles();
  ensureMethodDebugWindow();
  pushMethodDebug("Scan started", "Checking rows 0-" + METHOD_ROW_LIMIT);

  try {
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
  window.clearTimeout(methodScanTimeoutId);
  pushMethodDebug("Scan scheduled", METHOD_SCAN_DEBOUNCE_MS + "ms debounce");
  methodScanTimeoutId = window.setTimeout(function () {
    scanMethodInvoiceRows().catch(function (error) {
      pushMethodDebug("Scan failed", error.message);
      console.error("Method inventory scan failed.", error);
    });
  }, METHOD_SCAN_DEBOUNCE_MS);
}

function bootstrapMethodMode() {
  if (!isMethodUrl(window.location.href)) {
    return;
  }

  scheduleMethodRowScan();
}

async function bootstrapPanel() {
  if (!isTargetUrl(window.location.href) || panelBootstrapInProgress) {
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

function watchUrlChanges() {
  const observer = new MutationObserver(async function () {
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
      bootstrapMethodMode();
    } else if (elements?.host) {
      elements.host.remove();
      elements = null;
      window.clearTimeout(methodScanTimeoutId);
      window.clearTimeout(panelBootstrapRetryTimeoutId);
      window.clearTimeout(panelPresenceCheckTimeoutId);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

bootstrapPanel();
bootstrapMethodMode();
watchUrlChanges();

const methodDomObserver = new MutationObserver(function (mutations) {
  if (!isMethodUrl(window.location.href)) {
    return;
  }

  const shouldScan = mutations.some(function (mutation) {
    if (mutation.type !== "childList") {
      return false;
    }

    if (isMethodInternalNode(mutation.target)) {
      return false;
    }

    const addedNodes = Array.from(mutation.addedNodes ?? []);
    const removedNodes = Array.from(mutation.removedNodes ?? []);
    return addedNodes.concat(removedNodes).some(function (node) {
      return !isMethodInternalNode(node);
    });
  });

  if (!shouldScan) {
    return;
  }

  scheduleMethodRowScan();
});

methodDomObserver.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true
});
