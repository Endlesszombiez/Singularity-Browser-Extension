import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const origin = "https://factory.katanamrp.com";

function matches(pattern, url) {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`).test(url);
}

// Run the actual startup and navigation code; stub the panel's UI and API data.
async function loadExtension(version, path, enabled = true) {
  const manifest = JSON.parse(readFileSync(new URL(`../${version}/manifest.json`, import.meta.url)));
  const url = `${origin}${path}`;
  const script = manifest.content_scripts.find((entry) => entry.matches.some((pattern) => matches(pattern, url)));
  assert.ok(script, `${version} must inject on ${path} before in-app navigation`);
  assert.ok((manifest.host_permissions ?? manifest.permissions).some((pattern) => matches(pattern, url)));

  const observers = [];
  const timers = new Map();
  let nextTimer = 0;
  const state = { host: null, panelsCreated: 0, authViews: 0 };
  const window = {
    location: { href: url },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = vm.createContext({
    window,
    document: { body: {}, documentElement: {}, getElementById: () => state.host },
    MutationObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    },
    chrome: { runtime: {} },
    console,
    state,
    enabled
  });
  const source = readFileSync(new URL(`../${version}/${script.js[0]}`, import.meta.url), "utf8");
  // Function declarations are replaced before startup runs, leaving routing,
  // feature checks, bootstrapping, and presence recovery intact.
  vm.runInContext(`${source}
    async function sendRuntimeMessage(message) {
      return message.action === "getFeatureSettings"
        ? { ok: true, featureSettings: { katanaEnabled: enabled } }
        : { isVerified: false };
    }
    function createPanel() {
      if (!state.host) {
        state.panelsCreated++;
        state.host = { remove() { state.host = null; } };
      }
      elements = { host: state.host };
      return elements;
    }
    function showAuthView() { state.authViews++; }
  `, context);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  return {
    state,
    async navigate(path) {
      window.location.href = `${origin}${path}`;
      await observers[0]();
      await settle();
    },
    async removePanel() {
      state.host = null;
      await observers[0]();
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
      await settle();
    }
  };
}

for (const version of ["Chrome", "Firefox"]) {
  test(`${version}: initial app load followed by sales order navigation`, async () => {
    for (const entry of ["/", "/sales", "/salesorder"]) {
      const app = await loadExtension(version, entry);
      assert.equal(app.state.panelsCreated, 0, "panel stays off non-order pages");
      await app.navigate("/salesorder/123");
      assert.equal(app.state.panelsCreated, 1);
      assert.equal(app.state.authViews, 1);
      await app.navigate("/sales");
      assert.equal(app.state.host, null, "leaving the order removes the panel");
      await app.navigate("/salesorder/456");
      assert.equal(app.state.panelsCreated, 2);
    }
  });

  test(`${version}: direct order load and panel recovery`, async () => {
    const app = await loadExtension(version, "/salesorder/123");
    assert.equal(app.state.panelsCreated, 1);
    await app.removePanel();
    assert.equal(app.state.panelsCreated, 2, "recover if Katana replaces the panel's DOM");
  });

  test(`${version}: disabled Katana feature stays disabled on navigation`, async () => {
    const app = await loadExtension(version, "/", false);
    await app.navigate("/salesorder/123");
    assert.equal(app.state.panelsCreated, 0);
  });
}
