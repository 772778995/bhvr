# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY tsconfig.json ./

# Install all deps (including devDeps needed for build)
RUN npm ci --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

# Build shared + client + server
RUN npm run build --workspace=shared && \
    npm run build --workspace=client && \
    npm run build --workspace=server

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.52.0-noble AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace manifests and install production deps only
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install all deps first (including playwright in server/dependencies)
RUN npm ci --ignore-scripts

# Prune dev-only deps (playwright stays because it's in server/dependencies)
RUN npm prune --omit=dev --ignore-scripts

# Copy compiled output
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist

# Copy compiled client (served as static files by the server)
COPY --from=builder /app/client/dist ./client/dist

# Data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3450

CMD ["node", "server/dist/index.js"]
