# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home-deferred-panels.spec.ts >> Home opens each deferred panel in the selected browser and viewport
- Location: e2e/home-deferred-panels.spec.ts:266:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('menuitem', { name: 'QC workflows & history', exact: true })

```

# Test source

```ts
  65  |       navigationPaths,
  66  |       duringReload: expectedNavigation,
  67  |     });
  68  |     if (cancelledPath) {
  69  |       expectedWebKitNavigationMessages.push(`${source}: ${cancelledPath}`);
  70  |     } else {
  71  |       unexpectedErrors.push(text);
  72  |     }
  73  |   };
  74  | 
  75  |   page.on("request", (request) => {
  76  |     if (!enabled) return;
  77  |     inFlight.add(request);
  78  |     // Unload handlers can start a final write after reload was requested.
  79  |     // Track those requests as well as ones already in flight at that point.
  80  |     if (expectedNavigation) navigationRequests.add(request);
  81  |     const url = apiUrl(request.url());
  82  |     if (!url) return;
  83  |     if (expectedNavigation) navigationPaths.add(url.pathname);
  84  |     if (request.method() === "OPTIONS") {
  85  |       preflightRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  86  |     }
  87  |     const pageOrigin = page.url() === "about:blank" ? null : new URL(page.url()).origin;
  88  |     if (pageOrigin && url.origin !== pageOrigin) {
  89  |       crossOriginRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  90  |     }
  91  |   });
  92  |   page.on("requestfinished", (request) => inFlight.delete(request));
  93  |   page.on("response", (response) => {
  94  |     if (!enabled) return;
  95  |     if (response.ok()) successfulOrigins.add(new URL(response.url()).origin);
  96  |     const url = apiUrl(response.url());
  97  |     if (!url || !isManagerTarget(url)) return;
  98  |     responseStatuses.push({ url: `${url.origin}${url.pathname}`, status: response.status() });
  99  |   });
  100 |   page.on("requestfailed", (request) => {
  101 |     inFlight.delete(request);
  102 |     if (!enabled) return;
  103 |     const url = apiUrl(request.url());
  104 |     if (!url) return;
  105 |     const entry = `${request.method()} ${url.origin}${url.pathname} (${request.failure()?.errorText ?? "unknown"})`;
  106 |     if (
  107 |       navigationRequests.has(request)
  108 |       && (
  109 |         request.failure()?.errorText === "Load request cancelled"
  110 |         || request.failure()?.errorText === "net::ERR_ABORTED"
  111 |       )
  112 |     ) {
  113 |       expectedNavigationCancellations.push(entry);
  114 |     } else {
  115 |       failedApiRequests.push(entry);
  116 |     }
  117 |   });
  118 |   page.on("console", (message) => {
  119 |     if (!enabled) return;
  120 |     if (message.type() !== "error") return;
  121 |     const text = message.text();
  122 |     if (/\/api\/(?:incidents(?:\/actionable-count)?|factory-data|field-checks\/observations)(?:\?| |$)/.test(text)) {
  123 |       classifyBrowserMessage(text, "console", apiConsoleErrors);
  124 |     }
  125 |   });
  126 |   page.on("pageerror", (error) => {
  127 |     if (enabled) classifyBrowserMessage(error.message, "page", pageErrors);
  128 |   });
  129 | 
  130 |   return {
  131 |     pageErrors,
  132 |     responseStatuses,
  133 |     crossOriginRequests,
  134 |     preflightRequests,
  135 |     failedApiRequests,
  136 |     apiConsoleErrors,
  137 |     expectedNavigationCancellations,
  138 |     expectedWebKitNavigationMessages,
  139 |     start: () => { enabled = true; },
  140 |     markExpectedNavigation: (expected) => {
  141 |       if (expected) {
  142 |         navigationPaths.clear();
  143 |         for (const request of inFlight) {
  144 |           navigationRequests.add(request);
  145 |           const url = apiUrl(request.url());
  146 |           if (url) navigationPaths.add(url.pathname);
  147 |         }
  148 |       }
  149 |       expectedNavigation = expected;
  150 |     },
  151 |   };
  152 | }
  153 | 
  154 | async function openMore(page: Page): Promise<void> {
  155 |   const menu = page.getByRole("menu");
  156 |   if (await menu.isVisible().catch(() => false)) {
  157 |     await expect(menu).toBeHidden({ timeout: 5_000 });
  158 |   }
  159 |   await page.getByTitle("More").click();
  160 |   await expect(menu).toBeVisible();
  161 | }
  162 | 
  163 | async function openMoreItem(page: Page, label: string): Promise<void> {
  164 |   await openMore(page);
> 165 |   await page.getByRole("menuitem", { name: label, exact: true }).click();
      |                                                                  ^ Error: locator.click: Test timeout of 60000ms exceeded.
  166 | }
  167 | 
  168 | async function expectDeferredPanel(
  169 |   page: Page,
  170 |   label: string,
  171 |   content: Locator,
  172 | ): Promise<void> {
  173 |   await expect(content, `${label} should render on first open`).toBeVisible({
  174 |     timeout: 20_000,
  175 |   });
  176 |   await expect(page.getByText(`Loading ${label}…`, { exact: true })).toHaveCount(0);
  177 |   await expect(
  178 |     page.getByRole("alert").filter({ hasText: `Couldn’t load ${label}.` }),
  179 |   ).toHaveCount(0);
  180 | }
  181 | 
  182 | async function promoteToManager(username: string): Promise<void> {
  183 |   const db = new Client({
  184 |     connectionString: requireIsolatedTestDatabase("promote Home panel fixture"),
  185 |   });
  186 |   try {
  187 |     await db.connect();
  188 |     await db.query(
  189 |       "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
  190 |       [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
  191 |     );
  192 |     const user = await db.query<{ id: string }>(
  193 |       "SELECT id FROM users WHERE username = $1",
  194 |       [username],
  195 |     );
  196 |     expect(user.rows).toHaveLength(1);
  197 |     await db.query(
  198 |       `INSERT INTO user_roles (user_id, role)
  199 |        VALUES ($1, 'manager')
  200 |        ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
  201 |       [user.rows[0].id],
  202 |     );
  203 |   } finally {
  204 |     await db.end().catch(() => {});
  205 |   }
  206 | }
  207 | 
  208 | async function readCanonicalFactoryValues(page: Page): Promise<Record<string, unknown>> {
  209 |   return page.evaluate(async () => {
  210 |     const response = await fetch("/api/factory-data", { cache: "no-store" });
  211 |     if (!response.ok) {
  212 |       throw new Error(`Canonical factory-data read failed (${response.status})`);
  213 |     }
  214 |     const snapshot = await response.json() as {
  215 |       data?: Record<string, { value?: unknown }>;
  216 |     };
  217 |     if (!snapshot.data || typeof snapshot.data !== "object") {
  218 |       throw new Error("Canonical factory-data response has no data map");
  219 |     }
  220 |     return Object.fromEntries(Object.entries(snapshot.data).map(([key, entry]) => {
  221 |       if (!entry || typeof entry !== "object" || !("value" in entry)) {
  222 |         throw new Error(`Canonical factory-data row is malformed (${key})`);
  223 |       }
  224 |       return [key, entry.value];
  225 |     }));
  226 |   });
  227 | }
  228 | 
  229 | test.beforeAll(() => {
  230 |   requireIsolatedTestDatabase("Home deferred panels browser check");
  231 | });
  232 | 
  233 | test.beforeEach(async () => {
  234 |   const db = new Client({
  235 |     connectionString: requireIsolatedTestDatabase(
  236 |       "reset Home deferred panel fixture",
  237 |     ),
  238 |   });
  239 |   try {
  240 |     await db.connect();
  241 |     // Playwright projects share this disposable database. Clear any live run
  242 |     // left by the previous browser/viewport before exercising the idle path.
  243 |     const dates = [
  244 |       ...new Set([
  245 |         new Date().toISOString().slice(0, 10),
  246 |         new Date().toLocaleDateString("en-CA"),
  247 |       ]),
  248 |     ];
  249 |     await cleanupDailySync(db, dates, "live");
  250 |   } finally {
  251 |     await db.end().catch(() => {});
  252 |   }
  253 | });
  254 | 
  255 | test.afterAll(async () => {
  256 |   if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  257 |   const db = new Client({ connectionString: process.env.DATABASE_URL });
  258 |   try {
  259 |     await db.connect();
  260 |     await cleanupTestUsers(db, testUsernames);
  261 |   } finally {
  262 |     await db.end().catch(() => {});
  263 |   }
  264 | });
  265 | 
```