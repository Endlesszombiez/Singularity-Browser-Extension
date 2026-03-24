# Usage And Build Guide

## Project structure

- [manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/manifest.json): cross-browser extension manifest
- [src/background.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/background.js): credential verification, encrypted storage, and API fetch orchestration
- [src/content.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/content.js): injected Katana panel logic
- [src/panel.css](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/panel.css): injected panel styles
- [src/options.html](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/options.html): settings page for rotating or clearing credentials
- [src/options.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/options.js): settings page behavior
- [src/config.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/config.js): central location for API endpoint updates

## Where to update endpoint URLs

Edit [src/config.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/config.js).

Replace these placeholder values:

- `verificationUrl`
- `customersUrl`
- `salesOrdersUrl`

If your real API uses a different host, also update the allowed hosts in [manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/manifest.json) and [firefox/manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/firefox/manifest.json).

## How the credential flow works

1. The content script injects a panel only when the URL starts with `https://factory.katanamrp.com/salesorder/`.
2. If no verified key pair is stored, the panel shows the verification form.
3. The background worker posts the entered `publicKey` and `secretKey` to the verification endpoint.
4. On success, the keys are encrypted and saved in extension storage.
5. The dashboard view is shown and fresh data is fetched for the current page.

## How page refresh works

- Every matching page load triggers a new pull to the customer and sales order endpoints.
- The panel also includes a manual `Refresh` button.
- If the Katana app changes the URL client-side and it still matches the target prefix, the panel re-initializes.
- If the endpoints are still left as `example.com`, the extension now keeps that state inside the panel instead of trying to use the placeholder host.

## Draggable panel

- Drag the panel by its header area.
- The panel position is saved and restored from extension storage.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension`

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select [firefox/manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/firefox/manifest.json)

Firefox temporary add-ons are removed when the browser closes, so reload it the same way during development.

## How to use the extension

1. Open a Katana sales order URL that starts with `https://factory.katanamrp.com/salesorder/`
2. Enter the public key and secret key in the injected panel
3. Wait for successful verification
4. Review the customer and sales order KPI cards
5. Click `Settings` to rotate or clear stored keys

## Data contract placeholders

The scaffold expects the endpoints to return JSON. The code already tolerates missing fields, but these are the current placeholder mappings:

- Customer: `accountManager`, `lifetimeValue`, `openInvoices`, `shippingRisk`, `tags`
- Sales order: `margin`, `fillRate`, `promisedShipDate`, `fulfillmentStatus`, `lineHealth`

You can adjust the data mapping logic in [src/background.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/background.js) when the real payload shapes are available.

## Security note

This scaffold encrypts credentials before storing them, but it does not yet use a user-provided passphrase, browser identity binding, or OS-backed secret storage. That is acceptable for a prototype, but for stronger protection you should move verification and privileged API access behind a backend service or a native secret storage strategy.
