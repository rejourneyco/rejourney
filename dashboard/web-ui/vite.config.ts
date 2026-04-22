import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [
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
    css: {
        postcss: "./postcss.config.js",
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
