import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("published V2 starts its supervised API and worker on one external web port", () => {
  const config = readFileSync(resolve(repositoryRoot, ".replit"), "utf8");
  assert.match(config, /^run = \["bash", "scripts\/start-v2\.sh"\]$/m);
  assert.doesNotMatch(config, /run = \["bash", "scripts\/deny-v2-publish\.sh"\]/);
  const portBlocks = config.split(/^\[\[ports\]\]\s*$/m).slice(1)
    .map((block) => block.split(/^\[\[/m, 1)[0])
    .filter((block) => /^\s*localPort\s*=\s*5000\s*$/m.test(block));
  assert.equal(portBlocks.length, 1, "V2 should have one public-port mapping");
  assert.match(portBlocks[0], /^\s*externalPort\s*=\s*80\s*$/m);
});

test("the retired publish guard still fails closed when called directly", () => {
  const result = spawnSync("bash", [
    resolve(repositoryRoot, "scripts/deny-v2-publish.sh"),
  ], { encoding: "utf8" });

  assert.equal(result.status, 78);
  assert.match(result.stderr, /private development pilot/i);
  assert.match(result.stderr, /production database access/i);
});
