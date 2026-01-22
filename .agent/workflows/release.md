---
description: Pre-release verification and tagging workflow
---

# Pre-Release Verification Workflow

This workflow ensures all builds, tests, and Docker images are verified before creating and pushing a release tag.

## Prerequisites

- Clean working directory (all changes committed)
- All dependencies installed (`npm install` in both frontend and backend)
- Docker daemon running

## Steps

### 1. Verify Working Directory is Clean

```bash
git status
```

Ensure there are no uncommitted changes. If there are changes, commit or stash them first.

### 2. Run Backend Build and Tests

```bash
cd backend
bun install
bun run test
cd ..
```

Verify all backend tests pass.

### 3. Run Frontend Build

```bash
cd frontend
npm install
npm run build
cd ..
```

Verify the frontend builds without errors.

### 4. Build Combined Docker Image

// turbo
```bash
docker build -f Dockerfile.combined -t side-a-vinyl-collector:test .
```

Verify the Docker image builds successfully.

### 5. Create and Push Tag

Once all verification steps pass, create and push the release tag:

```bash
# Replace X.Y.Z with your version number
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 6. Verify Release Workflow

Monitor the GitHub Actions release workflow:

```bash
# Open in browser
open https://github.com/mkurdziel/side-a-vinyl-collector/actions
```

## Automated Script

For convenience, use the `scripts/verify-release.sh` script which automates steps 2-4:

// turbo
```bash
./scripts/verify-release.sh
```

If all checks pass, the script will prompt you to create a tag.

## Troubleshooting

- **Backend tests fail**: Review test output and fix failing tests before proceeding
- **Frontend build fails**: Check TypeScript errors and fix them
- **Docker build fails**: Review Dockerfile and ensure all dependencies are available
- **Tag already exists**: Delete the tag locally and remotely, then recreate:
  ```bash
  git tag -d vX.Y.Z
  git push origin :refs/tags/vX.Y.Z
  ```
