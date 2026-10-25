---
description: Verify, publish, and deploy a release
---

# Release workflow

Use the checked-in Bun locks and Node.js 22.12 or newer for Vitest and TypeScript.
Keep Docker running for the disposable PostgreSQL/Redis integration tests and
combined image build. Tests must never use production credentials or data.

1. Install frontend and backend with frozen locks, run backend typechecking,
   backend unit/integration tests, frontend tests and the production frontend
   build, then build the combined image:
   ```bash
   ./scripts/verify-release.sh
   ```
2. Review `git diff --check` and the full source diff. Commit verified changes.
3. Choose an unused semantic version, create its `vX.Y.Z` tag and push the source
   commit and tag. Do not replace an existing published tag.
4. Monitor the GitHub Actions Release workflow until it succeeds. It publishes
   the combined image to `ghcr.io/mkurdziel/side-a-vinyl-collector`.
5. Verify the published image's source revision and digest. Update the pinned
   version and immutable digest in the Rainhome GitOps repository, render and
   preview its complete manifests, then commit and push the deployment change.
6. Reconcile `Kustomization/homelab` with its source and `vinyl-app`. Verify
   readiness, dependency health, album preservation and application logs.

The verification script does not publish, tag, or silently skip tests. Any failed
release gate must be resolved before publishing. Rollback uses the previous
credential-capable image pin through GitOps; preserve storage and database data.
