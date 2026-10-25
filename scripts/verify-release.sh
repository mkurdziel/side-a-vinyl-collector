#!/usr/bin/env bash
# Run all release gates without changing Git tags or publishing images.
set -euo pipefail
cd "$(dirname "$0")/.."

bun scripts/vendor-dependencies.ts install backend
bun scripts/vendor-dependencies.ts install frontend
bun run --cwd backend typecheck
bun run --cwd backend test
bun run --cwd frontend test
bun run --cwd frontend build

docker build --network=none --platform=linux/amd64 -f Dockerfile.combined \
  --build-arg APP_VERSION="${APP_VERSION:-verification}" \
  -t side-a-vinyl-collector:test .

echo 'Release checks passed. The verified source can now be committed and tagged.'
