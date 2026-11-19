---
name: Development esbuild override placement
description: Where pnpm applies workspace-wide dependency overrides in this monorepo
---

For pnpm 11 and later, keep workspace-wide security overrides in `pnpm-workspace.yaml`, not `package.json.pnpm`. Earlier pnpm releases in this project used root manifest overrides; that guidance does not apply after the package-manager upgrade.

**Why:** The authoritative configuration location changed across package-manager versions. Following the old advice can silently leave transitive dependencies vulnerable.

**How to apply:** Check the active pnpm major and update existing pins and catalog entries when they overlap audit-generated overrides. Regenerate with the workspace's pinned pnpm, then verify the resolved versions and rerun the audit.