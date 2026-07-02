/**
 * Rejourney Dashboard - Server Entry
 * 
 * By default, React Router uses this file to handle all SSR requests.
 */

import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { AppLoadContext, EntryContext } from "react-router";
import { MARKETING_LOCALES } from "./shared/lib/internationalMarketing";

const ABORT_DELAY = 5000;

// Content Security Policy that allows Stripe, Rejourney ingest, Mapbox, and Zaraz-managed Google Ads.
const CSP_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://m.stripe.network https://static.cloudflareinsights.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://www.redditstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Session replay images/screenshots are served from MinIO/S3 (http for local dev)
    "img-src 'self' data: http: https: blob:",
    // Session replay media is served from MinIO/S3 in self-hosted/local setups
    "media-src 'self' blob: data: http: https:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://www.googletagmanager.com",
    // Replay URLs are generated from operator-managed S3-compatible storage
    // endpoints, so allow HTTPS dynamically instead of hardcoding providers.
    // Local dev also needs HTTP for MinIO/LAN endpoints.
    "connect-src 'self' http: https:",
    "worker-src 'self' blob:",
].join("; ");

export default function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext,
    loadContext: AppLoadContext
) {
    responseHeaders.set("Content-Language", MARKETING_LOCALES.en.languageTag);

    // Avoid sending duplicate CSP headers in production.
    // In production we rely on Helmet in `server.js` to set CSP.
    if (process.env.NODE_ENV !== "production") {
        responseHeaders.set("Content-Security-Policy", CSP_POLICY);
    }
    
    return isbot(request.headers.get("user-agent") || "")
        ? handleBotRequest(
            request,
            responseStatusCode,
            responseHeaders,
            routerContext
        )
        : handleBrowserRequest(
            request,
            responseStatusCode,
            responseHeaders,
            routerContext
        );
}

function handleBotRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext
) {
    return new Promise((resolve, reject) => {
        let shellRendered = false;
        const { pipe, abort } = renderToPipeableStream(
            <ServerRouter context={routerContext} url={request.url} />,
            {
                onAllReady() {
                    shellRendered = true;
                    const body = new PassThrough();
                    const stream = createReadableStreamFromReadable(body);

                    responseHeaders.set("Content-Type", "text/html; charset=utf-8");

                    resolve(
                        new Response(stream, {
                            headers: responseHeaders,
                            status: responseStatusCode,
                        })
                    );

                    pipe(body);
                },
                onShellError(error: unknown) {
                    reject(error);
                },
                onError(error: unknown) {
                    responseStatusCode = 500;
                    if (shellRendered) {
                        console.error(error);
                    }
                },
            }
        );

        setTimeout(abort, ABORT_DELAY);
    });
}

function handleBrowserRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext
) {
    // Wait for all Suspense boundaries before flushing. This avoids emitting
    // React's streaming markers (<!--$?--> + $RC script), which Cloudflare's
    // JS Detections iframe injection corrupts into a visible stray "$".
    return new Promise((resolve, reject) => {
        let shellRendered = false;
        const { pipe, abort } = renderToPipeableStream(
            <ServerRouter context={routerContext} url={request.url} />,
            {
                onAllReady() {
                    shellRendered = true;
                    const body = new PassThrough();
                    const stream = createReadableStreamFromReadable(body);

                    responseHeaders.set("Content-Type", "text/html; charset=utf-8");

                    resolve(
                        new Response(stream, {
                            headers: responseHeaders,
                            status: responseStatusCode,
                        })
                    );

                    pipe(body);
                },
                onShellError(error: unknown) {
                    reject(error);
                },
                onError(error: unknown) {
                    responseStatusCode = 500;
                    if (shellRendered) {
                        console.error(error);
                    }
                },
            }
        );

        setTimeout(abort, ABORT_DELAY);
    });
}
