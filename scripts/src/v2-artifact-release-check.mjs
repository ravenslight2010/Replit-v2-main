import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
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
const STATIC_MIME_TYPES = {
  ".css": ["text/css"],
  ".html": ["text/html"],
  ".js": ["application/javascript", "text/javascript"],
  ".json": ["application/json"],
  ".mjs": ["application/javascript", "text/javascript"],
  ".svg": ["image/svg+xml"],
  ".webmanifest": ["application/manifest+json", "application/json"],
};
const SUPPORTED_ICON_TYPES = new Map([
  [".svg", "image/svg+xml"],
]);
const ARTIFACT_ASSET_PREFIXES = ["/v2/web/", "/v2/core/"];

function artifactPathFromReference(reference, base = "http://artifact/") {
  try {
    const url = new URL(reference, base);
    if (url.origin !== "http://artifact") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (
      pathname === "/manifest.webmanifest"
      || pathname === "/service-worker.js"
      || pathname === "/favicon.ico"
      || ARTIFACT_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      return pathname;
    }
  } catch {
    return null;
  }
  return null;
}

function getLinkTag(html, rel) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find((tag) => new RegExp(`\\brel=["']${rel}["']`, "i").test(tag));
}

function getTagAttribute(tag, attribute) {
  return tag?.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1];
}

export function validateV2WebAppInstallContract(manifestSource, indexHtml) {
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    throw new Error(`Invalid V2 web manifest: ${error.message}`);
  }

  assert.equal(manifest.name, "Fieldline Production Floor", "The install name must identify the Fieldline production floor");
  assert.equal(manifest.short_name, "Fieldline", "The short install name must match the Fieldline wordmark");
  assert.equal(manifest.start_url, "/", "The installed app must start at the root-served V2 app");
  assert.equal(manifest.scope, "/", "The installed app scope must cover the root-served V2 app");
  assert.equal(manifest.display, "standalone", "The installed app must use standalone display mode");

  const title = indexHtml.match(/<title>([^<]+)<\/title>/i)?.[1];
  assert.ok(title, "The root-served V2 app must declare a title");
  assert.match(title, /Fieldline/i, "The install name must match the root-served app brand");
  assert.match(indexHtml, />\s*FIELDLINE\s*</i, "The short install name must match the root-served wordmark");
  assert.match(indexHtml, />\s*PRODUCTION FLOOR\s*</i, "The install name must match the root-served app purpose");

  const manifestLink = getLinkTag(indexHtml, "manifest");
  assert.equal(
    getTagAttribute(manifestLink, "href"),
    "/manifest.webmanifest",
    "The root-served app must link to the root-served web manifest",
  );
  const themeColorTag = indexHtml.match(/<meta\b(?=[^>]*\bname=["']theme-color["'])[^>]*>/i)?.[0];
  const pageThemeColor = getTagAttribute(themeColorTag, "content");
  assert.ok(pageThemeColor, "The root-served app must declare a theme color");
  assert.equal(
    manifest.theme_color?.toLowerCase(),
    pageThemeColor.toLowerCase(),
    "The install theme color must match the root-served app",
  );

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "The web manifest must declare at least one icon");
  const rootIconLink = getLinkTag(indexHtml, "icon");
  const rootIconPath = getTagAttribute(rootIconLink, "href");
  const rootIconType = getTagAttribute(rootIconLink, "type");
  assert.ok(rootIconPath, "The root-served app must declare its icon path");

  for (const [index, icon] of manifest.icons.entries()) {
    assert.ok(icon && typeof icon === "object", `Manifest icon ${index + 1} must be an object`);
    const assetPath = artifactPathFromReference(icon.src);
    assert.ok(
      assetPath && assetPath === icon.src,
      `Manifest icon ${index + 1} must use a supported root-served asset path`,
    );
    const extension = assetPath.slice(assetPath.lastIndexOf(".")).toLowerCase();
    assert.equal(
      SUPPORTED_ICON_TYPES.get(extension),
      icon.type,
      `Manifest icon ${index + 1} has an unsupported type for ${assetPath}`,
    );
    assert.ok(
      icon.sizes === "any" || (typeof icon.sizes === "string" && /^\d+x\d+(?:\s+\d+x\d+)*$/.test(icon.sizes)),
      `Manifest icon ${index + 1} must declare valid sizes`,
    );
    if (icon.purpose !== undefined) {
      assert.ok(
        typeof icon.purpose === "string"
          && icon.purpose.split(/\s+/).every((purpose) => ["any", "maskable", "monochrome"].includes(purpose)),
        `Manifest icon ${index + 1} has an unsupported purpose`,
      );
    }
  }
  assert.ok(
    manifest.icons.some((icon) => icon.src === rootIconPath && icon.type === rootIconType),
    "A declared install icon must match the root-served app icon",
  );
}

function moduleReferences(source) {
  const references = [];
  const staticImports = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?["']([^"']+)["']/gs;
  const dynamicImports = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(staticImports)) references.push(match[1]);
  for (const match of source.matchAll(dynamicImports)) references.push(match[1]);
  return references;
}

async function collectReferencedArtifactPaths(publicDir) {
  const html = await readFile(join(publicDir, "index.html"), "utf8");
  const pending = new Set(["/"]);
  const visited = new Set();
  for (const [, reference] of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const path = artifactPathFromReference(reference);
    if (path) pending.add(path);
  }

  while (pending.size > 0) {
    const [assetPath] = pending;
    pending.delete(assetPath);
    if (assetPath === "/" || visited.has(assetPath)) continue;
    visited.add(assetPath);

    const diskPath = resolve(publicDir, `.${assetPath}`);
    const publicRoot = resolve(publicDir);
    assert.ok(
      diskPath.startsWith(`${publicRoot}/`),
      `Static artifact path escapes its public directory: ${assetPath}`,
    );
    let source;
    try {
      source = await readFile(diskPath, "utf8");
    } catch (error) {
      throw new Error(`Referenced static artifact asset is missing: ${assetPath}`, { cause: error });
    }

    const extension = assetPath.slice(assetPath.lastIndexOf("."));
    const baseUrl = `http://artifact${assetPath}`;
    if (extension === ".js" || extension === ".mjs") {
      for (const reference of moduleReferences(source)) {
        const path = artifactPathFromReference(reference, baseUrl);
        if (path && !visited.has(path)) pending.add(path);
      }
    }
    for (const [, reference] of source.matchAll(/["'`](\/(?:v2\/(?:web|core)\/|manifest\.webmanifest|service-worker\.js)[^"'`?#]*)/g)) {
      const path = artifactPathFromReference(reference, baseUrl);
      if (path && !visited.has(path)) pending.add(path);
    }
    if (extension === ".css") {
      for (const [, reference] of source.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)) {
        const path = artifactPathFromReference(reference, baseUrl);
        if (path && !visited.has(path)) pending.add(path);
      }
    }
    if (extension === ".webmanifest") {
      let manifest;
      try {
        manifest = JSON.parse(source);
      } catch (error) {
        throw new Error(`Invalid web manifest at ${assetPath}: ${error.message}`);
      }
      for (const icon of manifest.icons ?? []) {
        const path = artifactPathFromReference(icon.src, baseUrl);
        if (path && !visited.has(path)) pending.add(path);
      }
    }
  }

  return [...visited].sort();
}

function contentTypeForPath(pathname) {
  const extension = pathname.slice(pathname.lastIndexOf("."));
  if (pathname === "/") return "text/html";
  return STATIC_MIME_TYPES[extension]?.[0] ?? "application/octet-stream";
}

function startStaticArtifactServer(publicDir, rewrite) {
  const publicRoot = resolve(publicDir);
  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://artifact").pathname);
    } catch {
      response.writeHead(400).end("Bad Request");
      return;
    }
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    let servedPath = requestedPath;
    let diskPath = resolve(publicRoot, `.${requestedPath}`);
    if (!diskPath.startsWith(`${publicRoot}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      if (!(await stat(diskPath)).isFile()) throw new Error("Not a file");
    } catch {
      if (rewrite.from !== "/*" || rewrite.to !== "/index.html") {
        response.writeHead(404).end("Not Found");
        return;
      }
      servedPath = rewrite.to;
      diskPath = resolve(publicRoot, `.${servedPath}`);
    }
    try {
      const body = await readFile(diskPath);
      response.writeHead(200, {
        "content-type": `${contentTypeForPath(servedPath)}; charset=utf-8`,
        "content-length": body.length,
      }).end(body);
    } catch {
      response.writeHead(404).end("Not Found");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveServer({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

export function assertStaticAssetResponse(pathname, status, contentType, body) {
  assert.equal(status, 200, `Static artifact request failed for ${pathname}: HTTP ${status}`);
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  const extension = pathname === "/" ? ".html" : pathname.slice(pathname.lastIndexOf("."));
  const expectedTypes = STATIC_MIME_TYPES[extension];
  assert.ok(
    expectedTypes?.includes(mediaType),
    `Static artifact ${pathname} has incorrect content type ${contentType ?? "(missing)"}`,
  );
  if (extension === ".js" || extension === ".mjs" || extension === ".css" || extension === ".svg") {
    assert.doesNotMatch(
      body.trimStart(),
      /^<(?:!doctype\s+html|html)\b/i,
      `Static artifact ${pathname} returned fallback HTML instead of its asset`,
    );
  }
  if (extension === ".svg") {
    assert.match(body.trimStart(), /^<svg\b/i, `Static artifact ${pathname} did not return a valid SVG icon`);
  }
}

export function assertClientRouteResponse(pathname, status, contentType, body, appShell) {
  assert.equal(status, 200, `V2 client route failed for ${pathname}: HTTP ${status}`);
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  assert.equal(
    mediaType,
    "text/html",
    `V2 client route ${pathname} has incorrect content type ${contentType ?? "(missing)"}`,
  );
  assert.equal(body, appShell, `V2 client route ${pathname} did not return the app shell`);
}

async function validateV2StaticArtifactHttp(root) {
  const webArtifact = ARTIFACTS.find((artifact) => artifact.kind === "web");
  const productionService = webArtifact.service.sections["services.production"];
  const rewrite = webArtifact.service.sections["services.production.rewrites"];
  assert.equal(productionService.serve, "static");
  const publicDir = join(root, productionService.publicDir);
  const [manifestSource, indexHtml] = await Promise.all([
    readFile(join(publicDir, "manifest.webmanifest"), "utf8"),
    readFile(join(publicDir, "index.html"), "utf8"),
  ]);
  validateV2WebAppInstallContract(manifestSource, indexHtml);
  const paths = await collectReferencedArtifactPaths(publicDir);
  const { server, origin } = await startStaticArtifactServer(publicDir, rewrite);
  try {
    for (const pathname of ["/", ...paths]) {
      const response = await fetch(new URL(pathname, origin));
      const body = await response.text();
      assertStaticAssetResponse(
        pathname,
        response.status,
        response.headers.get("content-type"),
        body,
      );
    }

    const nestedRoute = "/setup/profiles";
    const routeResponse = await fetch(new URL(nestedRoute, origin));
    const routeBody = await routeResponse.text();
    const appShell = await readFile(join(publicDir, "index.html"), "utf8");
    assertClientRouteResponse(
      nestedRoute,
      routeResponse.status,
      routeResponse.headers.get("content-type"),
      routeBody,
      appShell,
    );
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

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
  await validateV2StaticArtifactHttp(root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runV2ArtifactReleaseCheck();
  console.log("V2 artifact manifests, built static bundle, and static HTTP serving passed validation.");
}
