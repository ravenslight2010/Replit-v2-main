import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function parseTomlValue(rawValue, context) {
  const value = rawValue.trim();
  try {
    if (value.startsWith('"') || value.startsWith("[")) {
      return JSON.parse(value);
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+$/.test(value)) return Number(value);
  } catch (error) {
    throw new Error(`Invalid TOML value for ${context}: ${error.message}`);
  }
  throw new Error(`Unsupported TOML value for ${context}: ${value}`);
}

function tomlSections(source) {
  const sections = new Map();
  let current;
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = line.match(/^(\[\[?)([^\]]+)(\]\]?)$/);
    if (header) {
      const isArray = header[1] === "[[";
      const name = header[2].trim();
      assert.equal(header[3], isArray ? "]]" : "]", `Invalid TOML section at line ${index + 1}`);
      current = name;
      if (!sections.has(current)) sections.set(current, []);
      sections.get(current).push({});
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    assert.ok(assignment, `Unsupported TOML syntax at line ${index + 1}: ${line}`);
    const [key, rawValue] = [assignment[1], assignment[2]];
    const section = current ?? "";
    if (!sections.has(section)) sections.set(section, [{}]);
    const records = sections.get(section);
    records.at(-1)[key] = parseTomlValue(rawValue, `${section || "root"}.${key}`);
  }
  return sections;
}

function requireValue(sections, sectionName, key, expected, filePath) {
  const records = sections.get(sectionName) ?? [];
  assert.ok(records.length > 0, `${filePath} is missing [${sectionName}]`);
  assert.deepEqual(
    records.at(-1)[key],
    expected,
    `${filePath} has an unexpected ${sectionName || "root"}.${key}`,
  );
}

export function validateV2ArtifactManifest(source, artifact) {
  const sections = tomlSections(source);
  const { path: filePath, root, kind, id, title, previewPath, service } = artifact;
  for (const [key, expected] of Object.entries({ kind, id, title, previewPath })) {
    requireValue(sections, "", key, expected, filePath);
  }
  for (const [key, expected] of Object.entries(service.root)) {
    requireValue(sections, "services", key, expected, filePath);
  }
  for (const [section, values] of Object.entries(service.sections)) {
    for (const [key, expected] of Object.entries(values)) {
      requireValue(sections, section, key, expected, filePath);
    }
  }
  assert.equal(root, true);
}

const ARTIFACTS = [
  {
    path: "artifacts/api-server/.replit-artifact/artifact.toml",
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
  {
    path: "artifacts/run-calculator/.replit-artifact/artifact.toml",
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
        "services.production.rewrites": { from: "/*", to: "/index.html" },
      },
    },
  },
];

const WEB_EXTENSIONS = new Set([".js", ".mjs", ".css", ".svg", ".webmanifest"]);
const CORE_ASSETS = [
  "die-defaults.mjs",
  "import-csv-templates.mjs",
  "import-csv.mjs",
  "mix-plan.mjs",
  "schedule-planning.mjs",
  "setup-catalog-csv.mjs",
  "station-workflows.mjs",
];

async function assertSameFile(sourcePath, builtPath) {
  const [source, built] = await Promise.all([
    readFile(sourcePath),
    readFile(builtPath),
  ]);
  assert.deepEqual(
    built,
    source,
    `Static bundle file ${relative(rootDir, builtPath)} does not match ${relative(rootDir, sourcePath)}`,
  );
}

export async function validateV2StaticBundle(root = rootDir) {
  const sourceWeb = join(root, "v2/web");
  const publicDir = join(root, "artifacts/run-calculator/dist/public");
  await assertSameFile(join(sourceWeb, "index.html"), join(publicDir, "index.html"));
  await assertSameFile(join(sourceWeb, "index.html"), join(publicDir, "v2/web/app-shell.html"));
  await assertSameFile(join(sourceWeb, "manifest.webmanifest"), join(publicDir, "manifest.webmanifest"));
  await assertSameFile(join(sourceWeb, "service-worker.js"), join(publicDir, "service-worker.js"));

  const webFiles = await readdir(sourceWeb, { withFileTypes: true });
  const expectedWebFiles = webFiles
    .filter((entry) => entry.isFile()
      && WEB_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))
      && !entry.name.includes(".test."))
    .map((entry) => entry.name);
  for (const file of expectedWebFiles) {
    await assertSameFile(join(sourceWeb, file), join(publicDir, "v2/web", file));
  }
  for (const file of CORE_ASSETS) {
    await assertSameFile(join(root, "v2/core", file), join(publicDir, "v2/core", file));
  }

  const html = await readFile(join(publicDir, "index.html"), "utf8");
  for (const [, assetPath] of html.matchAll(/(?:src|href)="(\/(?:v2\/web\/|manifest\.webmanifest)[^"]*)"/g)) {
    const diskPath = assetPath === "/manifest.webmanifest"
      ? join(publicDir, "manifest.webmanifest")
      : join(publicDir, assetPath.slice(1));
    await readFile(diskPath);
  }
}

export async function runV2ArtifactReleaseCheck(root = rootDir) {
  for (const artifact of ARTIFACTS) {
    const manifest = await readFile(join(root, artifact.path), "utf8");
    validateV2ArtifactManifest(manifest, artifact);
  }
  await validateV2StaticBundle(root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runV2ArtifactReleaseCheck();
  console.log("V2 artifact manifests and built static bundle passed validation.");
}
