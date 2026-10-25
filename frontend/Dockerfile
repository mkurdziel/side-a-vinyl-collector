# Build from repository root: docker build -f frontend/Dockerfile .
ARG BUN_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
FROM ${BUN_IMAGE} AS build
WORKDIR /source
COPY scripts/vendor-dependencies.ts scripts/
COPY vendor/ vendor/
COPY backend/package.json backend/bun.lock backend/
COPY frontend/package.json frontend/bun.lock frontend/
RUN --network=none bun scripts/vendor-dependencies.ts install frontend
COPY frontend/ frontend/
ARG VITE_API_URL=http://localhost:5001
ARG APP_VERSION=unknown
RUN --network=none cd frontend && VITE_API_URL=${VITE_API_URL} APP_VERSION=${APP_VERSION} bun run build

FROM nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
COPY --from=build /source/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
