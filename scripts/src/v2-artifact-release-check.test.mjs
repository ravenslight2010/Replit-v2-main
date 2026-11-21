import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateV2ArtifactManifest } from "./v2-artifact-release-check.mjs";

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

console.log("V2 artifact manifest contract tests passed.");
