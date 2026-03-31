const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;

function sendRuntimeMessage(message) {
  return runtimeApi.sendMessage(message);
}

function setStatus(message) {
  document.getElementById("settings-status").textContent = message;
}

function setWooCommerceStatus(message) {
  document.getElementById("woocommerce-status").textContent = message;
}

function createSiteRow(site) {
  const row = document.createElement("article");
  row.className = "site-row";

  const meta = document.createElement("div");
  meta.className = "site-meta";

  const title = document.createElement("strong");
  title.textContent = site.label;
  meta.appendChild(title);

  const details = document.createElement("p");
  details.textContent = `${site.baseUrl}  |  ${site.consumerKeyHint} / ${site.consumerSecretHint}`;
  meta.appendChild(details);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "secondary compact-button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", async () => {
    setWooCommerceStatus(`Removing ${site.label}...`);
    const result = await sendRuntimeMessage({
      action: "removeWooCommerceSite",
      payload: {
        siteId: site.id
      }
    });

    if (!result?.ok) {
      setWooCommerceStatus(result?.error ?? `Unable to remove ${site.label}.`);
      return;
    }

    await refreshWooCommerceSites();
    setWooCommerceStatus(`${site.label} removed.`);
  });

  row.append(meta, removeButton);
  return row;
}

async function refreshWooCommerceSites() {
  const siteContainer = document.getElementById("woocommerce-sites");
  const result = await sendRuntimeMessage({ action: "getWooCommerceSites" });

  if (!result?.ok) {
    setWooCommerceStatus(result?.error ?? "Unable to load WooCommerce sites.");
    return;
  }

  siteContainer.innerHTML = "";

  if (!result.sites.length) {
    siteContainer.innerHTML = '<p class="empty-state">No WooCommerce sites configured yet.</p>';
    return;
  }

  result.sites.forEach((site) => {
    siteContainer.appendChild(createSiteRow(site));
  });
}

async function initializeStatus() {
  const authState = await sendRuntimeMessage({ action: "getAuthState" });
  setStatus(
    authState.isVerified
      ? `Credentials are stored and were last verified on ${new Date(authState.verifiedAt).toLocaleString()}.`
      : "No verified credentials are currently stored."
  );
  setWooCommerceStatus(
    authState.wooCommerceSiteCount
      ? `${authState.wooCommerceSiteCount} WooCommerce site(s) ready for manual lookup.`
      : "No WooCommerce sites saved yet."
  );
  await refreshWooCommerceSites();
}

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const publicKey = String(formData.get("publicKey") ?? "").trim();
  const secretKey = String(formData.get("secretKey") ?? "").trim();

  setStatus("Verifying replacement key pair...");

  try {
    const result = await sendRuntimeMessage({
      action: "verifyAndStoreCredentials",
      payload: {
        publicKey,
        secretKey
      }
    });

    if (!result.ok) {
      throw new Error(result.error ?? "Unable to verify keys.");
    }

    form.reset();
    setStatus(`Credentials replaced successfully on ${new Date(result.verifiedAt).toLocaleString()}.`);
  } catch (error) {
    setStatus(error.message);
  }
});

document.getElementById("clear-credentials").addEventListener("click", async () => {
  await sendRuntimeMessage({ action: "clearCredentials" });
  setStatus("Stored credentials cleared. The panel will require verification again.");
});

document.getElementById("woocommerce-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  setWooCommerceStatus("Verifying WooCommerce site...");

  try {
    const result = await sendRuntimeMessage({
      action: "saveWooCommerceSite",
      payload: {
        label: String(formData.get("label") ?? "").trim(),
        baseUrl: String(formData.get("baseUrl") ?? "").trim(),
        consumerKey: String(formData.get("consumerKey") ?? "").trim(),
        consumerSecret: String(formData.get("consumerSecret") ?? "").trim()
      }
    });

    if (!result.ok) {
      throw new Error(result.error ?? "Unable to save WooCommerce site.");
    }

    form.reset();
    await refreshWooCommerceSites();
    setWooCommerceStatus(`${result.site.label} verified and saved.`);
  } catch (error) {
    setWooCommerceStatus(error.message);
  }
});

document.getElementById("clear-woocommerce-sites").addEventListener("click", async () => {
  const result = await sendRuntimeMessage({ action: "clearWooCommerceSites" });

  if (!result?.ok) {
    setWooCommerceStatus(result?.error ?? "Unable to clear WooCommerce sites.");
    return;
  }

  await refreshWooCommerceSites();
  setWooCommerceStatus("All WooCommerce sites cleared.");
});

initializeStatus().catch((error) => {
  setStatus(error.message);
});
