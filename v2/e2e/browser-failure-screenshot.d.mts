type BrowserType = {
  name(): string;
};

type ScreenshotPage = {
  isClosed(): boolean;
  screenshot(options: {
    path: string;
    fullPage: boolean;
    animations: "disabled";
  }): Promise<unknown>;
};

export function captureFailureScreenshots(options: {
  testContext: {
    diagnostic(message: string): void;
    error: unknown;
    fullName: string;
    name: string;
  };
  browserType: BrowserType;
  suiteFile: string;
  pages: ScreenshotPage[];
}): Promise<void>;
