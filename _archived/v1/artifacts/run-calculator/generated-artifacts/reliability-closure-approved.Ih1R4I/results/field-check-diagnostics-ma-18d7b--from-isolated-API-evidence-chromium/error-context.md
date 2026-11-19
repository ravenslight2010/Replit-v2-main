# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: field-check-diagnostics.spec.ts >> manager sees safe sync categories and performance sources from isolated API evidence
- Location: e2e/field-check-diagnostics.spec.ts:20:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByTestId('factory-directory-review')
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByTestId('factory-directory-review') with timeout 5000ms
  - waiting for getByTestId('factory-directory-review')
    13 × locator resolved to 1 element
       - unexpected value "1"

```

# Test source

```ts
  131 |       diagnostics: {
  132 |         action: "call_api",
  133 |         outcome: "error",
  134 |         retryCount: 0,
  135 |         connectivity: "online",
  136 |         syncState: "unknown",
  137 |         signalKind: "api_failure",
  138 |         correlationId: incidentRequestReference,
  139 |         requestOperationCategory: "sync",
  140 |         requestOutcome: "http_server_error",
  141 |         requestElapsedMs: 4_023_360,
  142 |         requestObservedAt: incidentObservedAt,
  143 |         requestBackgroundInvolvement: "not_observed",
  144 |         requestHttpStatus: 500,
  145 |       },
  146 |     },
  147 |   });
  148 |   expect(incidentResponse.status()).toBe(200);
  149 |   const incidentData = await incidentResponse.json();
  150 |   expect(incidentData.correlationId).not.toBe(incidentRequestReference);
  151 |   const guidanceIncidents: Array<{ status: 400 | 403 | 409; correlationId: string }> = [];
  152 |   for (const status of [400, 403, 409] as const) {
  153 |     const response = await request.post(`${API_BASE}/api/incidents`, {
  154 |       headers: { Authorization: `Bearer ${account.token}` },
  155 |       data: {
  156 |         source: "auto_crash",
  157 |         screen: "/",
  158 |         appPlatform: "web",
  159 |         appVersion: "app-build:identified",
  160 |         errorMessage: `API ${status}`,
  161 |         diagnostics: {
  162 |           action: "call_api",
  163 |           outcome: "error",
  164 |           retryCount: 0,
  165 |           connectivity: "online",
  166 |           syncState: "blocked",
  167 |           signalKind: "api_failure",
  168 |           correlationId: randomUUID(),
  169 |           requestOperationCategory: status === 403 ? "other" : "sync",
  170 |           requestRoute: status === 403 ? "other" : "sync_manual_section",
  171 |           requestOutcome: "http_client_error",
  172 |           ...(status === 400 ? { requestReasonCode: "SYNC_VALIDATION_FAILED" } : {}),
  173 |           requestElapsedMs: 150,
  174 |           requestBackgroundInvolvement: "not_observed",
  175 |           requestHttpStatus: status,
  176 |         },
  177 |       },
  178 |     });
  179 |     expect(response.status()).toBe(200);
  180 |     guidanceIncidents.push({ status, correlationId: (await response.json()).correlationId });
  181 |   }
  182 |   const recoveryAttempt = await request.post(`${API_BASE}/api/field-checks/observations`, {
  183 |     headers: { Authorization: `Bearer ${account.token}` },
  184 |     data: { observations: [{
  185 |       observationId: uniqueTestId("stale_recovery_attempt"),
  186 |       checkName: "stale-deployment-recovery",
  187 |       checkVersion: "3",
  188 |       outcome: "incomplete",
  189 |       observedAt: new Date().toISOString(),
  190 |       appBuild: "fixture-old-build",
  191 |       deviceCategory: "mobile-chrome",
  192 |       metrics: {},
  193 |     }] },
  194 |   });
  195 |   expect(recoveryAttempt.status()).toBe(202);
  196 |   // Passive observations from this test browser must not recover the seeded failures.
  197 |   await page.route("**/api/field-checks/observations", (route) => route.fulfill({
  198 |     status: 202, json: { accepted: 0, duplicate: 0 },
  199 |   }));
  200 |   const legacyBrandKey = "run-calc-fkv-legacy-review:unowned:run-calc-brands";
  201 |   const legacyBrandRaw = JSON.stringify(["Fixture Brand"]);
  202 |   const historyKey = "run-calc-history";
  203 |   const historyRows = [
  204 |     { date: "2026-10-20", runs: [{ id: "fixture-local-only-1" }], runValues: {} },
  205 |     { date: "2026-10-21", runs: [{ id: "fixture-local-only-2" }], runValues: {} },
  206 |   ];
  207 |   const historyRaw = JSON.stringify(historyRows);
  208 |   const unrelatedKey = "run-calc-review-fixture-unrelated";
  209 |   const unrelatedRaw = "keep-this-unrelated-value";
  210 |   const seededMarker = "run-calc-review-fixture-seeded";
  211 |   await page.addInitScript(({ legacyBrandKey, legacyBrandRaw, historyKey, historyRaw, unrelatedKey, unrelatedRaw, seededMarker }) => {
  212 |     if (sessionStorage.getItem(seededMarker) === "1") return;
  213 |     localStorage.setItem(legacyBrandKey, legacyBrandRaw);
  214 |     localStorage.setItem(historyKey, historyRaw);
  215 |     localStorage.setItem(unrelatedKey, unrelatedRaw);
  216 |     sessionStorage.setItem(seededMarker, "1");
  217 |   }, { legacyBrandKey, legacyBrandRaw, historyKey, historyRaw, unrelatedKey, unrelatedRaw, seededMarker });
  218 |   await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  219 |   browserPhase = "manager-view";
  220 |   await page.goto("/");
  221 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  222 |   const legacyReview = page.getByTestId("factory-directory-review");
  223 |   await legacyReview.locator("details > summary").click();
  224 |   await expect(legacyReview).toContainText("1 saved facility-list edits need review");
  225 |   await expect(legacyReview).toContainText("Currently in use");
  226 |   await expect(legacyReview).toContainText("Saved copy on this device");
  227 |   await expect(legacyReview).toContainText("Fixture Brand");
  228 |   const legacyRemoval = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  229 |   await legacyReview.getByRole("button", { name: "Remove saved copy from this device" }).click();
  230 |   await legacyRemoval;
> 231 |   await expect(legacyReview).toHaveCount(0);
      |                              ^ Error: expect(locator).toHaveCount(expected) failed
  232 |   expect(await page.evaluate((key) => localStorage.getItem(key), legacyBrandKey)).toBeNull();
  233 | 
  234 |   const retainedReview = page.getByTestId("shared-records-status");
  235 |   await expect(retainedReview).toContainText("Older device history");
  236 |   await retainedReview.locator("details > summary").click();
  237 |   await expect(retainedReview).toContainText("Item 1 of 2 on this device. Date: 2026-10-20.");
  238 |   await expect(retainedReview).toContainText("Item 2 of 2 on this device. Date: 2026-10-21.");
  239 |   await expect(retainedReview).not.toContainText("run-calc-history");
  240 |   const historyItem = retainedReview.getByRole("listitem").filter({
  241 |     hasText: "Item 1 of 2 on this device. Date: 2026-10-20.",
  242 |   });
  243 |   const historyRemoval = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  244 |   await historyItem.getByRole("button", { name: "Remove this saved copy from this device" }).click();
  245 |   await historyRemoval;
  246 |   await expect(historyItem).toHaveCount(0);
  247 |   expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), historyKey)) ?? "null"))
  248 |     .toEqual([historyRows[1]]);
  249 |   expect(await page.evaluate((key) => localStorage.getItem(key), unrelatedKey)).toBe(unrelatedRaw);
  250 |   reloading = true;
  251 |   await page.reload();
  252 |   await expect(page.getByTestId("shared-records-status"))
  253 |     .toContainText("Saved record on this device. Date: 2026-10-21.");
  254 |   await expect(page.getByTestId("shared-records-status"))
  255 |     .not.toContainText("2026-10-20");
  256 |   expect(await page.evaluate((key) => localStorage.getItem(key), unrelatedKey)).toBe(unrelatedRaw);
  257 |   await page.getByRole("button", { name: /^More/ }).click();
  258 |   await page.getByRole("menuitem", { name: "Reported issues" }).click();
  259 |   await finishManagerReload();
  260 |   const failures = page.getByLabel("Actionable field-check failures");
  261 |   await expect(failures).toBeVisible();
  262 |   await expect(page.getByText(incidentData.correlationId, { exact: true }).first()).toBeVisible();
  263 |   for (const { status, correlationId } of guidanceIncidents) {
  264 |     const incidentRow = page.getByTestId("incident-row").filter({ hasText: correlationId }).first();
  265 |     await expect(incidentRow.getByText(correlationId, { exact: true })).toBeVisible();
  266 |     if (status === 403) {
  267 |       await expect(incidentRow.getByText(/This request was denied because this account does not currently have permission/)).toBeVisible();
  268 |       await expect(incidentRow.getByText(/support route: not identified in the available diagnostics/)).toBeVisible();
  269 |     } else if (status === 409) {
  270 |       await expect(incidentRow.getByText(/The shared value changed before this save reached the server/)).toBeVisible();
  271 |     } else {
  272 |       await expect(incidentRow.getByText(/This sync update did not pass a validation check/)).toBeVisible();
  273 |       await expect(incidentRow.getByText("Support code: SYNC_VALIDATION_FAILED")).toBeVisible();
  274 |     }
  275 |   }
  276 |   await expect(page.getByText(incidentRequestReference, { exact: true })).toBeVisible();
  277 |   const serverErrorRow = page.getByTestId("incident-row").filter({ hasText: incidentData.correlationId }).first();
  278 |   await expect(serverErrorRow.getByText(/Syncing saved changes · the server reported an error · HTTP 500/)).toBeVisible();
  279 |   await expect(serverErrorRow.getByText(/Observed by this browser at/)).toBeVisible();
  280 |   await expect(serverErrorRow.getByText(/browser waited 4023360 ms/)).toBeVisible();
  281 |   await expect(serverErrorRow.getByText(/No background change was detected; the operating-system pause state is unknown/)).toBeVisible();
  282 |   await expect(serverErrorRow.getByText(/The browser wait is not server processing time/)).toBeVisible();
  283 |   await expect(serverErrorRow.getByText(/build reference app-build:identified/)).toBeVisible();
  284 |   const fieldChecks = page.getByTestId("field-checks-panel");
  285 |   await expect(fieldChecks.getByText("Evidence coverage: Never observed").first()).toBeVisible();
  286 |   const recoveryCard = fieldChecks.getByText("Stale-deployment recovery", { exact: true }).locator("../..");
  287 |   await expect(recoveryCard).toContainText("Evidence coverage: Observed, no success");
  288 |   await expect(recoveryCard).toContainText("Failures: 0 · Incomplete: 1 · No issue recorded");
  289 |   await expect(recoveryCard).toContainText("Last success: Not yet");
  290 |   await expect(fieldChecks.getByText(/Server receipt delay estimate: Unknown\/unconfirmed/).first()).toBeVisible();
  291 |   await expect(fieldChecks.getByText(/Server receipt delay estimate: .*after the browser timestamp/).first()).toBeVisible();
  292 |   for (const label of [
  293 |     "The account or permission was rejected",
  294 |     "The saved update was out of date or came after a reset",
  295 |     "The app tried to sync again but did not receive confirmation",
  296 |     "Home screen did not load · browser wait 20001 ms. Browser wait is not server processing time.",
  297 |     "Page did not open · browser wait 20002 ms. Browser wait is not server processing time.",
  298 |   ]) {
  299 |     await expect(failures.getByText(label, { exact: true })).toBeVisible();
  300 |   }
  301 |   await expect(failures.getByText(/Server returned an error · syncing · server error · HTTP 500 · browser wait 4023360 ms/))
  302 |     .toBeVisible();
  303 |   await expect(failures.getByText(requestReference, { exact: true })).toBeVisible();
  304 |   for (const viewport of [
  305 |     { width: 1440, height: 900 },
  306 |     { width: 390, height: 844 },
  307 |     { width: 844, height: 390 },
  308 |     { width: 820, height: 1180 },
  309 |     { width: 1180, height: 820 },
  310 |   ]) {
  311 |     await page.setViewportSize(viewport);
  312 |     await expect(failures).toContainText(requestReference);
  313 |     await expect(page.getByText(incidentData.correlationId, { exact: true }).first()).toBeVisible();
  314 |     expect(await page.locator("html").evaluate((html) => html.scrollWidth))
  315 |       .toBeLessThanOrEqual(viewport.width);
  316 |   }
  317 |   await page.setViewportSize({ width: 1440, height: 900 });
  318 |   // The UI intentionally shows three failures per check; the API retains all four sources.
  319 |   const report = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  320 |   const data = await report.json();
  321 |   expect(data.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
  322 |     .toEqual(expect.arrayContaining([expect.objectContaining({ metrics: { sourceCode: 4, durationMs: 20004 } })]));
  323 |   expect(await failures.innerText()).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\//);
  324 |   await expect(failures.getByText("Unidentified local build; not release verification evidence.").first()).toBeVisible();
  325 |   await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  326 |   await failures.screenshot({ path: testInfo.outputPath("safe-field-check-details.png") });
  327 | 
  328 |   const downloadButton = page.getByRole("button", { name: "Download safe field-check report" });
  329 |   await expect(downloadButton).toBeVisible();
  330 |   // Preserve the support-download regression alongside filtering: a failed
  331 |   // download must never delete or recover observations.
```