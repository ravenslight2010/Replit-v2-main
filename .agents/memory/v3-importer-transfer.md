---
name: V1 importer knowledge carried into V3
description: Where to find the source-pinned V1 importer lessons and how they relate to V3's deterministic import design.
---

# V1 importer knowledge carried into V3

The detailed V1 importer guide, V3 import skill, and test map belong in the
`agents/` directory of
[`Production-assistant-v3`](https://github.com/ravenslight2010/Production-assistant-v3/tree/main/agents).
The V3 repository is the portable reference for agents working on that version;
the curated transfer is in review before it becomes the main-branch reference.

## Authority and scope

- V3's `research/source-index.md` pins the V1 and Replit V2 source revisions.
- V3's approved `research/decisions/import-completion-design.md`, current
  source, and tests define V3 behavior. Historical V1 guidance does not
  authorize restoring V1 runtime behavior.
- V3's importers are deterministic and do not use AI. Keep that project
  boundary even where V1 used AI-assisted parsing or name matching.
- Private source workbooks, manifests, parser expectations, production rows,
  and credentials stay outside source control.

The current workspace already holds detailed V1 import history in
`.agents/memory/` and the `import-bug-investigation` /
`spec-import-guard` skills. Keep those intact; use the V3 guide to translate
their lessons rather than copying old file paths or assuming V1 apply behavior
is still authoritative.

**Why:** V1 importer behavior was built up through many real-workbook
corrections. V3 needs those lessons, but its approved deterministic review,
source-version, and explicit-Apply design intentionally changes parts of the
old workflow.

**How to apply:** For V3 import work, read the V3 `agents/AGENTS.md`, importer
lesson guide, and test map first. Then verify the current source/test paths and
separate historical V1 behavior from V3's live contract.
