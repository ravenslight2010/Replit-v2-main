# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: report-issue-confirmation.spec.ts >> manager reviews a staff issue report and retains the review after reload
- Location: e2e/report-issue-confirmation.spec.ts:91:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('incident-row').filter({ hasText: 'issue_review_staff_mvxkld59_25tzjxcc' })
Expected substring: "ca46b72a-5720-4a98-9011-6f3cd67f135e"
Error: strict mode violation: getByTestId('incident-row').filter({ hasText: 'issue_review_staff_mvxkld59_25tzjxcc' }) resolved to 1126 elements:
    1) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka getByTestId('incident-row').first()
    2) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka getByTestId('incident-row').nth(1)
    3) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka getByTestId('incident-row').nth(2)
    4) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka getByTestId('incident-row').nth(3)
    5) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka getByTestId('incident-row').nth(4)
    6) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka getByTestId('incident-row').nth(5)
    7) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka locator('div:nth-child(3) > div:nth-child(7)')
    8) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka locator('.space-y-3 > div:nth-child(8)')
    9) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka locator('.space-y-3 > div:nth-child(9)')
    10) <div data-component-name="div" data-testid="incident-row" class="rounded-lg border border-border bg-card" data-replit-metadata="artifacts/run-calculator/src/components/IncidentsTab.tsx:161:4">…</div> aka locator('.space-y-3 > div:nth-child(10)')
    ...

Call log:
  - Expect "toContainText" getByTestId('incident-row').filter({ hasText: 'issue_review_staff_mvxkld59_25tzjxcc' }) with timeout 5000ms
  - waiting for getByTestId('incident-row').filter({ hasText: 'issue_review_staff_mvxkld59_25tzjxcc' })

```

# Test source

```ts
  87  |   await expect(dialog).not.toContainText(/seen before|last time this helped|kind of problem has come up before/i);
  88  |   expect(result.recurrence).toBeNull();
  89  | });
  90  | 
  91  | test("manager reviews a staff issue report and retains the review after reload", async ({
  92  |   browser,
  93  |   playwright,
  94  |   request,
  95  |   baseURL,
  96  | }, testInfo) => {
  97  |   test.skip(!baseURL, "Requires the isolated browser runner.");
  98  |   const apiOrigin = requireLocalFixtureApiOrigin(
  99  |     "manager issue-report review browser verification",
  100 |   );
  101 |   const fixtures = await AuthorizedBrowserFixtures.create(
  102 |     playwright,
  103 |     apiOrigin,
  104 |     SIGNUP_CODE,
  105 |   );
  106 |   const databaseUrl = requireDedicatedTestDatabase(
  107 |     "manager issue-report review browser verification",
  108 |   );
  109 |   const createdIncidentIds = new Set<string>();
  110 |   const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  111 |   let db: Client | null = null;
  112 | 
  113 |   const openAuthenticated = async (token: string): Promise<Page> => {
  114 |     const context = await browser.newContext({
  115 |       viewport: testInfo.project.use.viewport as
  116 |         | { width: number; height: number }
  117 |         | undefined,
  118 |       serviceWorkers: "block",
  119 |     });
  120 |     contexts.push(context);
  121 |     await context.addCookies([
  122 |       {
  123 |         name: "rc_auth",
  124 |         value: token,
  125 |         url: new URL(baseURL!).origin,
  126 |         httpOnly: true,
  127 |         sameSite: "Lax",
  128 |       },
  129 |     ]);
  130 |     const page = await context.newPage();
  131 |     await page.goto(baseURL!, { waitUntil: "domcontentloaded" });
  132 |     await page.getByTestId("tab-run").waitFor({
  133 |       state: "attached",
  134 |       timeout: 25_000,
  135 |     });
  136 |     return page;
  137 |   };
  138 | 
  139 |   try {
  140 |     db = new Client({ connectionString: databaseUrl });
  141 |     await db.connect();
  142 |     const manager = await fixtures.createAccount({
  143 |       username: uniqueTestId("issue_review_manager"),
  144 |       password: PASSWORD,
  145 |       capabilities: [],
  146 |       onboardingSeen: true,
  147 |     });
  148 |     await fixtures.assignManagerRole(manager);
  149 |     const staff = await fixtures.createAccount({
  150 |       username: uniqueTestId("issue_review_staff"),
  151 |       password: PASSWORD,
  152 |       capabilities: [],
  153 |       onboardingSeen: true,
  154 |     });
  155 | 
  156 |     const denied = await request.get(`${apiOrigin}/api/incidents`, {
  157 |       headers: staff.cookieHeader,
  158 |     });
  159 |     expect(denied.status()).toBe(403);
  160 | 
  161 |     const description = "Synthetic report for manager review";
  162 |     const submitted = await request.post(`${apiOrigin}/api/incidents`, {
  163 |       headers: staff.cookieHeader,
  164 |       data: {
  165 |         source: "user_report",
  166 |         screen: "Run",
  167 |         appPlatform: "web",
  168 |         description,
  169 |       },
  170 |     });
  171 |     expect(submitted.status()).toBe(200);
  172 |     const report = (await submitted.json()) as {
  173 |       incidentId: string;
  174 |       correlationId: string;
  175 |     };
  176 |     createdIncidentIds.add(report.incidentId);
  177 | 
  178 |     const managerPage = await openAuthenticated(manager.token);
  179 |     await managerPage.getByTitle("More").click();
  180 |     await managerPage
  181 |       .getByRole("menuitem", { name: "Reported issues", exact: true })
  182 |       .click();
  183 |     const incident = managerPage
  184 |       .getByTestId("incident-row")
  185 |       .filter({ hasText: staff.username });
  186 |     await expect(incident).toBeVisible();
> 187 |     await expect(incident).toContainText(report.correlationId);
      |                            ^ Error: expect(locator).toContainText(expected) failed
  188 |     const reviewResponse = managerPage.waitForResponse(
  189 |       (response) =>
  190 |         response.request().method() === "POST" &&
  191 |         new URL(response.url()).pathname ===
  192 |           `/api/incidents/${report.incidentId}/review`,
  193 |     );
  194 |     await incident
  195 |       .getByRole("button", { name: "Mark reviewed", exact: true })
  196 |       .click();
  197 |     expect((await reviewResponse).status()).toBe(200);
  198 |     await expect(
  199 |       incident.getByText("Reviewed", { exact: true }).first(),
  200 |     ).toBeVisible();
  201 | 
  202 |     await managerPage.reload({ waitUntil: "domcontentloaded" });
  203 |     await managerPage.getByTestId("tab-run").waitFor({
  204 |       state: "attached",
  205 |       timeout: 25_000,
  206 |     });
  207 |     await managerPage.getByTitle("More").click();
  208 |     await managerPage
  209 |       .getByRole("menuitem", { name: "Reported issues", exact: true })
  210 |       .click();
  211 |     const reloadedIncident = managerPage
  212 |       .getByTestId("incident-row")
  213 |       .filter({ hasText: staff.username });
  214 |     await expect(reloadedIncident).toBeVisible();
  215 |     await expect(
  216 |       reloadedIncident.getByText("Reviewed", { exact: true }),
  217 |     ).toBeVisible();
  218 |     await reloadedIncident
  219 |       .getByRole("button")
  220 |       .first()
  221 |       .click();
  222 |     await expect(reloadedIncident).toContainText(description);
  223 |     await expect(reloadedIncident).toContainText(report.correlationId);
  224 |     await expect(
  225 |       reloadedIncident.getByRole("button", {
  226 |         name: "Mark reviewed",
  227 |         exact: true,
  228 |       }),
  229 |     ).toHaveCount(0);
  230 |   } finally {
  231 |     for (const context of contexts) {
  232 |       await context.close().catch(() => {});
  233 |     }
  234 |     if (db) {
  235 |       try {
  236 |         if (createdIncidentIds.size > 0) {
  237 |           await db.query("DELETE FROM incidents WHERE id = ANY($1::text[])", [
  238 |             [...createdIncidentIds],
  239 |           ]);
  240 |         }
  241 |       } finally {
  242 |         await db.end().catch(() => {});
  243 |       }
  244 |     }
  245 |     await fixtures.cleanup();
  246 |   }
  247 | });
  248 | 
```