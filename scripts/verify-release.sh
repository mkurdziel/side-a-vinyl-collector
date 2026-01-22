#!/bin/bash

# Pre-Release Verification Script
# This script runs all necessary checks before creating a release tag

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Pre-Release Verification Script${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Check if working directory is clean
echo -e "${YELLOW}[1/5] Checking git status...${NC}"
if [[ -n $(git status -s) ]]; then
    echo -e "${RED}✗ Working directory is not clean. Please commit or stash changes.${NC}"
    git status -s
    exit 1
fi
echo -e "${GREEN}✓ Working directory is clean${NC}"
echo ""

# Run backend tests
echo -e "${YELLOW}[2/5] Running backend tests...${NC}"
cd backend
if ! bun install; then
    echo -e "${RED}✗ Backend dependency installation failed${NC}"
    exit 1
fi
if ! bun run test; then
    echo -e "${RED}✗ Backend tests failed${NC}"
    exit 1
fi
cd ..
echo -e "${GREEN}✓ Backend tests passed${NC}"
echo ""

# Build frontend
echo -e "${YELLOW}[3/5] Building frontend...${NC}"
cd frontend
if ! npm install; then
    echo -e "${RED}✗ Frontend dependency installation failed${NC}"
    exit 1
fi
if ! npm run build; then
    echo -e "${RED}✗ Frontend build failed${NC}"
    exit 1
fi
cd ..
echo -e "${GREEN}✓ Frontend build successful${NC}"
echo ""

# Build Docker image
echo -e "${YELLOW}[4/5] Building Docker image...${NC}"
if ! docker build -f Dockerfile.combined -t side-a-vinyl-collector:test .; then
    echo -e "${RED}✗ Docker build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker image built successfully${NC}"
echo ""

# Get current version from git tags
echo -e "${YELLOW}[5/5] Checking current version...${NC}"
CURRENT_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo -e "Current version: ${GREEN}${CURRENT_VERSION}${NC}"
echo ""

# All checks passed
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ All verification checks passed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Prompt for tag creation
echo -e "${YELLOW}Ready to create a release tag.${NC}"
echo -e "Current version: ${CURRENT_VERSION}"
echo ""
read -p "Enter new version tag (e.g., v0.3.1) or press Enter to skip: " NEW_VERSION

if [[ -z "$NEW_VERSION" ]]; then
    echo -e "${YELLOW}Skipping tag creation.${NC}"
    exit 0
fi

# Validate version format
if [[ ! "$NEW_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}✗ Invalid version format. Use format: vX.Y.Z${NC}"
    exit 1
fi

# Create and push tag
echo -e "${YELLOW}Creating tag ${NEW_VERSION}...${NC}"
if ! git tag "$NEW_VERSION"; then
    echo -e "${RED}✗ Failed to create tag. Does it already exist?${NC}"
    exit 1
fi

echo -e "${YELLOW}Pushing tag to origin...${NC}"
if ! git push origin "$NEW_VERSION"; then
    echo -e "${RED}✗ Failed to push tag${NC}"
    echo -e "${YELLOW}Deleting local tag...${NC}"
    git tag -d "$NEW_VERSION"
    exit 1
fi

echo -e "${GREEN}✓ Tag ${NEW_VERSION} created and pushed successfully!${NC}"
echo -e "${YELLOW}Monitor the release at: https://github.com/mkurdziel/side-a-vinyl-collector/actions${NC}"
