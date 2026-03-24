const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome.runtime;

function sendRuntimeMessage(message) {
  return runtimeApi.sendMessage(message);
}

function setStatus(message) {
  const element = document.getElementById("settings-status");
  element.textContent = message;
}

async function initializeStatus() {
  const authState = await sendRuntimeMessage({ action: "getAuthState" });
  setStatus(
    authState.isVerified
      ? "Credentials are stored and were last verified on " + new Date(authState.verifiedAt).toLocaleString() + "."
      : "No verified credentials are currently stored."
  );
}

document.getElementById("settings-form").addEventListener("submit", async function (event) {
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
    setStatus("Credentials replaced successfully on " + new Date(result.verifiedAt).toLocaleString() + ".");
  } catch (error) {
    setStatus(error.message);
  }
});

document.getElementById("clear-credentials").addEventListener("click", async function () {
  await sendRuntimeMessage({ action: "clearCredentials" });
  setStatus("Stored credentials cleared. The panel will require verification again.");
});

initializeStatus().catch(function (error) {
  setStatus(error.message);
});
