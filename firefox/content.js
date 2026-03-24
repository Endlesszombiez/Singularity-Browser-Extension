const TARGET_URL_PREFIX = "https://factory.katanamrp.com/salesorder/";
const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const storageApi = globalThis.browser?.storage.local ?? globalThis.chrome.storage.local;
const PANEL_ID = "singularity-katana-panel-root";
const PANEL_HOST_ID = "singularity-katana-panel-host";
const PANEL_POSITION_KEY = "panelPosition";

let currentUrl = window.location.href;
let elements = null;
let dragState = null;

function isTargetUrl(url) {
  return url.startsWith(TARGET_URL_PREFIX);
}

function sendRuntimeMessage(message) {
  return runtimeApi.sendMessage(message);
}

async function getStoredPanelPosition() {
  try {
    const stored = await storageApi.get(PANEL_POSITION_KEY);
    return stored?.[PANEL_POSITION_KEY] ?? null;
  } catch (error) {
    return null;
  }
}

async function savePanelPosition(position) {
  try {
    await storageApi.set({ [PANEL_POSITION_KEY]: position });
  } catch (error) {
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
  host.style.left = safePosition.left + "px";
  host.style.top = safePosition.top + "px";
  host.style.right = "auto";
  host.style.bottom = "auto";
}

function formatTimestamp(value) {
  if (!value) {
    return "Not verified yet";
  }

  try {
    return new Date(value).toLocaleString();
  } catch (error) {
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
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="skp-shell">
      <header class="skp-header">
        <div>
          <p class="skp-eyebrow">Singularity</p>
          <h2>Sales Order Intelligence</h2>
        </div>
        <button type="button" class="skp-ghost" data-action="open-settings">Settings</button>
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
      <section class="skp-view" data-view="dashboard" hidden>
        <div class="skp-status-row">
          <p class="skp-meta" id="skp-refresh-status">Waiting for data refresh.</p>
          <button type="button" class="skp-ghost" data-action="refresh-data">Refresh</button>
        </div>
        <div class="skp-grid">
          <article class="skp-card">
            <p class="skp-card-label">Company</p>
            <strong id="skp-account-manager">-</strong>
          </article>
          <article class="skp-card">
            <p class="skp-card-label">Customer email</p>
            <strong id="skp-lifetime-value">-</strong>
          </article>
          <article class="skp-card">
            <p class="skp-card-label">Order total</p>
            <strong id="skp-order-margin">-</strong>
          </article>
          <article class="skp-card">
            <p class="skp-card-label">Order status</p>
            <strong id="skp-fill-rate">-</strong>
          </article>
        </div>
        <div class="skp-detail-group">
          <section class="skp-detail-card">
            <h3>Customer snapshot</h3>
            <dl>
              <div><dt>Contact</dt><dd id="skp-shipping-risk">-</dd></div>
              <div><dt>Phone</dt><dd id="skp-customer-tags">-</dd></div>
              <div><dt>Email</dt><dd id="skp-open-invoices">-</dd></div>
            </dl>
          </section>
          <section class="skp-detail-card">
            <h3>Sales order snapshot</h3>
            <dl>
              <div><dt>External ID</dt><dd id="skp-promised-date">-</dd></div>
              <div><dt>Updated at</dt><dd id="skp-fulfillment-status">-</dd></div>
              <div><dt>Items</dt><dd id="skp-line-health">-</dd></div>
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
    dashboardView: root.querySelector('[data-view="dashboard"]'),
    authForm: root.querySelector("#skp-auth-form"),
    secretInput: root.querySelector('input[name="secretKey"]'),
    revealSecretButton: root.querySelector('[data-action="hold-reveal-secret"]'),
    authStatus: root.querySelector("#skp-auth-status"),
    refreshStatus: root.querySelector("#skp-refresh-status"),
    accountManager: root.querySelector("#skp-account-manager"),
    lifetimeValue: root.querySelector("#skp-lifetime-value"),
    orderMargin: root.querySelector("#skp-order-margin"),
    fillRate: root.querySelector("#skp-fill-rate"),
    openInvoices: root.querySelector("#skp-open-invoices"),
    shippingRisk: root.querySelector("#skp-shipping-risk"),
    customerTags: root.querySelector("#skp-customer-tags"),
    promisedDate: root.querySelector("#skp-promised-date"),
    fulfillmentStatus: root.querySelector("#skp-fulfillment-status"),
    lineHealth: root.querySelector("#skp-line-health")
  };

  root.addEventListener("click", function (event) {
    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "open-settings") {
      runtimeApi.openOptionsPage();
    }

    if (action === "refresh-data") {
      loadPanelData();
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

      elements.authForm.reset();
      setSecretVisibility(false);
      elements.authStatus.textContent = "Credentials verified on " + formatTimestamp(result.verifiedAt) + ".";
      await loadPanelData();
    } catch (error) {
      elements.authStatus.textContent = error.message;
    }
  });

  return elements;
}

function setView(viewName) {
  elements.authView.hidden = viewName !== "auth";
  elements.dashboardView.hidden = viewName !== "dashboard";
}

function renderPanelData(result) {
  elements.accountManager.textContent = result.customer.companyName;
  const emailValue = String(result.salesOrder.customerEmail);
  elements.lifetimeValue.innerHTML = "";
  if (emailValue && emailValue !== "N/A") {
    const link = document.createElement("a");
    link.href = "mailto:" + emailValue;
    link.textContent = emailValue;
    link.className = "skp-inline-link";
    elements.lifetimeValue.appendChild(link);
  } else {
    elements.lifetimeValue.textContent = emailValue;
  }
  elements.orderMargin.textContent = String(result.salesOrder.totalValue);
  elements.fillRate.textContent = String(result.salesOrder.status);
  elements.openInvoices.innerHTML = "";
  if (emailValue && emailValue !== "N/A") {
    const link = document.createElement("a");
    link.href = "mailto:" + emailValue;
    link.textContent = emailValue;
    link.className = "skp-inline-link";
    elements.openInvoices.appendChild(link);
  } else {
    elements.openInvoices.textContent = emailValue;
  }
  elements.shippingRisk.textContent = String(result.customer.contactName);
  elements.customerTags.textContent = String(result.customer.phone);
  elements.promisedDate.textContent = String(result.salesOrder.externalId);
  elements.fulfillmentStatus.textContent = String(result.salesOrder.updatedAt);
  elements.lineHealth.textContent = result.salesOrder.lineItems.length
    ? result.salesOrder.lineItems.join(", ")
    : "No line items returned";
  elements.refreshStatus.textContent = "Last refreshed " + formatTimestamp(result.meta.refreshedAt) + ". Sales order " + (result.meta.salesOrderId || "unknown") + ".";
}

function getOrderNumberFromPage() {
  return document.querySelector('input[name="orderNo"]')?.value?.trim() ?? "";
}

async function loadPanelData() {
  if (!elements) {
    return;
  }

  elements.refreshStatus.textContent = "Refreshing data from Singularity endpoints...";

  try {
    const result = await sendRuntimeMessage({
      action: "refreshPanelData",
      payload: {
        pageUrl: window.location.href,
        orderNumber: getOrderNumberFromPage()
      }
    });

    if (!result.ok) {
      throw new Error(result.error ?? "Unable to load panel data.");
    }

    setView("dashboard");
    renderPanelData(result);
  } catch (error) {
    setView("auth");
    elements.authStatus.textContent = error.message;
  }
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
  elements.authStatus.textContent = authState.isVerified
    ? "Credentials previously verified on " + formatTimestamp(authState.verifiedAt) + "."
    : "No verified key pair stored.";

  if (authState.isVerified) {
    await loadPanelData();
  } else {
    setView("auth");
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
    } else if (elements?.host) {
      elements.host.remove();
      elements = null;
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

bootstrapPanel();
watchUrlChanges();

window.addEventListener("resize", async function () {
  if (!elements?.host) {
    return;
  }

  const rect = elements.host.getBoundingClientRect();
  const safePosition = clampPanelPosition({ left: rect.left, top: rect.top }, elements.host);
  applyPanelPosition(safePosition, elements.host);
  await savePanelPosition(safePosition);
});
