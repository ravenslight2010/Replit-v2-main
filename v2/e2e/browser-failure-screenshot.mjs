import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

export async function captureFailureScreenshots({
  testContext,
  browserType,
  suiteFile,
  pages,
}) {
  const outputDirectory = process.env.V2_BROWSER_FAILURE_SCREENSHOT_DIR;
  if (
    !outputDirectory ||
    browserType.name() !== "chromium" ||
    !testContext.error
  ) {
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  const suiteName = basename(suiteFile).replace(/\.browser\.test\.mjs$/, "");
  const slug = testContext.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "scenario";
  const digest = createHash("sha256")
    .update(`${suiteFile}\n${testContext.fullName}`)
    .digest("hex")
    .slice(0, 12);
  const screenshotBase = `${suiteName}-${slug}-${digest}`;
  const manifestPath = join(outputDirectory, "manifest.jsonl");
  let pageNumber = 0;

  for (const page of pages) {
    if (page.isClosed()) continue;
    pageNumber += 1;
    const file = `${screenshotBase}-page-${pageNumber}.png`;
    try {
      await page.screenshot({
        path: join(outputDirectory, file),
        fullPage: false,
        animations: "disabled",
      });
      await appendFile(
        manifestPath,
        `${JSON.stringify({ suite: suiteFile, test: testContext.name, file })}\n`,
        "utf8",
      );
    } catch (error) {
      testContext.diagnostic(
        `Could not capture the failed Chromium page ${pageNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
