/**
 * Utility to load markdown files from the docs/ folder (SERVER-ONLY)
 * This allows the web UI to render documentation from the monorepo's docs/ folder
 * 
 * This file uses Node.js modules (fs, path) and should only be imported in server-side code (loaders)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DOCS_MAP, type DocMetadata } from './docsConfig';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOCS_SENTINEL = join('react-native', 'getting-started.md');

function isDocsRoot(candidate: string): boolean {
    return existsSync(join(candidate, DOCS_SENTINEL));
}

function getDocsRoot(): string {
    const candidates = [
        join(process.cwd(), 'docs'),
        join(process.cwd(), '..', 'docs'),
        join(process.cwd(), '..', '..', 'docs'),
        resolve(__dirname, '..', '..', '..', '..', '..', 'docs'),
        resolve(__dirname, '..', '..', '..', '..', 'docs'),
    ];

    for (const candidate of candidates) {
        if (isDocsRoot(candidate)) {
            return candidate;
        }
    }

    return join(process.cwd(), 'docs');
}

// Cache the resolved path (computed once)
const DOCS_ROOT = getDocsRoot();

// Re-export DocMetadata for convenience
export type { DocMetadata };

/**
 * Load markdown content from the docs folder
 */
export function loadDocContent(docPath: string): string | null {
    try {
        const docInfo = DOCS_MAP[docPath];
        if (!docInfo) {
            console.error(`[docsLoader] Doc path "${docPath}" not found in DOCS_MAP. Available paths:`, Object.keys(DOCS_MAP));
            return null;
        }

        const filePath = join(DOCS_ROOT, docInfo.file);
        console.log(`[docsLoader] Loading doc "${docPath}" from: ${filePath} (DOCS_ROOT: ${DOCS_ROOT})`);
        
        if (!existsSync(filePath)) {
            console.error(`[docsLoader] File does not exist: ${filePath}`);
            return null;
        }
        
        const content = readFileSync(filePath, 'utf-8');
        return content;
    } catch (error) {
        console.error(`[docsLoader] Failed to load doc "${docPath}" from ${DOCS_ROOT}:`, error);
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

// Note: getAllDocs is exported from docsConfig.ts for client-side use
