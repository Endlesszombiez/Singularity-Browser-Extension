# Singularity Katana Browser Extension

Browser extension scaffold for Chrome and Firefox that injects a Singularity panel into Katana sales order pages.

## What it does

- Injects a UI panel only on URLs that start with `https://factory.katanamrp.com/salesorder/`
- Requires a public key and secret key to be verified before loading any customer or sales order data
- Encrypts the stored key pair before saving it in extension storage
- Lets users rotate or clear the stored keys from the extension settings page without revealing the existing values
- Pulls fresh data from the placeholder customer and sales order endpoints every time a matching page is loaded or refreshed

## Quick start

1. Open the repo folder in Chrome as an unpacked extension, or use the Firefox-specific manifest for Firefox.
2. Visit a Katana sales order page that matches the target URL prefix.
3. Enter a public key and secret key in the injected panel.
4. After verification succeeds, the panel will fetch the extra details and KPI cards.
5. Use the panel `Settings` button to rotate credentials later.

## Important files

- [manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/manifest.json)
- [firefox/manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/firefox/manifest.json)
- [src/background.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/background.js)
- [src/content.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/content.js)
- [src/config.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/config.js)
- [src/options.html](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/options.html)
- [docs/USAGE.md](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/docs/USAGE.md)

## Endpoint placeholders

Update the placeholder API URLs in [src/config.js](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/src/config.js):

- `verificationUrl`
- `customersUrl`
- `salesOrdersUrl`

## Security note

The extension encrypts the stored keys before writing them to extension storage, but because this scaffold does not yet use a user passphrase or native OS secret store, this should be treated as a practical placeholder rather than a high-security credential vault.

## Browser note

Chrome uses the root MV3 manifest at [manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/manifest.json). Firefox temporary add-ons should use [firefox/manifest.json](/Users/rpicard/Documents/GitHub/Singularity-Katana-Browser-Extension/firefox/manifest.json), because some Firefox installs still reject MV3 background service workers.
