# Chrome Web Store submission notes

Audited September 25, 2026 against `Chrome/manifest.json` and `Chrome/src/`. These answers describe the current source, not a verified copy of the ZIP uploaded to the store. The root README calls Chrome a legacy target; ensure the uploaded package matches this directory. No extension behavior or permissions were changed by this audit.

## Paste-ready privacy fields

### Single purpose description

Connect Singularity sales and customer workflows across supported business websites. The extension displays related customer, order, and inventory information on Katana sales order and Method pages, looks up orders in user-configured WooCommerce stores, and lets authorized users update Katana order items and addresses from Singularity. An optional Google Maps integration finds business contact information and lets users add it to Singularity CRM. A Singularity account and API credentials are required for Singularity data access.

### Storage justification

The extension uses chrome.storage.local to retain encrypted Singularity API credentials, an optional Katana API key, configured WooCommerce store URLs and encrypted API credentials, verification state, and feature preferences between browser sessions. The encryption key is also stored locally. Settings let users replace or clear credentials and remove WooCommerce configurations. This storage supports authentication and the configured sales/CRM integrations; it is not used for advertising or browsing-history tracking.

### Host permission justification — current build

Katana sales order pages, botanaway.method.me/apps pages, and Google Maps pages host the extension's sales/CRM controls. singularitysalesplatform.com is used to verify credentials and retrieve or create customer, order, and inventory records. api.katanamrp.com is used to retrieve orders and update order items and addresses. User-configured WooCommerce domains are accessed for authenticated order lookups. When Google Maps CRM is enabled, the extension also reads a business's website and contact/about pages to find a contact email. The current HTTP/HTTPS wildcard permissions support these variable domains; content scripts run only on the three declared website URL patterns.

This explains existing code, but does not establish that broad required access is the minimum necessary. Prefer the optional per-origin design below before submission; update this text after implementing it.

### Remote code

Select **No, I am not using remote code**.

All executable JavaScript is packaged locally. API responses are JSON data. Business website HTML is fetched as text and searched for contact emails; its scripts are not executed. No remote script imports, eval, new Function, remote WebAssembly, analytics SDK, or external script tags were found in the Chrome source. Calling a remote API is not itself remote code execution.

## Data usage selections

These recommendations cover data handled by the extension, including customer/business records, not just information about the person installing it. Do not claim that the extension collects no data or keeps everything local: it sends credentials and queries to connected services and can create/update records.

| Category | Recommendation | Evidence / qualification |
| --- | --- | --- |
| Personally identifiable information | Check | Customer/contact names, emails, phone numbers, billing and shipping addresses; business contacts sent to Singularity CRM. |
| Financial and payment information | Check | Order totals, payment method, transaction references, and customer/order financial information. This does not imply collection of card numbers. |
| Authentication information | Check | Singularity keys, Katana API key, WooCommerce consumer keys and secrets. |
| Website content | Check | Reads supported pages and business website HTML; extracts order/SKU/contact details. |
| Web history | Check conservatively | The Google Maps page URL is sent to Singularity as source_url when creating a contact. No general browser history API or all-sites visit log was found. |
| Location | Check conservatively | Processes customer/business postal addresses and sends a Maps source URL that may contain geographic context. No device geolocation API was found; do not describe this as GPS tracking. |
| Health information | Leave unchecked on current evidence | No dedicated health-data functionality found. Reassess if connected records actually include health information. |
| Personal communications | Leave unchecked on current evidence | No inbox/chat integration found. Raw API records may contain custom fields or notes; reassess if your real payloads include personal communications. |
| User activity | Leave unchecked on current evidence | UI listeners and DOM observers implement features; no clickstream, keystroke, scroll, or behavioral telemetry collection was found. |

Server logging, retention, downstream sharing, and actual production payloads cannot be established from this repository. Confirm these before making final disclosures, particularly if server-side IP logging or additional data use changes the categories.

The three certification checkboxes should all be checked only if the publisher and connected backend practices actually comply: no sale/unapproved transfers, no use outside the stated purpose, and no creditworthiness/lending use. Transfers to the configured services for the requested functionality should be described in the privacy policy. The source contains no advertising or lending integration, but cannot certify company-wide practices.

## Permission audit

| Declaration | Finding | Recommendation |
| --- | --- | --- |
| storage | Used throughout background.js for local settings and encrypted credentials. | Keep. |
| singularitysalesplatform.com | Actual authenticated API calls. | Keep required for core functionality. |
| api.katanamrp.com | Actual order reads and writes. | Keep functionality; preferably request this origin when the optional Katana API integration is configured. |
| factory.katanamrp.com/salesorder/* | Static content script needs the page match. No background fetch to the factory host found. | Keep content_scripts.matches; separate host_permissions entry is unnecessary for current static injection alone. |
| botanaway.method.me/apps/* | Static content script reads page order references/SKUs. No background fetch to Method found. | Keep content_scripts.matches; separate host_permissions entry is unnecessary for current static injection alone. |
| www.google.com/maps/* | Static Maps CRM content script. | Keep page match if shipping Maps functionality; separate host_permissions entry is unnecessary for static injection alone. Making all Maps access optional requires an injection redesign, not just a feature toggle. |
| https://*/* | Used for arbitrary WooCommerce and business-site fetches. Covers every HTTPS host. | Replace required wildcard with optional origins, granted individually when needed. |
| http://*/* | Current normalizers permit HTTP WooCommerce sites and business sites. | Require HTTPS for authenticated WooCommerce access; decide whether HTTP-only public business scans are needed, and if so request only the specific optional HTTP origin. |
| https://*/wp-json/* | Redundant with HTTPS wildcard; does not restrict host access to WordPress APIs. | Remove. Chrome ignores the path in host_permissions, so this pattern itself grants access across HTTPS hosts. |

There are no tabs, history, cookies, scripting, webRequest, or activeTab API permissions to remove. Content-script page matches still constitute website access even if redundant host_permissions entries are removed. A feature toggle does not revoke browser-granted access.

### Recommended implementation before uploading a replacement package

1. Preserve narrowly scoped static page matches for the core Katana/Method panels.
2. Keep Singularity's API origin required. Request the optional Katana API origin on setup if making that integration optional.
3. Declare optional HTTPS hosts to support domains discovered at runtime, but call chrome.permissions.request with the specific store or business origin only, directly from a user action.
4. Request WooCommerce origin access from the settings save/verify action before calling its API. Handle denied/revoked access and permit other integrations to keep working.
5. Replace automatic first-time website scanning with a user action such as “Find contact email,” which can request that business origin. Once granted, scanning can proceed. Handle redirects to a different origin explicitly rather than requesting all hosts.
6. Reject non-HTTPS WooCommerce URLs before sending credentials. Currently credentials are appended to API URLs and HTTP is accepted, allowing secrets and order data to travel unencrypted. Prefer HTTPS Authorization headers instead of query-string credentials where supported by the configured stores.
7. Remove redundant page-host entries and the misleading wp-json wildcard. Do not simply delete broad access before implementing grants: existing cross-origin features would break.
8. Test new installation, grant/deny/revoke flows, reload persistence, store verification and lookup, website redirects, Katana/Method panels, and the optional Maps workflow. Upload the resulting ZIP, then update host justification to match its actual behavior.

`activeTab` is not a drop-in replacement: background requests target API/store/business origins that differ from the current tab, and existing page panels appear automatically.

## Privacy policy URL and review preparation

Use a publicly accessible policy URL that explicitly covers **Singularity Katana Panel**. A local Markdown path is not a publishable policy URL. No policy file was found in this repository.

The policy needs to explain:

- The publisher's identity and contact method.
- The data categories above, including credentials, order/customer data, page content, and Maps source URLs.
- The destinations and purposes: Singularity, Katana API, configured WooCommerce stores, and website requests for contact discovery.
- Automatic behavior: supported page data lookups, and business website email scans when Maps CRM is enabled. CRM creation itself requires “Add to CRM.”
- Local credential/configuration storage, including the fact that the encryption key is stored alongside the encrypted values; this is not an OS-backed credential vault.
- Actual backend retention, logs, sharing, and deletion processes. Clearing extension settings does not delete records already created or updated in connected services.
- Actual sale/advertising/other-use practices and an accurate Chrome Web Store Limited Use compliance statement.

Suggested Limited Use statement, if accurate: “Singularity Katana Panel's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.” Also explain that extension data is used only for the disclosed sales/CRM functions and describe permitted service transfers.

Review access: provide a dedicated test account/key set and sample supported pages/orders through the dashboard's private test instructions. The Method integration is restricted to botanaway.method.me, so reviewers need access to that tenant to exercise it. Do not put live secrets in this document or the public listing. Clearly state account/API prerequisites in the listing and describe Maps prospect capture if it remains included. Ensure all features fit the stated sales/CRM purpose; approval is not guaranteed by wording alone.

## Sources

- [Chrome privacy field instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Minimum permissions and user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Host match patterns; host permission paths are ignored](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
- [Optional permissions and runtime origin grants](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)
