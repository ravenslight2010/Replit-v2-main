import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertClientRouteResponse,
  assertStaticAssetResponse,
  runV2ArtifactReleaseCheck,
  validateV2ArtifactManifest,
  validateV2WebAppInstallContract,
} from "./v2-artifact-release-check.mjs";

const rootDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const manifests = [
  {
    path: "artifacts/api-server/.replit-artifact/artifact.toml",
    artifact: {
      kind: "api",
      id: "3B4_FFSkEVBkAeYMFRJ2e",
      title: "API Server",
      previewPath: "/api/healthz",
      root: true,
      service: {
        root: { name: "API Server", localPort: 8080, paths: ["/api"] },
        sections: {
          "services.production.build": {
            args: ["pnpm", "--filter", "@workspace/lucia-v2", "run", "build"],
          },
          "services.production.run": {
            args: ["bash", "scripts/start-v2.sh"],
          },
          "services.production.health.startup": { path: "/api/healthz" },
        },
      },
    },
  },
  {
    path: "artifacts/run-calculator/.replit-artifact/artifact.toml",
    artifact: {
      kind: "web",
      id: "artifacts/run-calculator",
      title: "Production Run Calculator",
      previewPath: "/",
      root: true,
      service: {
        root: { name: "web", localPort: 26038, paths: ["/"] },
        sections: {
          "services.production": {
            build: ["bash", "scripts/build-v2-artifact-static.sh"],
            publicDir: "artifacts/run-calculator/dist/public",
            serve: "static",
          },
          "services.production.rewrites": {
            from: "/*",
            to: "/index.html",
          },
        },
      },
    },
  },
];

for (const { path, artifact } of manifests) {
  const source = await readFile(resolve(rootDir, path), "utf8");
  assert.doesNotThrow(
    () => validateV2ArtifactManifest(source, artifact),
    `${path} should match the V2 production contract`,
  );
  assert.throws(
    () => validateV2ArtifactManifest(source.replace(artifact.id, "wrong-id"), artifact),
    /unexpected .*\.id/,
    `${path} should reject a stale artifact identity`,
  );
}

assert.doesNotThrow(() => assertStaticAssetResponse(
  "/v2/web/app.js",
  200,
  "application/javascript; charset=utf-8",
  "import './write-gate.mjs';",
));
assert.throws(
  () => assertStaticAssetResponse("/v2/web/app.js", 200, "text/html", "<!doctype html>"),
  /incorrect content type/,
  "A rewrite fallback must not pass as a JavaScript asset",
);
assert.throws(
  () => assertStaticAssetResponse("/v2/web/styles.css", 404, "text/html", "<!doctype html>"),
  /HTTP 404/,
  "A missing static asset must fail the release check",
);
assert.throws(
  () => assertStaticAssetResponse("/v2/web/styles.css", 200, "text/css", "<html>fallback</html>"),
  /fallback HTML/,
  "HTML content must not pass as a CSS asset even with a wrong header",
);
assert.doesNotThrow(
  () => assertClientRouteResponse(
    "/setup/profiles",
    200,
    "text/html; charset=utf-8",
    "<!doctype html><html></html>",
    "<!doctype html><html></html>",
  ),
  "A nested client route should return the app shell as HTML",
);
assert.throws(
  () => assertClientRouteResponse(
    "/setup/profiles",
    200,
    "application/octet-stream",
    "<!doctype html><html></html>",
    "<!doctype html><html></html>",
  ),
  /incorrect content type/,
  "A nested client route must return an HTML content type",
);

const [webManifestSource, v2IndexHtml, v2Icon] = await Promise.all([
  readFile(resolve(rootDir, "v2/web/manifest.webmanifest"), "utf8"),
  readFile(resolve(rootDir, "v2/web/index.html"), "utf8"),
  readFile(resolve(rootDir, "v2/web/favicon.svg"), "utf8"),
]);
const webManifest = JSON.parse(webManifestSource);
assert.doesNotThrow(
  () => validateV2WebAppInstallContract(webManifestSource, v2IndexHtml),
  "The V2 install contract should match the root-served app",
);

for (const [label, mutate, expectedError] of [
  ["install name", (manifest) => { manifest.name = "Unrelated app"; }, /install name/],
  ["short install name", (manifest) => { manifest.short_name = "Floor"; }, /short install name/],
  ["start URL", (manifest) => { manifest.start_url = "/login"; }, /start at the root/],
  ["scope", (manifest) => { manifest.scope = "/other/"; }, /scope must cover/],
  ["display mode", (manifest) => { manifest.display = "browser"; }, /display mode/],
  ["theme color", (manifest) => { manifest.theme_color = "#000000"; }, /theme color/],
  ["icon type", (manifest) => { manifest.icons[0].type = "image/png"; }, /unsupported type/],
  ["icon path", (manifest) => { manifest.icons[0].src = "https://example.test/icon.svg"; }, /root-served asset path/],
  ["icon sizes", (manifest) => { manifest.icons[0].sizes = "large"; }, /valid sizes/],
  ["icon purpose", (manifest) => { manifest.icons[0].purpose = "download"; }, /unsupported purpose/],
]) {
  const invalidManifest = structuredClone(webManifest);
  mutate(invalidManifest);
  assert.throws(
    () => validateV2WebAppInstallContract(JSON.stringify(invalidManifest), v2IndexHtml),
    expectedError,
    `The install contract should reject an invalid ${label}`,
  );
}

assert.doesNotThrow(
  () => assertStaticAssetResponse("/v2/web/favicon.svg", 200, "image/svg+xml; charset=utf-8", v2Icon),
  "A declared SVG icon should be served with its supported image type",
);
assert.throws(
  () => assertStaticAssetResponse("/v2/web/favicon.svg", 200, "text/html", "<!doctype html><html></html>"),
  /incorrect content type/,
  "A rewrite fallback must not pass as an install icon",
);
assert.throws(
  () => assertStaticAssetResponse("/v2/web/favicon.svg", 200, "image/svg+xml", "<not-svg />"),
  /valid SVG icon/,
  "A non-SVG body must not pass as a valid install icon",
);

await runV2ArtifactReleaseCheck(rootDir);
console.log("V2 artifact manifests, install metadata, bundle, and static HTTP contract tests passed.");
