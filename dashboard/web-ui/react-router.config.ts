import type { Config } from "@react-router/dev/config";

export default {
    // Enable SSR for SEO/crawler support
    ssr: true,

    // App directory (where routes live)
    appDirectory: "app",

    // Build output directories
    buildDirectory: "build",
} satisfies Config;
