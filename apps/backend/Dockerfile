# syntax=docker/dockerfile:1.7

# ───────────────────────────────────────────────────────────────────────
# Backend production Dockerfile.
#
# Built from the monorepo root in Railway (so the Docker context sees
# packages/shared and the workspace lockfile). The build is a single
# stage on purpose — Railway's image cache only kicks in on stable layers,
# and the @prisma/client native binaries don't survive a multi-stage copy
# without extra plumbing. Image size is not the priority here; reliability
# is.
# ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine

# Workdir lives at the monorepo root inside the image so npm workspaces
# resolve naturally.
WORKDIR /app

# OpenSSL is required by Prisma's query engine on Alpine.
RUN apk add --no-cache openssl

# Copy the workspace manifests first so Docker can cache `npm ci` between
# rebuilds when only source files change.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

# Install all workspace deps (including dev — we need TypeScript and the
# Prisma CLI to build).
RUN npm ci --include=dev

# Now bring in the actual source. This is the layer that changes most
# often, so it's last among the copies.
COPY . .

# Compile the shared package first (backend imports it as
# @coffee-bar/shared) and then the backend itself. `prisma generate` runs
# inside the backend's `build` script.
RUN npm run build --workspace=@coffee-bar/shared
RUN npm run build --workspace=@coffee-bar/backend

# Railway injects PORT at runtime; main.ts reads it.
ENV NODE_ENV=production

# Use the npm script so we keep `prisma migrate deploy` in one place.
CMD ["npm", "run", "start:prod", "--workspace=@coffee-bar/backend"]
