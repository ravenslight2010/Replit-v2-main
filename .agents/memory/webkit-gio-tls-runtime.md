---
name: WebKit GIO TLS runtime
description: WebKit can launch successfully in the bundled WPE runtime while still lacking a registered GIO TLS backend.
---

In the Replit Nix workspace, Playwright's bundled WPE WebKit needs the
`glib-networking` GIO modules exposed through `GIO_EXTRA_MODULES` for HTTPS.
Without them, a direct HTTPS navigation fails with “TLS support is not
available” even though the browser launches and local HTTP tests pass.

**Why:** WebKit delegates TLS to GIO's registered backend. The browser bundle
does not include the GnuTLS backend module, and the Nix host can provide the
matching module without disabling certificate verification.

**How to apply:** When using the Replit Nix WebKit wrapper, load the matching
`nixpkgs#glib-networking` module directory. Keep normal trust validation
enabled and verify with a direct public HTTPS navigation; do not treat local
HTTP replay as evidence of HTTPS transport.

The downloaded Playwright WebKit binary may still fail before launch when host
libraries such as `libatomic`, `libstdc++`, `libGLESv2`, or `libx264` are absent.
Skipping Playwright's host check does not supply those libraries, and an older
GCC library directory can be ABI-incompatible with the Node runtime.

**Why:** The browser archive and the host's dynamic libraries are separate
requirements; a successful browser download is not proof that the engine runs.

**How to apply:** Treat a missing shared-library error as an environment-blocked
WebKit lane. Use supported system dependencies or a compatible runner; do not
change application logic or disable validation to hide the missing runtime.
