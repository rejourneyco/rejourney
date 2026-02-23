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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const API_URL = process.env.API_URL || 'http://api:3000';
const isProduction = process.env.NODE_ENV === 'production';

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
          "https://www.clarity.ms",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        // Session replay media is served from MinIO/S3 (often http://<host>:9000)
        mediaSrc: ["'self'", "blob:", "data:", "http:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: [
          "'self'",
          "https://api.rejourney.co",
          "wss://api.rejourney.co",
          "https://ingest.rejourney.co",
          "https://api.stripe.com",
          "https://m.stripe.network",
          "https://cloudflareinsights.com",
          "https://api.mapbox.com",
          "https://events.mapbox.com",
          "https://*.tiles.mapbox.com",
          "https://www.clarity.ms",
          "https://*.clarity.ms",
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

// Serve static assets from the client build directory
// These need to be served BEFORE the catch-all SSR handler
// Using absolute path to ensure correct resolution regardless of working directory
const buildClientPath = join(__dirname, 'build', 'client');
app.use(express.static(buildClientPath, {
  maxAge: '1y',
  immutable: true,
  index: false, // Don't serve index.html for directory requests
}));

// Handle all other requests with React Router SSR
// Use relative path for dynamic import (ES modules require file:// URLs or relative paths)
app.all(
  '*',
  createRequestHandler({
    build: await import('./build/server/index.js'),
    mode: process.env.NODE_ENV || 'production',
  })
);

app.listen(PORT, '0.0.0.0', () => {
  // Only log in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[server] http://localhost:${PORT}`);
    console.log(`[server] Proxying /api/* to ${API_URL}`);
  }
});
