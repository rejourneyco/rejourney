import { defineConfig, type Plugin } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || process.env.VITE_API_URL || "http://localhost:3000";

function noStoreOptimizedDeps(): Plugin {
    return {
        name: "no-store-optimized-deps",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url?.startsWith("/node_modules/.vite/deps/")) {
                    next();
                    return;
                }

                const setHeader = res.setHeader.bind(res);
                res.setHeader = ((name: string, value: number | string | readonly string[]) => {
                    if (name.toLowerCase() === "cache-control") {
                        return setHeader(name, "no-store, max-age=0");
                    }
                    return setHeader(name, value);
                }) as typeof res.setHeader;

                setHeader("Cache-Control", "no-store, max-age=0");
                setHeader("Pragma", "no-cache");
                setHeader("Expires", "0");
                next();
            });
        },
    };
}

export default defineConfig({
    plugins: [
        noStoreOptimizedDeps(),
        reactRouter(),
        tsconfigPaths({
            projects: ['./tsconfig.json'],
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/recharts')) {
                        return 'charts';
                    }
                    if (id.includes('node_modules/react-map-gl') || id.includes('node_modules/mapbox-gl')) {
                        return 'maps';
                    }
                    if (id.includes('node_modules/heic2any')) {
                        return 'replay-media';
                    }
                    if (
                        id.includes('/app/features/app/sessions/detail/') ||
                        id.includes('/app/shared/ui/core/DOMInspector') ||
                        id.includes('/app/shared/ui/core/TouchOverlay')
                    ) {
                        return 'replay-inspector';
                    }
                    return undefined;
                },
            },
        },
    },
    // Recharts (and react-redux inside it) must resolve the same React as the app,
    // or hooks like useContext throw "dispatcher is null" from a second React instance.
    resolve: {
        dedupe: ["react", "react-dom"],
    },
    ssr: {
        noExternal: ["recharts"],
    },
    optimizeDeps: {
        include: [
            "@headlessui/react",
            "@reduxjs/toolkit",
            "@rrweb/replay",
            "@stripe/react-stripe-js",
            "@stripe/stripe-js",
            "clsx",
            "decimal.js-light",
            "es-toolkit/compat/get",
            "es-toolkit/compat/isPlainObject",
            "es-toolkit/compat/last",
            "es-toolkit/compat/maxBy",
            "es-toolkit/compat/minBy",
            "es-toolkit/compat/omit",
            "es-toolkit/compat/range",
            "es-toolkit/compat/sortBy",
            "es-toolkit/compat/sumBy",
            "es-toolkit/compat/throttle",
            "es-toolkit/compat/uniqBy",
            "eventemitter3",
            "framer-motion",
            "heic2any",
            "immer",
            "lucide-react",
            "mapbox-gl",
            "react",
            "react-dom",
            "react-dom/client",
            "react-is",
            "react-map-gl",
            "react-markdown",
            "react-redux",
            "react-router",
            "react-router/dom",
            "react-window",
            "react-window-infinite-loader",
            "react/jsx-dev-runtime",
            "react/jsx-runtime",
            "reactflow",
            "recharts",
            "remark-gfm",
            "reselect",
            "tiny-invariant",
            "use-sync-external-store/shim/with-selector",
            "victory-vendor/d3-scale",
            "victory-vendor/d3-shape",
        ],
    },
    css: {
        postcss: "./postcss.config.js",
    },
    server: {
        proxy: {
            '/api': {
                target: apiProxyTarget,
                changeOrigin: true,
            },
        },
    },
});
