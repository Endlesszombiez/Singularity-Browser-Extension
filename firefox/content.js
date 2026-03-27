const TARGET_URL_PREFIX = "https://factory.katanamrp.com/salesorder/";
const METHOD_URL_PREFIX = "https://botanaway.method.me/apps/";
const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;
const PANEL_ID = "singularity-katana-panel-root";
const PANEL_HOST_ID = "singularity-katana-panel-host";
const PANEL_POSITION_KEY = "panelPosition";
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

let currentUrl = window.location.href;
let elements = null;
let dragState = null;
let lastVerifiedAt = null;
let methodScanTimeoutId = null;
let methodDebugEntries = [];
let methodScanInProgress = false;
let methodScanQueued = false;
let methodDebugMinimized = false;

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
  host.style.right = "12px";
  host.style.bottom = "12px";
  host.style.width = "360px";
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

function isMethodInternalNode(node) {
  if (!(node instanceof Element)) {
    return false;
  }

  return Boolean(
    node.closest("#" + METHOD_DEBUG_HOST_ID) ||
    node.closest("#skp-method-highlight-styles")
  );
}

async function getStoredPanelPosition() {
  try {
    const stored = await storageApi.get(PANEL_POSITION_KEY);
    return stored?.[PANEL_POSITION_KEY] ?? null;
  } catch {
    return null;
  }
}

async function savePanelPosition(position) {
  try {
    await storageApi.set({ [PANEL_POSITION_KEY]: position });
  } catch {
    // Ignore storage failures and keep the panel usable.
  }
}

function clampPanelPosition(position, host) {
  const maxLeft = Math.max(8, window.innerWidth - host.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - host.offsetHeight - 8);

  return {
    left: Math.min(Math.max(8, position.left), maxLeft),
    top: Math.min(Math.max(8, position.top), maxTop)
  };
}

function applyPanelPosition(position, host) {
  const safePosition = clampPanelPosition(position, host);
  host.style.left = `${safePosition.left}px`;
  host.style.top = `${safePosition.top}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
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

function createPanel() {
  if (document.getElementById(PANEL_HOST_ID)) {
    return elements;
  }

  const host = document.createElement("div");
  host.id = PANEL_HOST_ID;
  const root = document.createElement("aside");
  const logoUrl = runtimeApi.getURL("images/CompanyLogo.png");
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="skp-shell">
      <header class="skp-header">
        <div>
          <h2>Sales Order Intelligence</h2>
          <p class="skp-header-copy">Singularity customer and sales order details for the current Katana order.</p>
        </div>
      </header>
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
              <button type="button" class="skp-reveal" data-action="hold-reveal-secret">Hold to reveal</button>
            </div>
          </label>
          <button type="submit" class="skp-primary">Verify & Save</button>
        </form>
        <p class="skp-meta" id="skp-auth-status">No verified key pair stored.</p>
      </section>
      <section class="skp-view skp-verified-view" data-view="verified" hidden>
        <img class="skp-logo" src="${logoUrl}" alt="Company logo" />
        <p class="skp-verified-title">Key Verified</p>
        <p class="skp-meta" id="skp-verified-meta">Stored credentials are ready to use.</p>
        <p class="skp-meta" id="skp-verified-status">Loading customer and sales order data...</p>
        <button type="button" class="skp-danger" data-action="remove-api-key">Remove Api Key</button>
      </section>
      <section class="skp-view" data-view="dashboard" hidden>
        <div class="skp-status-row">
          <p class="skp-meta" id="skp-refresh-status">Waiting for data refresh.</p>
          <button type="button" class="skp-ghost" data-action="refresh-data">Refresh</button>
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
            <h3>Customer snapshot</h3>
            <dl>
              <div><dt>Assigned to</dt><dd id="skp-customer-assigned-to">-</dd></div>
              <div><dt>Phone</dt><dd id="skp-customer-phone">-</dd></div>
              <div><dt>Email</dt><dd id="skp-customer-email">-</dd></div>
            </dl>
          </section>
          <section class="skp-detail-card">
            <h3>Sales order snapshot</h3>
            <dl>
              <div><dt>External ID</dt><dd id="skp-order-external-id">-</dd></div>
              <div><dt>Tracking number</dt><dd id="skp-order-tracking-number">-</dd></div>
              <div><dt>Ship method</dt><dd id="skp-order-ship-method">-</dd></div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  `;

  host.appendChild(root);
  document.body.appendChild(host);

  elements = {
    host,
    shell: root.querySelector(".skp-shell"),
    header: root.querySelector(".skp-header"),
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
    companyName: root.querySelector("#skp-company-name"),
    contactName: root.querySelector("#skp-contact-name"),
    orderTotal: root.querySelector("#skp-order-total"),
    orderStatus: root.querySelector("#skp-order-status"),
    customerAssignedTo: root.querySelector("#skp-customer-assigned-to"),
    customerPhone: root.querySelector("#skp-customer-phone"),
    customerEmail: root.querySelector("#skp-customer-email"),
    orderExternalId: root.querySelector("#skp-order-external-id"),
    orderTrackingNumber: root.querySelector("#skp-order-tracking-number"),
    orderShipMethod: root.querySelector("#skp-order-ship-method")
  };

  root.addEventListener("click", async function (event) {
    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "refresh-data") {
      await loadPanelData({ preserveView: true });
    }

    if (action === "remove-api-key") {
      elements.verifiedStatus.textContent = "Removing stored API key...";
      const result = await sendRuntimeMessage({ action: "clearCredentials" });

      if (!result?.ok) {
        elements.verifiedStatus.textContent = result?.error ?? "Unable to remove the stored API key.";
        return;
      }

      window.location.reload();
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

  elements.header.addEventListener("pointerdown", function (event) {
    if (event.target.closest("button, input, textarea, select, a")) {
      return;
    }

    const rect = elements.host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };

    if (elements.host.setPointerCapture) {
      elements.host.setPointerCapture(event.pointerId);
    }
    elements.shell.classList.add("skp-dragging");
    event.preventDefault();
  });

  elements.host.addEventListener("pointermove", function (event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    applyPanelPosition(
      {
        left: event.clientX - dragState.offsetX,
        top: event.clientY - dragState.offsetY
      },
      elements.host
    );
  });

  elements.host.addEventListener("pointerup", async function (event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    if (elements.host.releasePointerCapture) {
      elements.host.releasePointerCapture(event.pointerId);
    }
    elements.shell.classList.remove("skp-dragging");

    const rect = elements.host.getBoundingClientRect();
    await savePanelPosition({ left: rect.left, top: rect.top });
    dragState = null;
  });

  elements.host.addEventListener("pointercancel", function (event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    elements.shell.classList.remove("skp-dragging");
    dragState = null;
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
      showVerifiedSplash(result.verifiedAt, "Loading customer and sales order data...");
      await loadPanelData({ preserveView: false });
    } catch (error) {
      elements.authStatus.textContent = error.message;
    }
  });

  return elements;
}

function setView(viewName) {
  elements.authView.hidden = viewName !== "auth";
  elements.verifiedView.hidden = viewName !== "verified";
  elements.dashboardView.hidden = viewName !== "dashboard";
}

function showAuthView(message) {
  elements.authStatus.textContent = message ?? "No verified key pair stored.";
  setView("auth");
}

function showVerifiedSplash(verifiedAt, message) {
  lastVerifiedAt = verifiedAt ?? lastVerifiedAt;
  elements.verifiedMeta.textContent = lastVerifiedAt
    ? `Verified on ${formatTimestamp(lastVerifiedAt)}.`
    : "Stored credentials are ready to use.";
  elements.verifiedStatus.textContent = message ?? "Loading customer and sales order data...";
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
  elements.customerAssignedTo.textContent = String(result.customer.assignedTo);
  elements.customerPhone.textContent = String(result.customer.phone);
  setLinkedValue(elements.customerEmail, result.customer.email || result.salesOrder.customerEmail);
  elements.orderExternalId.textContent = String(result.salesOrder.externalId);
  elements.orderTrackingNumber.textContent = String(result.salesOrder.trackingNumber);
  elements.orderShipMethod.textContent = String(result.salesOrder.shipMethod);
  elements.refreshStatus.textContent = `Last refreshed ${formatTimestamp(result.meta.refreshedAt)}. Sales order ${result.meta.salesOrderId || "unknown"}.`;
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

  if (!preserveView && lastVerifiedAt) {
    showVerifiedSplash(lastVerifiedAt, "Loading customer and sales order data...");
  }

  try {
    const orderNumber = await getOrderNumberWithDelay();
    elements.refreshStatus.textContent = "Refreshing data from Singularity endpoints...";
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

    setView("dashboard");
    renderPanelData(result);
  } catch (error) {
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
  if (!isTargetUrl(window.location.href)) {
    return;
  }

  createPanel();
  const storedPosition = await getStoredPanelPosition();

  if (storedPosition) {
    applyPanelPosition(storedPosition, elements.host);
  }

  const authState = await sendRuntimeMessage({ action: "getAuthState" });
  lastVerifiedAt = authState.verifiedAt ?? null;

  if (authState.isVerified) {
    showVerifiedSplash(authState.verifiedAt, "Loading customer and sales order data...");
    await loadPanelData({ preserveView: false });
  } else {
    showAuthView("No verified key pair stored.");
  }
}

function watchUrlChanges() {
  const observer = new MutationObserver(async function () {
    if (window.location.href === currentUrl) {
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

window.addEventListener("resize", async function () {
  if (!elements?.host) {
    return;
  }

  const rect = elements.host.getBoundingClientRect();
  const safePosition = clampPanelPosition({ left: rect.left, top: rect.top }, elements.host);
  applyPanelPosition(safePosition, elements.host);
  await savePanelPosition(safePosition);
});
