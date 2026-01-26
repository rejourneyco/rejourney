/**
 * Utility to load markdown files from the docs/ folder
 * This allows the web UI to render documentation from the monorepo's docs/ folder
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Path to docs folder relative to the workspace root
// This works in both dev and production builds
// process.cwd() in React Router loaders points to the workspace root
const DOCS_ROOT = join(process.cwd(), 'docs');

export interface DocMetadata {
    title: string;
    path: string;
    category?: string;
}

/**
 * Available documentation pages
 * Maps URL paths to file paths in the docs/ folder
 */
export const DOCS_MAP: Record<string, { file: string; title: string; category?: string }> = {
    '': {
        file: 'react-native/getting-started.md',
        title: 'React Native SDK Documentation',
        category: 'React Native'
    },
    'contribute': {
        file: 'contribute/contribute.md',
        title: 'Contributing',
        category: 'Development'
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
};

/**
 * Load markdown content from the docs folder
 */
export function loadDocContent(docPath: string): string | null {
    try {
        const docInfo = DOCS_MAP[docPath];
        if (!docInfo) {
            return null;
        }

        const filePath = join(DOCS_ROOT, docInfo.file);
        const content = readFileSync(filePath, 'utf-8');
        return content;
    } catch (error) {
        console.error(`Failed to load doc at ${docPath}:`, error);
        return null;
    }
}

/**
 * Get metadata for a doc path
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
 * Get all available docs
 */
export function getAllDocs(): DocMetadata[] {
    return Object.entries(DOCS_MAP).map(([path, info]) => ({
        title: info.title,
        path,
        category: info.category,
    }));
}
