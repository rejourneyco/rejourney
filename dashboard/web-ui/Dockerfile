# Stage 1: build
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Build arguments for Vite (baked in at build time)
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_DASHBOARD_URL
ARG VITE_API_URL

# Make build args available as env vars during build
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_DASHBOARD_URL=$VITE_DASHBOARD_URL
ENV VITE_API_URL=$VITE_API_URL

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package files
COPY backend/package.json backend/
COPY dashboard/web-ui/package.json dashboard/web-ui/
COPY packages/react-native/package.json packages/react-native/

# Install dependencies (from root)
RUN npm ci --legacy-peer-deps --ignore-scripts

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

# Note: The Node.js base image already includes a 'node' user (UID 1000)
# We will switch to it at the end for security

# Copy root package files
COPY package.json package-lock.json ./
# Copy workspace package files
COPY backend/package.json backend/
COPY dashboard/web-ui/package.json dashboard/web-ui/
COPY packages/react-native/package.json packages/react-native/

# Install production dependencies only (from root)
RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts

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
