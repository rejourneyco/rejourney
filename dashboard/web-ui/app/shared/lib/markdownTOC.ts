/**
 * Utility to extract table of contents from markdown content
 */

export interface TOCSection {
    id: string;
    title: string;
    level: number;
}

// Helper to generate ID from heading text
function generateId(text: string): string {
    return String(text)
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

/**
 * Extract table of contents from markdown content
 * Looks for h2 and h3 headings and creates a TOC
 */
export function extractTOCFromMarkdown(content: string): TOCSection[] {
    const toc: TOCSection[] = [];
    
    // Match markdown headings (## Heading or ### Heading)
    const headingRegex = /^(#{2,3})\s+(.+)$/gm;
    let match;
    
    while ((match = headingRegex.exec(content)) !== null) {
        const level = match[1].length; // 2 for h2, 3 for h3
        const title = match[2].trim();
        const id = generateId(title);
        
        // Only include h2 and h3 headings
        if (level === 2 || level === 3) {
            toc.push({
                id,
                title,
                level,
            });
        }
    }
    
    return toc;
}
