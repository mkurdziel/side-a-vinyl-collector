# Vendored npm dependencies

`npm/*.tgz` contains original, unmodified npm registry tarballs for the exact backend and frontend Bun lock closures. A tarball shared by both applications is stored once. The supported installation targets are Linux x64/arm64 (glibc) and macOS x64/arm64. Windows, FreeBSD, Android, and other unsupported optional platform packages remain recorded in the original locks but are not included here.

`manifest.json` records the source HTTPS URL, package/version, upstream lockfile SHA512 integrity, applicable OS/CPU, consuming application, and package-declared license. Original license and copyright notices are retained inside each tarball. Consult those notices for complete license terms; the declared license field is an inventory, not a replacement for them.

Use **Bun 1.4.4** and a system `tar` command. Dockerfiles pin the Bun build image and the Debian 13 distroless C++ runtime by multi-platform digest. The patched Bun binary is copied into the runtime with its required C/C++ libraries supplied by distroless. The complete distroless package metadata remains available for vulnerability scanning; operating system libraries are not copied individually from the build image. The image retains UID 0 for compatibility with the existing cover-art volume. A Bun launcher runs migrations in a child process and starts the server only after they succeed; no shell is needed.

The Bun version pin also fixes Bun's cache directory layout, used only in a fresh temporary cache. The existing gensync prerelease uses its recorded Bun cache key; new prerelease versions require reviewing that key and repeating the empty-cache checks. Installs verify every original tarball against upstream lock integrity, extract only applicable packages, use `--offline --frozen-lockfile --ignore-scripts`, and delete the temporary cache afterward. The global package cache is never consulted or modified. Compilers and test tools are excluded from the production backend installation.

From the repository root:

```sh
bun scripts/vendor-dependencies.ts verify
bun scripts/vendor-dependencies.ts install backend
bun scripts/vendor-dependencies.ts install frontend
# Runtime dependencies only:
bun scripts/vendor-dependencies.ts install backend --production
```

Remove an application's `node_modules` first to exercise an empty installation. No network, registry credentials, or pre-existing Bun cache is needed. Missing files, changed manifests/locks, modified tarballs, and non-matching runtimes fail rather than silently downloading replacements. Do not run plain `bun install` for reproducible offline release work.

After intentionally changing dependencies with Bun 1.4.4, regenerate and review all resulting changes:

```sh
bun install --cwd backend
bun install --cwd frontend
bun scripts/vendor-dependencies.ts refresh
bun scripts/vendor-dependencies.ts verify
```

`refresh` is the only vendoring command that uses the network. It downloads directly from the registry URLs implied by the locks, validates SHA512 before writing, indexes the package license, and removes obsolete assets. It never resolves newer versions itself. Registry sources other than npm require an explicit implementation review. No binary may exceed GitHub's 100 MiB file limit.

Build with the repository root as context, including for standalone applications:

```sh
docker build --network=none --platform=linux/amd64 -f Dockerfile.combined -t side-a-vinyl-collector:local .
docker build --network=none -f backend/Dockerfile -t side-a-backend:local .
docker build --network=none -f frontend/Dockerfile -t side-a-frontend:local .
```

All Docker `RUN` stages explicitly disable the network. Docker may still fetch pinned base images; vendoring does not include the operating system, Bun binary, browser APIs, or external services used by the running application. Sharp uses its supplied native binary and libvips; HEIC conversion uses the `heic-convert` JavaScript/WASM stack, so no system libvips/libheif installation is required.
