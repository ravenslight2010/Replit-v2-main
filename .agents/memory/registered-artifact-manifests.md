---
name: Registered artifact manifests
description: Safe updates to Replit's registered multi-artifact deployment manifests.
---

Registered .replit-artifact/artifact.toml files are platform-managed configuration, not ordinary text files.

**Why:** Direct patching is rejected; the platform validates registered artifacts before replacing their manifests.

**How to apply:** Read and preserve the complete manifest, write a sibling temporary TOML file, then replace it with verifyAndReplaceArtifactToml using absolute paths. Do not delete the manifest to bypass validation.
