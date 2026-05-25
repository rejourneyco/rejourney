/**
 * Custom Express server for React Router v7 SSR
 * 
 * Handles:
 * - API request proxying to backend
 * - Static file serving
 * - SSR via React Router
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createRequestHandler } from '@react-router/express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const API_URL = process.env.API_URL || 'http://api:3000';
const isProduction = process.env.NODE_ENV === 'production';
const cachePublicHtmlAtEdge = process.env.WEB_EDGE_HTML_CACHE === 'true';
const buildClientPath = join(__dirname, 'build', 'client');
const buildAssetsPath = join(buildClientPath, 'assets');
let isShuttingDown = false;
const MARKETING_LOCALE_SEGMENT = '(?:ar|es|tr|pt-br|de|fr|hi|id|ja|ko|zh-cn|it|nl|pl|pt|ru|vi)';
const MARKETING_LOCALE_PATH_PATTERN = new RegExp(`^/${MARKETING_LOCALE_SEGMENT}$`);
const LOCALIZED_PUBLIC_CONTENT_PATTERN = new RegExp(`^/${MARKETING_LOCALE_SEGMENT}/(?:docs|engineering|pricing)(?:/.*)?$`);
const EDGE_CACHEABLE_HTML_PATTERNS = [
  /^\/$/,
  MARKETING_LOCALE_PATH_PATTERN,
  /^\/login$/,
  /^\/pricing$/,
  /^\/docs(?:\/.*)?$/,
  LOCALIZED_PUBLIC_CONTENT_PATTERN,
  /^\/contribute$/,
  /^\/engineering(?:\/.*)?$/,
  /^\/terms-of-service$/,
  /^\/privacy-policy$/,
  /^\/dpa$/,
  /^\/changelog$/,
];
const LEGACY_PUBLIC_HTML_REDIRECTS = new Map([
  ['/index.html', '/'],
  ['/docs/index.html', '/docs/web/getting-started'],
  ['/pricing/index.html', '/pricing'],
  ['/session-replay-tools', '/record-user-sessions'],
  ['/session-replay-software', '/record-user-sessions'],
  ['/fullstory-alternative', '/alternatives/fullstory'],
  ['/fullstory-alternatives', '/alternatives/fullstory'],
  ['/%5D(https:/rejourney.co/', '/'],
  ['/](https:/rejourney.co/', '/'],
]);

function isEdgeCacheableHtmlPath(pathname) {
  return EDGE_CACHEABLE_HTML_PATTERNS.some((pattern) => pattern.test(pathname));
}

function hasBuiltClientAssets() {
  try {
    if (!existsSync(buildClientPath) || !existsSync(buildAssetsPath)) return false;
    const assetNames = readdirSync(buildAssetsPath);
    return assetNames.some((name) => name.endsWith('.css')) && assetNames.some((name) => name.endsWith('.js'));
  } catch {
    return false;
  }
}

// Security headers (fallback if Traefik middleware fails)
if (isProduction) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://challenges.cloudflare.com",
          "https://js.stripe.com",
          "https://m.stripe.network",
          "https://static.cloudflareinsights.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        // Session replay media is served from MinIO/S3 (often http://<host>:9000)
        mediaSrc: ["'self'", "blob:", "data:", "http:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: [
          "'self'",
          // Replay manifests can point at any operator-managed S3-compatible
          // endpoint from storage_endpoints. Use the HTTPS scheme instead of
          // hardcoding provider hostnames.
          "https:",
          "wss://api.rejourney.co",
        ],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'", "https://challenges.cloudflare.com", "https://js.stripe.com", "https://hooks.stripe.com"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],

        // This can break self-hosted/local setups where replay media is served over http.
        upgradeInsecureRequests: null,
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'sameorigin' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
}

// Parse cookies so we can forward them properly
app.use(cookieParser());

app.get('/health', (_req, res) => {
  if (isShuttingDown) {
    res.status(503).json({ status: 'draining', service: 'web', timestamp: new Date().toISOString() });
    return;
  }

  res.json({ status: 'ok', service: 'web', timestamp: new Date().toISOString() });
});

app.get('/health/ready', (_req, res) => {
  if (isShuttingDown) {
    res.status(503).json({ status: 'draining', service: 'web', timestamp: new Date().toISOString() });
    return;
  }

  if (!hasBuiltClientAssets()) {
    res.status(503).json({ status: 'missing-assets', service: 'web', timestamp: new Date().toISOString() });
    return;
  }

  res.json({ status: 'ready', service: 'web', timestamp: new Date().toISOString() });
});

// Proxy /api/* requests to the backend API server
app.use('/api', createProxyMiddleware({
  target: API_URL,
  changeOrigin: false, // Preserve original Host header so backend sees 'localhost'
  // Preserve the /api prefix when proxying
  pathRewrite: (path, req) => '/api' + path,
  // Forward cookies - rewrite domain to match the request
  cookieDomainRewrite: {
    '*': '' // Remove domain from cookies so they work on any domain
  },
  // Ensure X-Forwarded headers are set for proper hostname detection
  xfwd: true,
  onProxyReq: (proxyReq, req) => {
    // Forward the original Host header for localhost detection
    if (req.headers.host) {
      proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
      proxyReq.setHeader('Host', req.headers.host);
    }
    // Forward cookies from the original request
    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }
  },
  onError: (err, req, res) => {
    // Log proxy errors in development only
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[proxy] Error: ${err.message}`);
    }
    res.status(502).json({ error: 'Backend unavailable' });
  }
}));

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  const redirectTarget = LEGACY_PUBLIC_HTML_REDIRECTS.get(req.path);
  if (!redirectTarget) {
    next();
    return;
  }

  res.redirect(301, `${redirectTarget}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
});

// Serve static assets from the client build directory
// These need to be served BEFORE the catch-all SSR handler
// Using absolute path to ensure correct resolution regardless of working directory
app.use(express.static(buildClientPath, {
  maxAge: '1y',
  immutable: true,
  index: false, // Don't serve index.html for directory requests
}));

app.use('/assets', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  res
    .status(404)
    .setHeader('Cache-Control', 'no-store, max-age=0');
  res.type('text/plain').send('Asset not found');
});

app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) {
    next();
    return;
  }

  const acceptsHtml = req.headers.accept?.includes('text/html') ?? false;
  if (acceptsHtml && cachePublicHtmlAtEdge && isEdgeCacheableHtmlPath(req.path)) {
    if (req.path === '/') {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      next();
      return;
    }
    // Let Cloudflare cache public marketing/login HTML briefly while browsers
    // still revalidate on navigation.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  } else if (acceptsHtml) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  }

  next();
});

// Handle all other requests with React Router SSR
// Use relative path for dynamic import (ES modules require file:// URLs or relative paths)
app.all(
  '*',
  createRequestHandler({
    build: await import('./build/server/index.js'),
    mode: process.env.NODE_ENV || 'production',
  })
);

const server = app.listen(PORT, '0.0.0.0', () => {
  // Only log in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[server] http://localhost:${PORT}`);
    console.log(`[server] Proxying /api/* to ${API_URL}`);
  }
});

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    process.exit(1);
  }, 25_000);
  forceExitTimer.unref?.();

  server.close((err) => {
    clearTimeout(forceExitTimer);
    process.exit(err ? 1 : 0);
  });
  server.closeIdleConnections?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
