# Build from repository root: docker build -f backend/Dockerfile .
ARG BUN_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian13@sha256:d74d144baa124dd9defd01d71872bb56c49d4441dba6153ccf790364f97e64b1
FROM ${BUN_IMAGE} AS dependencies
WORKDIR /source
COPY scripts/vendor-dependencies.ts scripts/
COPY vendor/ vendor/
COPY backend/package.json backend/bun.lock backend/
COPY frontend/package.json frontend/bun.lock frontend/
RUN --network=none bun scripts/vendor-dependencies.ts install backend --production

FROM ${RUNTIME_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=5001 PATH=/usr/local/bin:/usr/bin:/bin
USER 0
COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun
COPY --from=dependencies /source/backend/node_modules ./node_modules
COPY backend/package.json backend/bun.lock ./
COPY backend/src ./src
RUN --network=none ["/usr/local/bin/bun", "-e", "require(\"node:fs\").mkdirSync(\"/app/data/cover-art\",{recursive:true});"]
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/bun", "-e", "const response = await fetch(\"http://localhost:5001/health\"); if (!response.ok) process.exit(1);"]
ENTRYPOINT ["/usr/local/bin/bun"]
CMD ["src/start.ts"]
