# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workbook-auto-ai-fallback.spec.ts >> deterministic exported workbook stays model-free
- Location: e2e/workbook-auto-ai-fallback.spec.ts:718:1

# Error details

```
Error: locator.waitFor: Test ended.
Call log:
  - waiting for getByTestId('tab-run')

```

# Test source

```ts
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
  146 |   password: string,
  147 |   options: BrowserSignUpOptions = {},
  148 | ): Promise<boolean> {
  149 |   await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  150 |   await page.locator("#username").waitFor({
  151 |     state: "visible",
  152 |     timeout: SIGNUP_FORM_TIMEOUT,
  153 |   });
  154 |   await page.locator("#username").fill(username);
  155 |   await page.locator("#password").fill(password);
  156 |   await page.locator("#confirm").fill(password);
  157 |   await page.locator("#accessCode").fill(
  158 |     options.signupCode ?? process.env.STAFF_SIGNUP_CODE ?? "",
  159 |   );
  160 | 
  161 |   const signupResponse = page.waitForResponse(
  162 |     (response) =>
  163 |       response.url().endsWith("/api/auth/sign-up") &&
  164 |       response.request().method() === "POST",
  165 |   );
  166 |   await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  167 |   const response = await signupResponse;
  168 |   const body = (await response.text().catch(() => "<unavailable>")).trim();
  169 |   const bodyContext = body ? body.slice(0, 1_000) : "<empty>";
  170 |   expect(
  171 |     response.status(),
  172 |     `POST /api/auth/sign-up returned status ${response.status()} with body: ${bodyContext}`,
  173 |   ).toBeGreaterThanOrEqual(200);
  174 |   expect(
  175 |     response.status(),
  176 |     `POST /api/auth/sign-up returned status ${response.status()} with body: ${bodyContext}`,
  177 |   ).toBeLessThan(300);
  178 | 
  179 |   if (options.waitForApp) {
  180 |     await options.waitForApp(page);
  181 |   } else {
> 182 |     await page.getByTestId("tab-run").waitFor({
      |                                       ^ Error: locator.waitFor: Test ended.
  183 |       state: "attached",
  184 |       timeout: APP_READY_TIMEOUT,
  185 |     });
  186 |   }
  187 | 
  188 |   const onboardingDismissed =
  189 |     options.onboarding !== false
  190 |       ? await dismissOnboardingIfPresent(page, options.onboarding)
  191 |       : false;
  192 |   await options.afterSignUp?.(page);
  193 |   return onboardingDismissed;
  194 | }
  195 | 
```