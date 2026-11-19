import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { renderSummary, validateCatalog, validateCatalogFiles } from "./capability-catalog.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capability-catalog-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "evidence.md"), "# Evidence\n");
  const catalog = {
    schemaVersion: 1,
    title: "Fixture Catalog",
    evidenceBoundary: "Only fixture evidence is represented.",
    references: {
      evidence: { path: "docs/evidence.md", kind: "test", note: "Fixture source." },
    },
    capabilities: [
      {
        id: "CAP-FIXTURE-IMPLEMENTED",
        name: "Implemented workflow",
        category: "Operations",
        purpose: "A user can complete a tested workflow.",
        workflow: { name: "Complete a workflow", roles: ["operator"] },
        decision: {
          state: "approved",
          releaseScope: "current",
          rationale: "Approved in the fixture.",
          approvedBehavior: ["The workflow is available."],
          unresolvedOwnerDecisions: [],
        },
        implementation: { status: "implemented", historicalV1: "unknown", detail: "Fixture behavior is implemented." },
        sourceEvidence: [{ reference: "evidence", claim: "Evidence file describes the fixture." }],
        dependencies: [],
        acceptanceChecks: [{ id: "visible-result", criterion: "The user sees a confirmed result." }],
        verificationEvidence: [{ checkId: "visible-result", reference: "evidence", outcome: "PASS", detail: "The fixture check passed." }],
      },
      {
        id: "CAP-FIXTURE-CANDIDATE",
        name: "Future candidate",
        category: "Future",
        purpose: "An idea is recorded for later owner review.",
        workflow: { name: "Explore a possible workflow", roles: ["manager"] },
        decision: {
          state: "candidate",
          releaseScope: "none",
          rationale: "This is not an approved requirement.",
          approvedBehavior: [],
          unresolvedOwnerDecisions: ["Decide whether the user need is real."],
        },
        implementation: { status: "not-started", historicalV1: "unknown", detail: "No implementation is started." },
        sourceEvidence: [{ reference: "evidence", claim: "The idea is recorded in the fixture." }],
        dependencies: ["CAP-FIXTURE-IMPLEMENTED"],
        acceptanceChecks: [],
        verificationEvidence: [],
      },
      {
        id: "CAP-FIXTURE-UNFINISHED",
        name: "Unfinished approved workflow",
        category: "Operations",
        purpose: "An approved workflow is under development.",
        workflow: { name: "Start an unfinished workflow", roles: ["operator"] },
        decision: {
          state: "approved",
          releaseScope: "current",
          rationale: "Approved in the fixture.",
          approvedBehavior: ["The workflow is required."],
          unresolvedOwnerDecisions: [],
        },
        implementation: { status: "in-progress", historicalV1: "partially-evidenced", detail: "Implementation is underway." },
        sourceEvidence: [{ reference: "evidence", claim: "The approved workflow is documented." }],
        dependencies: [],
        acceptanceChecks: [{ id: "unfinished-result", criterion: "The user can complete the workflow." }],
        verificationEvidence: [],
      },
    ],
  };
  return { root, catalog };
}

test("allows implemented, unfinished, and candidate records with appropriate evidence", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(validateCatalog(catalog, root), []);
  assert.match(renderSummary(catalog), /CAP-FIXTURE-CANDIDATE/);
});

test("rejects duplicate capability IDs", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  catalog.capabilities.push(structuredClone(catalog.capabilities[0]));
  assert.ok(validateCatalog(catalog, root).some((error) => error.includes("Duplicate capability ID")));
});

test("rejects missing required fields and invalid states", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  delete catalog.capabilities[0].purpose;
  catalog.capabilities[1].decision.state = "maybe";
  const errors = validateCatalog(catalog, root);
  assert.ok(errors.some((error) => error.includes('missing required field "purpose"')));
  assert.ok(errors.some((error) => error.includes("invalid decision state")));
});

test("rejects broken local references and unknown dependencies", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  catalog.references.evidence.path = "docs/missing.md";
  catalog.capabilities[1].dependencies.push("CAP-DOES-NOT-EXIST");
  const errors = validateCatalog(catalog, root);
  assert.ok(errors.some((error) => error.includes("missing local file")));
  assert.ok(errors.some((error) => error.includes("depends on unknown capability")));
});

test("requires approved/current acceptance checks and implemented outcomes", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  catalog.capabilities[0].verificationEvidence[0].outcome = "MAYBE";
  assert.ok(validateCatalog(catalog, root).some((error) => error.includes('invalid evidence outcome "MAYBE"')));
  catalog.capabilities[0].verificationEvidence = [];
  assert.ok(validateCatalog(catalog, root).some((error) => error.includes('acceptance check "visible-result" has no verification outcome')));
  catalog.capabilities[2].acceptanceChecks = [];
  assert.ok(validateCatalog(catalog, root).some((error) => error.includes('must define acceptance checks')));
});

test("reports a stale generated summary", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const catalogPath = path.join(root, "catalog.json");
  const summaryPath = path.join(root, "summary.md");
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  fs.writeFileSync(summaryPath, "out of date\n");
  const result = validateCatalogFiles({ catalogPath, summaryPath, rootPath: root });
  assert.ok(result.errors.some((error) => error.includes("Generated summary is stale")));
  fs.writeFileSync(summaryPath, renderSummary(catalog));
  assert.deepEqual(validateCatalogFiles({ catalogPath, summaryPath, rootPath: root }).errors, []);
});

test("rejects candidate records that claim approved behavior", (t) => {
  const { root, catalog } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  catalog.capabilities[1].decision.approvedBehavior = ["This is approved."];
  assert.ok(validateCatalog(catalog, root).some((error) => error.includes("cannot claim approved behavior")));
});
