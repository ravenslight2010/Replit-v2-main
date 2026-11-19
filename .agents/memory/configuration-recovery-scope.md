---
name: Configuration recovery scope
description: Recheck the main workspace after recovering environment configuration; do not assume task-only isolation.
---

Do not assume the configuration-recovery button changes only the task shown in
the error panel. Recheck the current workspace's Git history and configuration
before continuing.

**Why:** During V2 recovery, configuration recovery restored the old V1 test
workflow list and removed system dependencies from the current workspace while
leaving the recovered application source intact.

**How to apply:** Preserve the recovery commits and application source. Reapply
only the verified startup configuration through the supported configuration
tool, then restore required system packages through the package tool. The
installer can store packages inline under `[nix]` rather than creating a
separate Nix file; a missing `replit.nix` alone is not proof of a broken
environment. Validate the resulting configuration and running service before
suggesting another recovery.
