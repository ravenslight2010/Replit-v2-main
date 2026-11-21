---
name: V2 browser test concurrency
description: Prevents flaky V2 browser navigation timeouts on the Replit host.
---

Run the V2 browser end-to-end suite serially on this host. Parallel Chromium and WebKit cases can starve service-worker migration navigation until `page.reload()` times out, even when that migration test passes alone.

**Why:** Adding another browser-heavy V2 scenario increased contention in Node's default test-file concurrency; the same full suite passed when serialized.

**How to apply:** Keep the V2 browser test command at `--test-concurrency=1`, preserve explicit post-reload DOM assertions, and do not mask host contention by removing the migration check.
