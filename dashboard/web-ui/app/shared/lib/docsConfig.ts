/**
 * Client-safe documentation configuration
 * This file can be imported in client components
 */

export interface DocMetadata {
    title: string;
    path: string;
    category?: string;
}

/**
 * Available documentation pages
 * Maps URL paths to file paths in the docs/ folder
 * This is a client-safe copy of DOCS_MAP from docsLoader.server.ts
 */
export const DOCS_MAP: Record<string, { file: string; title: string; category?: string }> = {
    'reactnative/overview': {
        file: 'react-native/getting-started.md',
        title: 'React Native SDK Documentation',
        category: 'React Native'
    },
    'community/contributing': {
        file: 'community/contributing.md',
        title: 'Contributing',
        category: 'Community'
    },
    'selfhosted': {
        file: 'selfhosted/README.md',
        title: 'Self-Hosted Deployment',
        category: 'Self-Hosting'
    },
    'selfhosted/backup-recovery': {
        file: 'selfhosted/backup-recovery.md',
        title: 'Backup & Recovery',
        category: 'Self-Hosting'
    },
    'selfhosted/troubleshooting': {
        file: 'selfhosted/troubleshooting.md',
        title: 'Troubleshooting',
        category: 'Self-Hosting'
    },
    'architecture/distributed-vs-single-node': {
        file: 'distributed-vs-single-node/distributed-vs-single-node.md',
        title: 'Distributed vs Single-Node Cloud',
        category: 'Architecture'
    },
    'architecture/ci-cd': {
        file: 'distributed-vs-single-node/ci-cd.md',
        title: 'CI/CD & Testing',
        category: 'Architecture'
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
    }));
}
