# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home-navigation-reload.spec.ts >> Home navigation persistence >> restores a non-Run tab after reload
- Location: e2e/home-navigation-reload.spec.ts:109:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('status')
Expected substring: "Confirming your staff session"
Error: strict mode violation: getByRole('status') resolved to 2 elements:
    1) <p role="status" aria-live="polite" data-component-name="p" class="w-full break-words px-2 pb-1 text-xs text-muted-foreground" data-replit-metadata="artifacts/run-calculator/src/components/AppUpdateControl.tsx:90:10">Development preview. Published updates are not ch…</p> aka getByText('Development preview.')
    2) <div role="status" aria-live="polite" class="flex w-full max-w-sm flex-col items-center rounded-2xl border border-border/50 bg-card/60 p-8 text-center shadow-md">…</div> aka getByText('Opening Run CalculatorChecking current production state…')

Call log:
  - Expect "toContainText" getByRole('status') with timeout 5000ms
  - waiting for getByRole('status')

```

# Test source

```ts
  1   | import { expect, type Locator, type Page, type Response } from "@playwright/test";
  2   | 
  3   | // Release browser runs can briefly saturate the disposable database while a
  4   | // fresh account's bootstrap requests are settling. Keep the assertion tied to
  5   | // the real POST, but allow that bounded server-side queue time.
  6   | const ONBOARDING_RESPONSE_TIMEOUT = 30_000;
  7   | const SIGNUP_FORM_TIMEOUT = 20_000;
  8   | const APP_READY_TIMEOUT = 25_000;
  9   | 
  10  | export type CompleteOnboardingOptions = {
  11  |   button?: Locator;
  12  |   clickOptions?: Parameters<Locator["click"]>[0];
  13  |   actionLabel?: string;
  14  | };
  15  | 
  16  | export type DismissOnboardingOptions = Omit<CompleteOnboardingOptions, "button"> & {
  17  |   dialog?: (page: Page) => Locator;
  18  |   button?: Locator | ((dialog: Locator) => Locator);
  19  |   visibilityTimeout?: number;
  20  |   afterComplete?: (page: Page, dialog: Locator) => Promise<void>;
  21  | };
  22  | 
  23  | export type BrowserSignUpOptions = {
  24  |   signupCode?: string;
  25  |   waitForApp?: (page: Page) => Promise<void>;
  26  |   onboarding?: DismissOnboardingOptions | false;
  27  |   afterSignUp?: (page: Page) => Promise<void>;
  28  | };
  29  | 
  30  | export async function reloadThroughSettlingSession(page: Page): Promise<void> {
  31  |   let releaseMe: (() => void) | undefined;
  32  |   const holdMe = new Promise<void>((resolve) => {
  33  |     releaseMe = resolve;
  34  |   });
  35  | 
  36  |   await page.route("**/api/me", async (route) => {
  37  |     await holdMe;
  38  |     await route.continue();
  39  |   }, { times: 1 });
  40  | 
  41  |   await page.reload({ waitUntil: "domcontentloaded" });
  42  |   await expect(page.getByTestId("app-loading")).toBeVisible({
  43  |     timeout: APP_READY_TIMEOUT,
  44  |   });
> 45  |   await expect(page.getByRole("status")).toContainText(
      |                                          ^ Error: expect(locator).toContainText(expected) failed
  46  |     "Confirming your staff session",
  47  |   );
  48  | 
  49  |   releaseMe?.();
  50  |   await page.getByTestId("tab-run").waitFor({
  51  |     state: "attached",
  52  |     timeout: APP_READY_TIMEOUT,
  53  |   });
  54  |   await expect(page.getByTestId("app-loading")).toBeHidden();
  55  | }
  56  | 
  57  | export async function completeOnboarding(
  58  |   page: Page,
  59  |   welcome: Locator,
  60  |   options: CompleteOnboardingOptions = {},
  61  | ): Promise<void> {
  62  |   const completionButton = options.button ?? welcome.getByRole("button", {
  63  |     name: "Get started",
  64  |     exact: true,
  65  |   });
  66  |   const actionLabel = options.actionLabel ?? "Get started";
  67  | 
  68  |   // Register the waiter before clicking so a fast response cannot be missed.
  69  |   const seenPromise = page.waitForResponse(
  70  |     (candidate) =>
  71  |       candidate.url().endsWith("/api/me/onboarding-seen") &&
  72  |       candidate.request().method() === "POST",
  73  |     { timeout: ONBOARDING_RESPONSE_TIMEOUT },
  74  |   );
  75  |   let response: Response;
  76  |   try {
  77  |     [response] = await Promise.all([
  78  |       seenPromise,
  79  |       completionButton.click(options.clickOptions),
  80  |     ]);
  81  |   } catch (error) {
  82  |     const reason = error instanceof Error ? error.message : String(error);
  83  |     throw new Error(
  84  |       `Timed out waiting up to ${ONBOARDING_RESPONSE_TIMEOUT}ms for POST /api/me/onboarding-seen after clicking ${actionLabel}: ${reason}`,
  85  |     );
  86  |   }
  87  | 
  88  |   const body = (await response.text().catch(() => "<unavailable>")).trim();
  89  |   const bodyContext = body ? body.slice(0, 1_000) : "<empty>";
  90  |   expect(
  91  |     response.status(),
  92  |     `POST /api/me/onboarding-seen returned status ${response.status()} with body: ${bodyContext}`,
  93  |   ).toBe(200);
  94  |   await expect(welcome).toBeHidden({ timeout: 10_000 });
  95  | }
  96  | 
  97  | /**
  98  |  * Complete the first-login onboarding dialog when it appears.
  99  |  *
  100 |  * The dialog is optional for returning users and fixtures that pre-mark
  101 |  * onboarding as seen. Once it is visible, completion always goes through
  102 |  * completeOnboarding so a failed POST cannot be hidden by a successful click.
  103 |  */
  104 | export async function dismissOnboardingIfPresent(
  105 |   page: Page,
  106 |   options: DismissOnboardingOptions = {},
  107 | ): Promise<boolean> {
  108 |   const dialog =
  109 |     options.dialog?.(page) ??
  110 |     page.getByRole("dialog");
  111 |   const visible = await dialog
  112 |     .waitFor({
  113 |       state: "visible",
  114 |       timeout: options.visibilityTimeout ?? 8_000,
  115 |     })
  116 |     .then(() => true)
  117 |     .catch(() => false);
  118 |   if (!visible) return false;
  119 | 
  120 |   const completionButton =
  121 |     (typeof options.button === "function"
  122 |       ? options.button(dialog)
  123 |       : options.button) ??
  124 |     dialog.getByRole("button", {
  125 |       name: "Get started",
  126 |       exact: true,
  127 |     });
  128 |   await completeOnboarding(page, dialog, {
  129 |     button: completionButton,
  130 |     clickOptions: options.clickOptions,
  131 |     actionLabel: options.actionLabel,
  132 |   });
  133 |   await options.afterComplete?.(page, dialog);
  134 |   return true;
  135 | }
  136 | 
  137 | /**
  138 |  * Create a fresh browser account and make its authenticated shell usable.
  139 |  *
  140 |  * Suites may still supply app-ready waits and post-onboarding cleanup, but
  141 |  * account creation and the optional onboarding decision stay in one place.
  142 |  */
  143 | export async function signUpAndHandleOnboarding(
  144 |   page: Page,
  145 |   username: string,
```