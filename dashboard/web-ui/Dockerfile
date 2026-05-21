# syntax=docker/dockerfile:1.7
# Stage 1: build
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Build arguments for Vite (baked in at build time)
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_MAPBOX_TOKEN
ARG VITE_DASHBOARD_URL
ARG VITE_API_URL
ARG VITE_TURNSTILE_SITE_KEY

# Make build args available as env vars during build
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
ENV VITE_DASHBOARD_URL=$VITE_DASHBOARD_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY

# Harden npm network behavior for transient registry failures.
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package files
COPY backend/package.json backend/
COPY dashboard/web-ui/package.json dashboard/web-ui/
COPY packages/react-native/package.json packages/react-native/
COPY packages/browser/package.json packages/browser/

# Install dependencies (from root). Retry the whole install because npm can
# still exit on transient registry ECONNRESETs after its internal fetch retries.
RUN --mount=type=cache,target=/root/.npm \
    for attempt in 1 2 3; do \
      npm ci --legacy-peer-deps --ignore-scripts && break; \
      status=$?; \
      if [ "$attempt" -eq 3 ]; then exit "$status"; fi; \
      echo "npm ci failed (attempt ${attempt}/3); retrying..."; \
      sleep $((attempt * 15)); \
    done

# Build the local browser SDK used by the dashboard.
COPY packages/browser/ packages/browser/
RUN npm --workspace @rejourneyco/browser run prepack

# Copy web-ui source code
COPY dashboard/web-ui/ dashboard/web-ui/

# Copy docs folder into the expected relative location
# Previous config expected docs at ./docs relative to build root
COPY docs/ dashboard/web-ui/docs/

WORKDIR /app/dashboard/web-ui
RUN npm run build

# Stage 2: production runtime (Node.js for SSR)
FROM node:24-bookworm-slim AS production
WORKDIR /app

ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Note: The Node.js base image already includes a 'node' user (UID 1000)
# We will switch to it at the end for security

# Copy root package files
COPY package.json package-lock.json ./
# Copy workspace package files
COPY backend/package.json backend/
COPY dashboard/web-ui/package.json dashboard/web-ui/
COPY packages/react-native/package.json packages/react-native/
COPY packages/browser/package.json packages/browser/

# Install production dependencies only (from root).
RUN --mount=type=cache,target=/root/.npm \
    for attempt in 1 2 3; do \
      npm ci --legacy-peer-deps --omit=dev --ignore-scripts && break; \
      status=$?; \
      if [ "$attempt" -eq 3 ]; then exit "$status"; fi; \
      echo "npm ci --omit=dev failed (attempt ${attempt}/3); retrying..."; \
      sleep $((attempt * 15)); \
    done

# Runtime installs link @rejourneyco/browser to the local workspace package.
# Carry over the compiled SDK files required by its package exports.
COPY --from=build /app/packages/browser/dist packages/browser/dist

# Copy the built application and server
COPY --from=build /app/dashboard/web-ui/build dashboard/web-ui/build
COPY --from=build /app/dashboard/web-ui/server.js dashboard/web-ui/server.js

# Copy docs folder (for SSR documentation loading)
COPY --from=build /app/dashboard/web-ui/docs dashboard/web-ui/docs

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080
ENV API_URL=http://api:3000

EXPOSE 8080

# Run the custom Express server with API proxy
WORKDIR /app/dashboard/web-ui

# Switch to non-root user
USER node

CMD ["npm", "run", "start"]
