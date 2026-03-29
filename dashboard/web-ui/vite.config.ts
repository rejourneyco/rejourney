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
