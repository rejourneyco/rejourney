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
