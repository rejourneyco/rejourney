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
    'swift/overview': {
        file: 'ios/getting-started.md',
        title: 'Swift iOS SDK',
        category: 'Swift (iOS)',
        description: 'Add Rejourney to native iOS apps with the Swift SDK for session replay, privacy-safe telemetry, crashes, and mobile product analytics.',
        keywords: ['Swift session replay SDK', 'iOS analytics SDK', 'native iOS observability', 'Swift mobile monitoring', 'iOS crash reporting']
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
    'architecture/ci-cd': {
        file: 'distributed-vs-single-node/ci-cd.md',
        title: 'CI/CD & Testing',
        category: 'Architecture',
        description: 'Understand Rejourney CI/CD, testing, and release workflows for the web dashboard, backend, and mobile SDK packages.',
        keywords: ['mobile SDK CI/CD', 'observability testing pipeline', 'React Native SDK testing', 'Rejourney CI CD']
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
