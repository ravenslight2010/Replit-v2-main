---
name: PWA update prompts
description: Safe update prompting and stale-client recovery worker lifecycle.
---

Keep Vite PWA's `registerType: "prompt"` and make all reloads user-controlled. For the one-time stale-client recovery path, Workbox workers may `skipWaiting`, but must never `clientsClaim`.

**Why:** A fully cached legacy error boundary cannot run newer React recovery code. A worker that activates without claiming lets that legacy screen's existing, user-chosen generic reload enter the fixed bundle. It must not reload or replace the open page because that page can hold a live run, form, or import.

**How to apply:** Keep the persistent reload toast even when the worker activates immediately: observe an installed update as well as `needRefresh`, then make the toast's reload button the only navigation trigger. Background registration, focus, and interval checks may discover/install/activate but must never reload. Validate the old-worker → update → generic-reload handoff in a real browser after changing this behavior.

**Stale-client recovery:** Only the exact Safari `Can't find variable: Notification` reference error gets an "Update and reload" action. It may check and activate a waiting worker after the staff member clicks, otherwise it uses an ordinary reload.

**Why:** A cached iOS bundle can still evaluate the legacy free `Notification` global even though current code safely probes `window.Notification`. Broad error matching or automatic recovery could interrupt unrelated active production work.

**How to apply:** Keep this recovery opt-in and exact-message scoped. Embed a non-empty, deployment-specific web build ID in every web incident so stale-client reports can be distinguished from a current-code regression.

**Versioned cache handoff:** Do not delete an older service-worker shell cache during activation while pages may still be controlled by that worker. A previous worker can continue handling fetches after the new worker activates; if its cache was deleted, it may recreate an empty cache and lose its offline fallback.

**Why:** Worker activation and existing-client controller handoff are separate lifecycle steps. Cache-name replacement alone does not prove that no old page still depends on the previous cache.

**How to apply:** Keep the current worker's versioned cache separate from older caches. Retire an older cache only when the old-worker client handoff is demonstrably complete; test the old page and the newly controlled page through online update, offline reload, and reconnect.