import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";

const LEGACY_HTML = `<!doctype html>
<html lang="en"><head><title>V1 retained shell</title></head>
<body><main id="legacy-app">V1 retained shell</main></body></html>`;

const LEGACY_SERVICE_WORKER = `
const cacheName = "workbox-precache-v2-" + self.registration.scope;
const legacyHtml = ${JSON.stringify(LEGACY_HTML)};
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.put("/manifest.webmanifest", new Response('{"name":"V1 stale manifest"}', {
      headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
    }));
    await cache.put("/favicon.ico", new Response("<svg><title>V1 stale icon</title></svg>", {
      headers: { "Content-Type": "image/svg+xml" },
    }));
  })());
});
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.put("/", new Response(legacyHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    await caches.open("google-fonts-cache");
    await caches.open("gstatic-fonts-cache");
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const pathname = new URL(event.request.url).pathname;
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match("/")) || fetch(event.request);
    })());
    return;
  }
  if (!["/manifest.webmanifest", "/favicon.ico"].includes(pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(event.request)) || fetch(event.request);
  })());
});
self.addEventListener("message", (event) => {
  if (event.data === "migration-test-worker-id") event.ports[0]?.postMessage("v1");
});
`;

const V2_ASSETS = new Map([
  ["/", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/v2/web/app-shell.html", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/v2/web/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["../web/service-worker.js", "text/javascript; charset=utf-8"]],
  ["/favicon.ico", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/favicon.svg", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/app.js", ["../web/app.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/update-manager.mjs", ["../web/update-manager.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/web/manager-operations.js", ["../web/manager-operations.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/qc.js", ["../web/qc.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/inventory.js", ["../web/inventory.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/inventory-export.mjs", ["../web/inventory-export.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/web/setup-catalog.js", ["../web/setup-catalog.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/schedule.js", ["../web/schedule.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/mix-plan.js", ["../web/mix-plan.js", "text/javascript; charset=utf-8"]],
  ["/v2/core/mix-plan.mjs", ["../core/mix-plan.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/web/styles.css", ["../web/styles.css", "text/css; charset=utf-8"]],
  ["/v2/web/write-gate.mjs", ["../web/write-gate.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/import-csv.mjs", ["../core/import-csv.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/setup-catalog-csv.mjs", ["../core/setup-catalog-csv.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/import-csv-templates.mjs", ["../core/import-csv-templates.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/die-defaults.mjs", ["../core/die-defaults.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/station-workflows.mjs", ["../core/station-workflows.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/schedule-planning.mjs", ["../core/schedule-planning.mjs", "text/javascript; charset=utf-8"]],
]);

test("V2 replaces the cached V1 shell without clearing browser data", { timeout: 60_000 }, async (t) => {
  let servedVersion = "v1";
  const requests = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    requests.push({ pathname, servedVersion });
    if (servedVersion === "v1" && pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : LEGACY_HTML);
      return;
    }
    if (servedVersion === "v1" && pathname === "/service-worker.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : LEGACY_SERVICE_WORKER);
      return;
    }
    if (servedVersion === "v2" && pathname === "/api/v2/auth/session") {
      response.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "NOT_SIGNED_IN" }));
      return;
    }
    const asset = servedVersion === "v2" ? V2_ASSETS.get(pathname) : undefined;
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    try {
      let contents = await readFile(new URL(asset[0], import.meta.url));
      if (pathname === "/service-worker.js") {
        contents = Buffer.concat([
          contents,
          Buffer.from(`
self.addEventListener("message", (event) => {
  if (event.data === "migration-test-worker-id") event.ports[0]?.postMessage("v2");
});
`),
        ]);
      }
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": contents.byteLength,
        "Content-Type": asset[1],
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  t.after(() => browser.close());

  const context = await browser.newContext();
  const page = await context.newPage();
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  await context.addCookies([{ name: "preserve-session", value: "yes", url: baseUrl }]);
  await page.goto(baseUrl);
  await page.evaluate(async (legacyHtml) => {
    localStorage.setItem("v1-cache-migration", "preserve");
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("v1-cache-migration", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("state", "readwrite");
        transaction.objectStore("state").put("preserve", "sentinel");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const unrelatedCache = await caches.open("unrelated-app-shell");
    await unrelatedCache.put("/", new Response(legacyHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  }, LEGACY_HTML);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload({ waitUntil: "commit" });
  await page.locator("#legacy-app").waitFor();

  const oldCacheState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return {
      names: await caches.keys(),
      v1Cache: `workbox-precache-v2-${registration.scope}`,
    };
  });
  assert.ok(oldCacheState.names.includes(oldCacheState.v1Cache));
  assert.ok(oldCacheState.names.includes("google-fonts-cache"));
  assert.ok(oldCacheState.names.includes("gstatic-fonts-cache"));
  assert.ok(oldCacheState.names.includes("unrelated-app-shell"));

  servedVersion = "v2";
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await registration.update();
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const names = await caches.keys();
    return names.includes("fieldline-v2-shell-12")
      && !names.includes(`workbox-precache-v2-${registration.scope}`)
      && !names.includes("google-fonts-cache")
      && !names.includes("gstatic-fonts-cache");
  });
  assert.ok((await page.evaluate(() => caches.keys())).includes("unrelated-app-shell"));
  try {
    await page.waitForFunction(async () => {
      const response = await (await caches.open("fieldline-v2-shell-12")).match("/");
      return Boolean(response && (await response.text()).includes("Sign in to the floor"));
    }, undefined, { timeout: 5000 });
  } catch (error) {
    const cachedShellState = await page.evaluate(async () => {
      const response = await (await caches.open("fieldline-v2-shell-12")).match("/");
      const text = await response?.text();
      return {
        found: Boolean(response),
        status: response?.status ?? null,
        length: text?.length ?? 0,
        hasV2Title: text?.includes("<title>Run control — Fieldline</title>") ?? false,
      };
    });
    console.log(JSON.stringify({
      event: "v2.migration_cached_shell_incomplete",
      cachedShellState,
      shellAssetRequests: requests.filter((request) => request.pathname === "/v2/web/app-shell.html"),
    }));
    throw error;
  }
  const cachedShell = await page.evaluate(async () => (
    await (await caches.open("fieldline-v2-shell-12")).match("/")
  )?.text());
  assert.match(cachedShell ?? "", /Sign in to the floor/);
  const cachedRootAssets = await page.evaluate(async () => {
    const cache = await caches.open("fieldline-v2-shell-12");
    const manifest = await cache.match("/manifest.webmanifest");
    const icon = await cache.match("/favicon.ico");
    return {
      icon: await icon?.text(),
      manifest: await manifest?.text(),
    };
  });
  assert.match(cachedRootAssets.manifest ?? "", /Fieldline Production Floor/);
  assert.match(cachedRootAssets.icon ?? "", /FF9500/i);

  // Cache deletion happens during activation, before clients.claim() resolves.
  // A reload during that interval can still be intercepted by the old worker.
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.active?.state === "activated"
      && navigator.serviceWorker.controller === registration.active;
  });
  await page.waitForFunction(async () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return false;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(false), 500);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data === "v2");
      };
      controller.postMessage("migration-test-worker-id", [channel.port2]);
    });
  }, undefined, { timeout: 5000 });
  assert.equal(await page.locator("#legacy-app").textContent(), "V1 retained shell",
    "installing the non-critical V2 worker must not force the existing page to reload");
  try {
    await page.reload({ waitUntil: "commit" });
  } catch (error) {
    console.log(JSON.stringify({
      event: "v2.migration_reload_failed",
      url: page.url(),
      requests: requests.slice(-20),
      rootRequests: requests.filter(({ pathname }) => pathname === "/"),
      worker: await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return {
          title: document.title,
          controllerScript: registration?.active?.scriptURL ?? null,
          controllerState: registration?.active?.state ?? null,
          controlledByActive: navigator.serviceWorker.controller === registration?.active,
        };
      }).catch(() => null),
    }));
    throw error;
  }
  await page.waitForFunction(
    () => document.title === "Run control — Fieldline" && Boolean(document.getElementById("auth-panel")),
    undefined,
    { timeout: 5000 },
  ).catch(async (error) => {
    console.log(JSON.stringify({
      event: "v2.migration_shell_reload_incomplete",
      url: page.url(),
      requests: requests.slice(-20),
      rootRequests: requests.filter(({ pathname }) => pathname === "/"),
      page: await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return {
          title: document.title,
          legacyShell: document.getElementById("legacy-app")?.textContent ?? null,
          authPanel: Boolean(document.getElementById("auth-panel")),
          controllerScript: registration?.active?.scriptURL ?? null,
          controllerState: registration?.active?.state ?? null,
          controlledByActive: navigator.serviceWorker.controller === registration?.active,
        };
      }).catch(() => null),
    }));
    throw error;
  });
  const preservedData = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("v1-cache-migration", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const stored = await new Promise((resolve, reject) => {
      const request = database.transaction("state").objectStore("state").get("sentinel");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return {
      cookie: document.cookie,
      indexedDb: stored,
      localStorage: localStorage.getItem("v1-cache-migration"),
    };
  });
  assert.deepEqual(preservedData, {
    cookie: "preserve-session=yes",
    indexedDb: "preserve",
    localStorage: "preserve",
  });

  await context.close();
});

test("a newer V2 worker replaces an older shell cache and restores the current shell offline", {
  timeout: 60_000,
}, async (t) => {
  const OLD_V2_HTML = `<!doctype html>
<html lang="en"><head><title>Fieldline V2 old shell</title></head>
<body><main id="old-v2-shell">Old V2 production shell</main></body></html>`;
  let servedVersion = "old";
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    if (pathname === "/" || pathname === "/v2/web/app-shell.html") {
      const contents = servedVersion === "old"
        ? Buffer.from(OLD_V2_HTML)
        : await readFile(new URL("../web/index.html", import.meta.url));
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": contents.byteLength,
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : contents);
      return;
    }
    if (pathname === "/service-worker.js") {
      let contents = await readFile(new URL("../web/service-worker.js", import.meta.url), "utf8");
      contents += `
self.addEventListener("message", (event) => {
  if (event.data === "migration-test-cache-name") event.ports[0]?.postMessage(CACHE_NAME);
});
`;
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": Buffer.byteLength(contents),
        "Content-Type": "text/javascript; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : contents);
      return;
    }
    const asset = V2_ASSETS.get(pathname);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": contents.byteLength,
        "Content-Type": asset[1],
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await page.title(), "Fieldline V2 old shell");

  servedVersion = "new";
  await page.evaluate(async () => {
    const oldShell = await caches.open("fieldline-v2-shell-11");
    await oldShell.put("/", new Response(
      '<!doctype html><title>Fieldline V2 old shell</title><main>Old V2 production shell</main>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    ));
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const cacheNames = await caches.keys();
    const workerCache = await new Promise((resolve) => {
      if (!registration?.active) return resolve(null);
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        resolve(null);
      }, 500);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data);
      };
      registration.active.postMessage("migration-test-cache-name", [channel.port2]);
    });
    return Boolean(navigator.serviceWorker.controller)
      && cacheNames.includes("fieldline-v2-shell-12")
      && !cacheNames.includes("fieldline-v2-shell-11")
      && workerCache === "fieldline-v2-shell-12";
  }, null, { timeout: 10_000 });

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#auth-panel").waitFor({ timeout: 7000 });
  assert.equal(await page.title(), "Run control — Fieldline");
  assert.match(await page.locator("#auth-heading").textContent(), /Sign in to the floor/u);
  assert.equal(await page.locator("#old-v2-shell").count(), 0);
  const cachedCurrentShell = await page.evaluate(async () => (
    await (await caches.open("fieldline-v2-shell-12")).match("/")
  )?.text());
  assert.match(cachedCurrentShell ?? "", /Sign in to the floor/u);
});
