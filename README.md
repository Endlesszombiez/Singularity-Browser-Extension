# Singularity Katana Firefox Extension

Firefox extension that connects Singularity CRM data to Katana, Method, WooCommerce, and Google Maps workflows.

## What it does

- Injects a UI panel on Katana sales order pages when the Katana feature is enabled
- Scans Method pages for inventory and sync status when the Method feature is enabled
- Adds visible Google Maps business emails to Singularity CRM when the Google Maps CRM feature is enabled
- Requires a public key and secret key to be verified before loading any customer or sales order data
- Encrypts the stored key pair before saving it in extension storage
- Lets users rotate or clear the stored keys from the extension settings page without revealing the existing values
- Lets users configure WooCommerce sites for manual order lookups

## Quick start

1. Load `Firefox/manifest.json` as a temporary Firefox add-on.
2. Open the extension settings page.
3. Enter and verify a Singularity public key and secret key.
4. Use the Feature Controls section to enable or disable Method, Katana, and Google Maps CRM tools.
5. Visit a supported Katana, Method, or Google Maps page.

## Build XPI package

Run the packaging script from the repo root:

```bash
./scripts/build-xpi.sh
```

This creates a Firefox `.xpi` archive in `dist/`. You can also package a specific folder:

```bash
./scripts/build-xpi.sh Firefox
```

## Important files

- [Firefox/manifest.json](./Firefox/manifest.json)
- [Firefox/background.js](./Firefox/background.js)
- [Firefox/content.js](./Firefox/content.js)
- [Firefox/options.html](./Firefox/options.html)

## API endpoints

The Firefox background script uses these Singularity API endpoints:

- `verificationUrl`
- `customersUrl`
- `salesOrdersUrl`
- `inventoryUrl`

## Security note

The extension encrypts the stored keys before writing them to extension storage, but because this scaffold does not yet use a user passphrase or native OS secret store, this should be treated as a practical placeholder rather than a high-security credential vault.

## Browser note

Firefox is the only actively supported target right now. The legacy `Chrome/` folder is kept in the repository for reference, but the default build no longer packages it.
