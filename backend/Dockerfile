# Stage 1: Build
FROM node:24-bookworm AS build

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package files (required for npm ci)
COPY backend/package.json backend/
COPY dashboard/web-ui/package.json dashboard/web-ui/
COPY packages/react-native/package.json packages/react-native/
# Install all dependencies (from root)
RUN npm ci --ignore-scripts

# Copy backend source
COPY backend/ backend/

# Build backend
WORKDIR /app/backend
RUN npm run build

# Stage 2: Production
FROM node:24-bookworm-slim

WORKDIR /app

# Note: The Node.js base image already includes a 'node' user (UID 1000)
# We will switch to it at the end for security

# Set production environment
ENV NODE_ENV=production

# Install CA certificates
RUN apt-get update -y && apt-get install -y ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package files
COPY backend/package.json backend/
COPY dashboard/web-ui/package.json dashboard/web-ui/
COPY packages/react-native/package.json packages/react-native/

# Install production dependencies only (from root)
RUN npm ci --omit=dev --ignore-scripts

# Install drizzle-kit and tsx globally to ensure they are available for migrations
RUN npm install -g drizzle-kit@1.0.0-beta.9-e89174b drizzle-orm@1.0.0-beta.9-e89174b tsx

# Copy Drizzle config from backend source (it's in the root of the backend folder)
COPY backend/drizzle.config.ts backend/
COPY backend/src/db/schema.ts backend/src/db/

# Copy built code from build stage
COPY --from=build /app/backend/dist backend/dist

# Copy required package.json for runtime
COPY backend/package.json backend/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server (run from backend directory to resolve paths correctly if needed, or adjust command)
# We stay in /app/backend to match likely expectation of CWD
WORKDIR /app/backend

# Switch to non-root user
USER node

CMD ["node", "dist/index.js"]
