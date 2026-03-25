# Singularity Katana Browser Extension

Browser extension scaffold for Chrome and Firefox that injects a Singularity panel into Katana sales order pages.

## What it does

- Injects a UI panel only on URLs that start with `https://factory.katanamrp.com/salesorder/`
- Requires a public key and secret key to be verified before loading any customer or sales order data
- Encrypts the stored key pair before saving it in extension storage
- Lets users rotate or clear the stored keys from the extension settings page without revealing the existing values
- Pulls fresh data from the placeholder customer and sales order endpoints every time a matching page is loaded or refreshed

## Quick start

1. Load `Chrome/` in Chrome as an unpacked extension, or use `Firefox/manifest.json` for Firefox.
2. Visit a Katana sales order page that matches the target URL prefix.
3. Enter a public key and secret key in the injected panel.
4. After verification succeeds, the panel will fetch the extra details and KPI cards.
5. Use the panel `Settings` button to rotate credentials later.

## Important files

- [Chrome/manifest.json](./Chrome/manifest.json)
- [Firefox/manifest.json](./Firefox/manifest.json)
- [Chrome/src/background.js](./Chrome/src/background.js)
- [Chrome/src/content.js](./Chrome/src/content.js)
- [Chrome/src/config.js](./Chrome/src/config.js)
- [Chrome/src/options.html](./Chrome/src/options.html)
- [Chrome/docs/USAGE.md](./Chrome/docs/USAGE.md)

## Endpoint placeholders

Update the placeholder API URLs in [Chrome/src/config.js](./Chrome/src/config.js):

- `verificationUrl`
- `customersUrl`
- `salesOrdersUrl`

## Security note

The extension encrypts the stored keys before writing them to extension storage, but because this scaffold does not yet use a user passphrase or native OS secret store, this should be treated as a practical placeholder rather than a high-security credential vault.

## Browser note

Chrome uses [Chrome/manifest.json](./Chrome/manifest.json). Firefox temporary add-ons should use [Firefox/manifest.json](./Firefox/manifest.json), because some Firefox installs still reject MV3 background service workers.
