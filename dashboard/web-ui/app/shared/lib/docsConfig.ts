/**
 * Client-safe documentation configuration
 * This file can be imported in client components
 */

export interface DocMetadata {
    title: string;
    path: string;
    category?: string;
    description?: string;
    keywords?: string[];
}

/**
 * Available documentation pages
 * Maps URL paths to file paths in the docs/ folder
 * This is a client-safe copy of DOCS_MAP from docsLoader.server.ts
 */
export const DOCS_MAP: Record<string, { file: string; title: string; category?: string; description: string; keywords: string[] }> = {
    'shopify/getting-started': {
        file: 'shopify/getting-started.md',
        title: 'Shopify',
        category: 'Shopify',
        description: 'Add Rejourney to Shopify storefronts, custom themes, and headless Shopify sites with domain allowlisting, consent-aware replay, privacy controls, and commerce events.',
        keywords: ['Shopify session replay', 'Shopify analytics SDK', 'Shopify custom theme analytics', 'headless Shopify session replay', 'Shopify conversion debugging']
    },
    'web/getting-started': {
        file: 'web/getting-started.md',
        title: 'Web SDK',
        category: 'Web',
        description: 'Install the Rejourney Web SDK for browser session replay, network tracking, error capture, and product analytics across React, Next.js, Vue, and more.',
        keywords: ['web session replay', 'browser analytics SDK', 'JavaScript session recording', 'web observability', 'React session replay']
    },
    'reactnative/overview': {
        file: 'react-native/getting-started.md',
        title: 'React Native SDK',
        category: 'React Native',
        description: 'Install the Rejourney React Native SDK for mobile session replay, crash reporting, heatmaps, journeys, and lightweight observability.',
        keywords: ['React Native session replay', 'React Native analytics SDK', 'mobile observability SDK', 'React Native crash reporting', 'React Native heatmaps']
    },
    'unity/overview': {
        file: 'unity/getting-started.md',
        title: 'Unity SDK', category: 'Unity',
        description: 'Unity mobile game replay with privacy masking, performance monitoring, gameplay markers, errors and crashes, and automatic HTTP timing for iOS and Android.',
        keywords: ['Unity session replay', 'Unity mobile observability', 'Unity analytics SDK']
    },
    'flutter/overview': {
        file: 'flutter/getting-started.md',
        title: 'Flutter SDK',
        category: 'Flutter',
        description: 'Install the Rejourney Flutter SDK for native iOS and Android session replay, privacy masking, crash and ANR reporting, network timing, and product analytics.',
        keywords: ['Flutter session replay', 'Flutter analytics SDK', 'Flutter crash reporting', 'Dart mobile observability', 'Flutter privacy masking']
    },
    'swift/overview': {
        file: 'ios/getting-started.md',
        title: 'Swift iOS SDK',
        category: 'Swift (iOS)',
        description: 'Add Rejourney to native iOS apps with the Swift SDK for session replay, privacy-safe telemetry, crashes, and mobile product analytics.',
        keywords: ['Swift session replay SDK', 'iOS analytics SDK', 'native iOS observability', 'Swift mobile monitoring', 'iOS crash reporting']
    },
    // MCP pages. The docs sidebar lists them in this order.
    'mcp/getting-started': {
        file: 'mcp/getting-started.md',
        title: 'MCP Server',
        category: 'MCP',
        description: 'Connect Claude Code, Claude, Cursor, or any MCP client to the hosted, read-only Rejourney MCP server, sign in with OAuth, choose the projects to share, and revoke access.',
        keywords: ['Rejourney MCP server', 'session replay MCP', 'Claude Code MCP session replay', 'Cursor MCP crash analytics', 'remote MCP server OAuth']
    },
    'mcp/what-you-can-ask': {
        file: 'mcp/what-you-can-ask.md',
        title: 'What You Can Ask the MCP Server',
        category: 'MCP',
        description: 'Example questions for the Rejourney MCP server, grouped by job: health checks, crash and ANR investigation, single-session review, friction, and version or platform comparison.',
        keywords: ['MCP example prompts', 'AI crash triage', 'AI session replay review', 'ANR investigation with AI', 'mobile app friction analysis']
    },
    'mcp/tools': {
        file: 'mcp/tools.md',
        title: 'MCP Tool Reference',
        category: 'MCP',
        description: 'Reference for every Rejourney MCP tool: what it returns, its arguments and credit cost, plus paging and cursors, time ranges, capped counts, and event stream status.',
        keywords: ['Rejourney MCP tools', 'MCP tool reference', 'session replay API for AI', 'MCP pagination cursors', 'crash context tool']
    },
    'mcp/limits-and-billing': {
        file: 'mcp/limits-and-billing.md',
        title: 'MCP Limits and Billing',
        category: 'MCP',
        description: 'How Rejourney MCP credits work: what a call costs, the response size rule, the monthly allowance on each plan, what happens at the limit, rate limits, and response times.',
        keywords: ['Rejourney MCP credits', 'MCP pricing', 'MCP rate limits', 'MCP usage allowance', 'MCP response times']
    },
    'mcp/security-and-privacy': {
        file: 'mcp/security-and-privacy.md',
        title: 'MCP Security and Privacy',
        category: 'MCP',
        description: 'What an AI client can and cannot read through the Rejourney MCP server: read-only access, per-team and per-project scoping, short-lived tokens, secret scrubbing, identifier masking, and revocation.',
        keywords: ['MCP security', 'MCP data privacy', 'read-only MCP server', 'MCP prompt injection', 'OAuth 2.1 PKCE MCP']
    },
    'community/contributing': {
        file: 'community/contributing.md',
        title: 'Contributing',
        category: 'Community',
        description: 'Contribute to the Rejourney open-source mobile observability platform, set up the monorepo, and run local development workflows.',
        keywords: ['Rejourney contributing', 'open source mobile analytics', 'mobile observability open source', 'React Native SDK development']
    },
    'selfhosted': {
        file: 'selfhosted/README.md',
        title: 'Self-Hosted Deployment',
        category: 'Self-Hosting',
        description: 'Deploy Rejourney on your own infrastructure for self-hosted mobile analytics, session replay, crash reporting, and observability.',
        keywords: ['self-hosted mobile analytics', 'self-hosted session replay', 'open source observability deployment', 'Docker mobile analytics']
    },
    'selfhosted/backup-recovery': {
        file: 'selfhosted/backup-recovery.md',
        title: 'Backup & Recovery',
        category: 'Self-Hosting',
        description: 'Back up and recover self-hosted Rejourney deployments, including database, storage, and operational recovery guidance.',
        keywords: ['self-hosted analytics backup', 'session replay backup', 'Postgres backup observability', 'mobile analytics disaster recovery']
    },
    'selfhosted/troubleshooting': {
        file: 'selfhosted/troubleshooting.md',
        title: 'Troubleshooting',
        category: 'Self-Hosting',
        description: 'Troubleshoot self-hosted Rejourney installs, SDK ingestion, storage, networking, and mobile observability deployment issues.',
        keywords: ['Rejourney troubleshooting', 'self-hosted session replay troubleshooting', 'mobile analytics deployment issues', 'SDK ingest debugging']
    },
    'architecture/distributed-vs-single-node': {
        file: 'architecture/distributed-vs-single-node.md',
        title: 'Distributed vs Single-Node Cloud',
        category: 'Architecture',
        description: 'Compare distributed Kubernetes and single-node cloud architectures for self-hosted mobile observability and session replay infrastructure.',
        keywords: ['mobile observability architecture', 'Kubernetes analytics deployment', 'single node observability', 'distributed session replay']
    },
    'architecture/diagrams': {
        file: 'architecture/diagrams.md',
        title: 'Architecture Diagrams',
        category: 'Architecture',
        description: 'Review Rejourney architecture diagrams for SDK ingestion, replay storage, dashboards, workers, and self-hosted deployment topology.',
        keywords: ['Rejourney architecture diagrams', 'session replay architecture', 'mobile analytics architecture', 'observability system design']
    },
    'architecture/smart-capture-replay-billing': {
        file: 'architecture/smart-capture-replay-billing.md',
        title: 'Smart Capture & Replay Billing',
        category: 'Architecture',
        description: 'Understand how Rejourney separates analytics sessions from replay usage, keeps analytics beyond replay quota, and supports future server-side smart capture rules.',
        keywords: ['smart capture', 'session replay billing', 'analytics sessions', 'replay quota', 'session replay architecture']
    },
    'architecture/ci-cd': {
        file: 'distributed-vs-single-node/ci-cd.md',
        title: 'CI/CD & Testing',
        category: 'Architecture',
        description: 'Understand Rejourney CI/CD, testing, deployment, and release workflows for the backend, dashboard, React Native SDK, Flutter SDK, native iOS SDK, and Browser SDK.',
        keywords: ['mobile SDK CI/CD', 'observability testing pipeline', 'React Native SDK testing', 'Flutter SDK testing', 'Browser SDK release', 'Swift SDK CI', 'Rejourney CI CD']
    },
};

/**
 * Get metadata for a doc path (client-safe)
 */
export function getDocMetadata(docPath: string): DocMetadata | null {
    const docInfo = DOCS_MAP[docPath];
    if (!docInfo) {
        return null;
    }

    return {
        title: docInfo.title,
        path: docPath,
        category: docInfo.category,
        description: docInfo.description,
        keywords: docInfo.keywords,
    };
}

/**
 * Get all available docs (client-safe)
 */
export function getAllDocs(): DocMetadata[] {
    return Object.entries(DOCS_MAP).map(([path, info]) => ({
    title: info.title,
    path,
    category: info.category,
    description: info.description,
    keywords: info.keywords,
}));
}
