#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalogDefault = "docs/capabilities/catalog.json";
const summaryDefault = "docs/capabilities/summary.md";
const decisionStates = new Set(["approved", "candidate", "deferred", "out-of-scope", "retired"]);
const releaseScopes = new Set(["current", "future", "none"]);
const implementationStates = new Set(["not-started", "in-progress", "implemented", "blocked"]);
const historicalStates = new Set(["evidenced", "partially-evidenced", "unknown", "not-applicable"]);
const evidenceOutcomes = new Set(["PASS", "FAIL", "BLOCKED", "NOT RUN"]);
const idPattern = /^CAP-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const checkIdPattern = /^[a-z][a-z0-9-]*$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;

function requireKeys(value, required, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object.`);
    return false;
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`${label} is missing required field "${key}".`);
  }
  return true;
}

function validateLocalReference(referenceId, references, rootPath, label, errors) {
  if (!hasText(referenceId) || !Object.hasOwn(references, referenceId)) {
    errors.push(`${label} references unknown local source "${referenceId}".`);
    return false;
  }
  const reference = references[referenceId];
  if (!hasText(reference.path)) {
    errors.push(`Reference "${referenceId}" must have a repository-relative path.`);
    return false;
  }
  if (path.isAbsolute(reference.path)) {
    errors.push(`Reference "${referenceId}" path must be repository-relative.`);
    return false;
  }
  const absolutePath = path.resolve(rootPath, reference.path);
  const relativePath = path.relative(rootPath, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    errors.push(`Reference "${referenceId}" escapes the repository root.`);
    return false;
  }
  try {
    const actualPath = fs.realpathSync(absolutePath);
    const actualRelative = path.relative(fs.realpathSync(rootPath), actualPath);
    if (actualRelative === ".." || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) {
      errors.push(`Reference "${referenceId}" resolves outside the repository root.`);
      return false;
    }
    if (!fs.statSync(actualPath).isFile()) {
      errors.push(`Reference "${referenceId}" does not point to a file: ${reference.path}`);
      return false;
    }
  } catch {
    errors.push(`Reference "${referenceId}" points to a missing local file: ${reference.path}`);
    return false;
  }
  return true;
}

export function validateCatalog(catalog, rootPath = workspaceRoot) {
  const errors = [];
  if (!requireKeys(catalog, ["schemaVersion", "title", "evidenceBoundary", "references", "capabilities"], "Catalog", errors)) {
    return errors;
  }
  if (catalog.schemaVersion !== 1) errors.push('Catalog "schemaVersion" must be 1.');
  if (!hasText(catalog.title)) errors.push('Catalog "title" must be a non-empty string.');
  if (!hasText(catalog.evidenceBoundary)) errors.push('Catalog "evidenceBoundary" must be a non-empty string.');
  if (!isObject(catalog.references)) {
    errors.push('Catalog "references" must be an object.');
    return errors;
  }
  const references = catalog.references;
  for (const [referenceId, reference] of Object.entries(references)) {
    if (!/^[a-z][a-z0-9-]*$/.test(referenceId)) errors.push(`Invalid local reference ID "${referenceId}".`);
    if (!requireKeys(reference, ["path", "kind", "note"], `Reference "${referenceId}"`, errors)) continue;
    if (!hasText(reference.kind)) errors.push(`Reference "${referenceId}" has an empty kind.`);
    if (!hasText(reference.note)) errors.push(`Reference "${referenceId}" has an empty note.`);
    validateLocalReference(referenceId, references, rootPath, `Reference "${referenceId}"`, errors);
  }
  if (!Array.isArray(catalog.capabilities)) {
    errors.push('Catalog "capabilities" must be an array.');
    return errors;
  }

  const seenIds = new Set();
  const records = new Map();
  for (const [index, capability] of catalog.capabilities.entries()) {
    const label = `Capability at index ${index}`;
    if (!requireKeys(
      capability,
      ["id", "name", "category", "purpose", "workflow", "decision", "implementation", "sourceEvidence", "dependencies", "acceptanceChecks", "verificationEvidence"],
      label,
      errors,
    )) continue;

    if (!hasText(capability.id) || !idPattern.test(capability.id)) {
      errors.push(`${label} has invalid stable ID "${capability.id}".`);
    } else if (seenIds.has(capability.id)) {
      errors.push(`Duplicate capability ID "${capability.id}".`);
    } else {
      seenIds.add(capability.id);
      records.set(capability.id, capability);
    }
    for (const field of ["name", "category", "purpose"]) {
      if (!hasText(capability[field])) errors.push(`${label} "${capability.id}" has an empty "${field}".`);
    }
    if (requireKeys(capability.workflow, ["name", "roles"], `${label} "${capability.id}" workflow`, errors)) {
      if (!hasText(capability.workflow.name)) errors.push(`${label} "${capability.id}" workflow name must be non-empty.`);
      if (!Array.isArray(capability.workflow.roles) || capability.workflow.roles.length === 0 ||
          capability.workflow.roles.some((role) => !hasText(role))) {
        errors.push(`${label} "${capability.id}" workflow roles must be a non-empty array of strings.`);
      }
    }
    if (requireKeys(capability.decision, ["state", "releaseScope", "rationale", "approvedBehavior", "unresolvedOwnerDecisions"], `${label} "${capability.id}" decision`, errors)) {
      if (!decisionStates.has(capability.decision.state)) errors.push(`${label} "${capability.id}" has invalid decision state.`);
      if (!releaseScopes.has(capability.decision.releaseScope)) errors.push(`${label} "${capability.id}" has invalid release scope.`);
      if (!hasText(capability.decision.rationale)) errors.push(`${label} "${capability.id}" decision rationale must be non-empty.`);
      for (const field of ["approvedBehavior", "unresolvedOwnerDecisions"]) {
        if (!Array.isArray(capability.decision[field]) || capability.decision[field].some((item) => !hasText(item))) {
          errors.push(`${label} "${capability.id}" decision "${field}" must be an array of non-empty strings.`);
        }
      }
      if (capability.decision.state === "candidate" &&
          Array.isArray(capability.decision.approvedBehavior) &&
          capability.decision.approvedBehavior.length > 0) {
        errors.push(`${label} "${capability.id}" is a candidate and cannot claim approved behavior.`);
      }
    }
    if (requireKeys(capability.implementation, ["status", "historicalV1", "detail"], `${label} "${capability.id}" implementation`, errors)) {
      if (!implementationStates.has(capability.implementation.status)) errors.push(`${label} "${capability.id}" has invalid implementation status.`);
      if (!historicalStates.has(capability.implementation.historicalV1)) errors.push(`${label} "${capability.id}" has invalid historical V1 evidence state.`);
      if (!hasText(capability.implementation.detail)) errors.push(`${label} "${capability.id}" implementation detail must be non-empty.`);
    }

    if (!Array.isArray(capability.sourceEvidence) || capability.sourceEvidence.length === 0) {
      errors.push(`${label} "${capability.id}" must include at least one source evidence reference.`);
    } else {
      for (const [evidenceIndex, evidence] of capability.sourceEvidence.entries()) {
        const evidenceLabel = `${label} "${capability.id}" sourceEvidence[${evidenceIndex}]`;
        if (!requireKeys(evidence, ["reference", "claim"], evidenceLabel, errors)) continue;
        if (!hasText(evidence.claim)) errors.push(`${evidenceLabel} claim must be non-empty.`);
        validateLocalReference(evidence.reference, references, rootPath, evidenceLabel, errors);
      }
    }
    if (!Array.isArray(capability.dependencies) || capability.dependencies.some((dependency) => !hasText(dependency))) {
      errors.push(`${label} "${capability.id}" dependencies must be an array of capability IDs.`);
    }
    if (!Array.isArray(capability.acceptanceChecks)) {
      errors.push(`${label} "${capability.id}" acceptanceChecks must be an array.`);
    } else {
      const localCheckIds = new Set();
      for (const [checkIndex, check] of capability.acceptanceChecks.entries()) {
        const checkLabel = `${label} "${capability.id}" acceptanceChecks[${checkIndex}]`;
        if (!requireKeys(check, ["id", "criterion"], checkLabel, errors)) continue;
        if (!hasText(check.id) || !checkIdPattern.test(check.id)) errors.push(`${checkLabel} has invalid check ID.`);
        else if (localCheckIds.has(check.id)) errors.push(`${label} "${capability.id}" has duplicate acceptance check ID "${check.id}".`);
        else localCheckIds.add(check.id);
        if (!hasText(check.criterion)) errors.push(`${checkLabel} criterion must be non-empty.`);
      }
      if ((capability.decision?.state === "approved" || capability.decision?.releaseScope === "current") &&
          capability.acceptanceChecks.length === 0) {
        errors.push(`${label} "${capability.id}" is approved/current-scope and must define acceptance checks.`);
      }
    }
    if (!Array.isArray(capability.verificationEvidence)) {
      errors.push(`${label} "${capability.id}" verificationEvidence must be an array.`);
    } else {
      const evidenceChecks = new Set();
      for (const [evidenceIndex, evidence] of capability.verificationEvidence.entries()) {
        const evidenceLabel = `${label} "${capability.id}" verificationEvidence[${evidenceIndex}]`;
        if (!requireKeys(evidence, ["checkId", "reference", "outcome", "detail"], evidenceLabel, errors)) continue;
        if (!hasText(evidence.checkId) || !capability.acceptanceChecks?.some((check) => check?.id === evidence.checkId)) {
          errors.push(`${evidenceLabel} must reference an acceptance check on the same capability.`);
        }
        if (!evidenceOutcomes.has(evidence.outcome)) errors.push(`${evidenceLabel} has invalid evidence outcome "${evidence.outcome}".`);
        if (!hasText(evidence.detail)) errors.push(`${evidenceLabel} detail must be non-empty.`);
        if (hasText(evidence.checkId)) evidenceChecks.add(evidence.checkId);
        validateLocalReference(evidence.reference, references, rootPath, evidenceLabel, errors);
      }
      if (capability.implementation?.status === "implemented") {
        if (capability.acceptanceChecks?.length === 0) {
          errors.push(`${label} "${capability.id}" is implemented but has no acceptance checks.`);
        }
        for (const check of capability.acceptanceChecks ?? []) {
          if (!evidenceChecks.has(check.id)) {
            errors.push(`${label} "${capability.id}" is implemented but acceptance check "${check.id}" has no verification outcome.`);
          }
        }
      }
    }
  }

  for (const capability of catalog.capabilities) {
    for (const dependency of capability?.dependencies ?? []) {
      if (hasText(dependency) && !records.has(dependency)) {
        errors.push(`Capability "${capability.id}" depends on unknown capability "${dependency}".`);
      }
    }
    for (const evidence of capability?.sourceEvidence ?? []) {
      validateLocalReference(evidence?.reference, references, rootPath, `Capability "${capability.id}"`, errors);
    }
  }
  return [...new Set(errors)];
}

export function renderSummary(catalog) {
  const capabilities = [...catalog.capabilities].sort((a, b) => a.id.localeCompare(b.id));
  const decisions = new Map();
  const implementations = new Map();
  for (const capability of capabilities) {
    decisions.set(capability.decision.state, (decisions.get(capability.decision.state) ?? 0) + 1);
    implementations.set(capability.implementation.status, (implementations.get(capability.implementation.status) ?? 0) + 1);
  }
  const counts = (map, names) => names.map((name) => `${name}: ${map.get(name) ?? 0}`).join(" · ");
  const lines = [
    `# ${catalog.title}`,
    "",
    `> Generated from [catalog.json](catalog.json). Do not edit this summary by hand.`,
    "",
    catalog.evidenceBoundary,
    "",
    `**Capabilities:** ${capabilities.length}`,
    `**Decision states:** ${counts(decisions, ["approved", "candidate", "deferred", "out-of-scope", "retired"])}`,
    `**Implementation states:** ${counts(implementations, ["implemented", "in-progress", "not-started", "blocked"])}`,
    "",
    "## Capability inventory",
    "",
    "| Stable ID | Capability | Workflow / roles | Decision | Release | Implementation | Depends on | Evidence |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const capability of capabilities) {
    const evidenceLinks = [...new Set(capability.sourceEvidence.map((entry) => entry.reference))]
      .map((id) => {
        const reference = catalog.references[id];
        return `[${id}](${reference.path})`;
      })
      .join(", ");
    lines.push(
      `| \`${capability.id}\` | ${capability.name} | ${capability.workflow.name} (${capability.workflow.roles.join(", ")}) | ${capability.decision.state} | ${capability.decision.releaseScope} | ${capability.implementation.status} | ${capability.dependencies.length ? capability.dependencies.map((id) => `\`${id}\``).join(", ") : "—"} | ${evidenceLinks} |`,
    );
  }
  lines.push("", "## Review notes", "");
  for (const capability of capabilities) {
    const approved = capability.decision.approvedBehavior.length
      ? capability.decision.approvedBehavior.join(" ")
      : "No behavior is approved; this record is not a requirement.";
    const unresolved = capability.decision.unresolvedOwnerDecisions.length
      ? capability.decision.unresolvedOwnerDecisions.join(" ")
      : "No owner decision is currently listed.";
    lines.push(`### \`${capability.id}\` — ${capability.name}`, "");
    lines.push(`- **Purpose:** ${capability.purpose}`);
    lines.push(`- **Approved behavior:** ${approved}`);
    lines.push(`- **Unresolved owner decisions:** ${unresolved}`);
    lines.push(`- **Implementation note:** ${capability.implementation.detail}`);
    if (capability.acceptanceChecks.length) {
      lines.push("- **Acceptance checks:**");
      for (const check of capability.acceptanceChecks) {
        const evidence = capability.verificationEvidence.filter((entry) => entry.checkId === check.id);
        const outcome = evidence.length ? evidence.map((entry) => `${entry.outcome} (${entry.reference})`).join("; ") : "no result recorded";
        lines.push(`  - \`${check.id}\`: ${check.criterion} — **${outcome}**`);
      }
    }
    lines.push("");
  }
  lines.push(
    "## Reading this inventory",
    "",
    "Decision authority, release scope, implementation delivery, and evidence outcomes are separate. The structural check validates the catalog format and references only; it does not certify evidence quality, product policy, or release readiness.",
    "",
  );
  return `${lines.join("\n")}`;
}

export function validateCatalogFiles({ catalogPath, summaryPath, rootPath = workspaceRoot }) {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (error) {
    return { catalog: null, errors: [`Could not read valid JSON from ${catalogPath}: ${error.message}`] };
  }
  const errors = validateCatalog(catalog, rootPath);
  let currentSummary = "";
  try {
    currentSummary = fs.readFileSync(summaryPath, "utf8");
  } catch {
    errors.push(`Generated summary is missing: ${path.relative(rootPath, summaryPath)}`);
  }
  if (currentSummary && currentSummary !== renderSummary(catalog)) {
    errors.push(`Generated summary is stale: ${path.relative(rootPath, summaryPath)}. Run pnpm run generate:capability-catalog.`);
  }
  return { catalog, errors: [...new Set(errors)] };
}

function parseArgs(args) {
  const options = { write: false, catalogPath: path.join(workspaceRoot, catalogDefault), summaryPath: path.join(workspaceRoot, summaryDefault) };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--write") options.write = true;
    else if (arg === "--catalog") options.catalogPath = path.resolve(args[++index] ?? "");
    else if (arg === "--summary") options.summaryPath = path.resolve(args[++index] ?? "");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(options.catalogPath, "utf8"));
  } catch (error) {
    console.error(`Could not read valid catalog JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const errors = validateCatalog(catalog, workspaceRoot);
  if (errors.length > 0) {
    console.error("Capability catalog validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const summary = renderSummary(catalog);
  if (options.write) {
    fs.mkdirSync(path.dirname(options.summaryPath), { recursive: true });
    fs.writeFileSync(options.summaryPath, summary);
    console.log(`Generated ${path.relative(workspaceRoot, options.summaryPath)} from ${path.relative(workspaceRoot, options.catalogPath)}.`);
    return;
  }
  let currentSummary;
  try {
    currentSummary = fs.readFileSync(options.summaryPath, "utf8");
  } catch {
    currentSummary = "";
  }
  if (currentSummary !== summary) {
    console.error(`Generated summary is missing or stale: ${path.relative(workspaceRoot, options.summaryPath)}. Run pnpm run generate:capability-catalog.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Capability catalog valid: ${catalog.capabilities.length} records, ${Object.keys(catalog.references).length} local sources.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
