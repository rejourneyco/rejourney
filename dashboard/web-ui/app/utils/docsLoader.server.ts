/**
 * Utility to load markdown files from the docs/ folder (SERVER-ONLY)
 * This allows the web UI to render documentation from the monorepo's docs/ folder
 * 
 * This file uses Node.js modules (fs, path) and should only be imported in server-side code (loaders)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DOCS_MAP, type DocMetadata } from './docsConfig';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the docs root directory - works in all environments
 * Priority:
 * 1. process.cwd()/docs (Docker: /app/docs)
 * 2. Relative from source file (Local dev: ../../docs)
 */
function getDocsRoot(): string {
    // 1. process.cwd()/docs - works in Docker where docs is at /app/docs
    const cwdDocs = join(process.cwd(), 'docs');
    const testFile = join(cwdDocs, 'react-native', 'getting-started.md');
    if (existsSync(testFile)) {
        return cwdDocs;
    }
    
    // 3. Relative from source file location - works in local dev
    // File location: dashboard/web-ui/app/utils/docsLoader.server.ts
    // Go up 4 levels: utils -> app -> web-ui -> dashboard -> root, then into docs
    const relativeDocs = join(__dirname, '..', '..', '..', '..', 'docs');
    const relativeTestFile = join(relativeDocs, 'react-native', 'getting-started.md');
    if (existsSync(relativeTestFile)) {
        return relativeDocs;
    }
    
    // Fallback (will fail with error when trying to read)
    return cwdDocs;
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
