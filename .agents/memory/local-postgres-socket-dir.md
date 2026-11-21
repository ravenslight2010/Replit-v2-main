---
name: Local PostgreSQL socket directory
description: Keep temporary PostgreSQL clusters runnable in Nix-based Replit environments.
---

When starting a disposable PostgreSQL cluster in Replit, pass a private temporary directory as its Unix socket directory (for example, `pg_ctl ... -o "-h 127.0.0.1 -k $TMP_DIR"`). Keep database TCP access bound to loopback and remove the directory when the owning test or workflow stops.

**Why:** The Nix PostgreSQL build may default to `/run/postgresql`, which is not present in the workspace. The server can fail before opening its loopback TCP port even though `initdb` succeeded.

**How to apply:** For temporary clusters, create a private directory alongside the data directory, pass it with PostgreSQL's `-k` option, and use an explicit loopback host and ephemeral port. Verify the owning process removes both the data and socket directories during normal shutdown.
