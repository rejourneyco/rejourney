/**
 * Derive the issue-detection `sourceGlobs` allow-list from the setup page's
 * two-level folder picker. Default is "everything allowed" (`['**']`); users
 * DESELECT folders to restrict what the detector may read.
 *
 *   - nothing deselected              → ['**']
 *   - else                            → ['*'] (root files) + per kept top-level dir D:
 *       · D fully kept                → 'D/**'
 *       · D partially kept            → 'D/*' (direct files) + 'D/C/**' for each kept child C
 *       · D fully deselected          → omitted
 *
 * `deselected` holds either a top-level dir name ("src") or a "dir/child"
 * ("src/api"). Globs still match arbitrarily deep under kept nodes.
 */

export interface FolderNode {
    name: string;
    children: string[];
}

export function deriveSourceGlobs(folderTree: FolderNode[], deselected: Set<string>): string[] {
    if (deselected.size === 0) return ['**'];

    const globs: string[] = ['*']; // root-level files stay visible
    for (const node of folderTree) {
        if (deselected.has(node.name)) continue; // whole top-level folder excluded

        const hasDeselectedChild = node.children.some((c) => deselected.has(`${node.name}/${c}`));
        if (!hasDeselectedChild) {
            globs.push(`${node.name}/**`);
        } else {
            globs.push(`${node.name}/*`);
            for (const child of node.children) {
                if (!deselected.has(`${node.name}/${child}`)) {
                    globs.push(`${node.name}/${child}/**`);
                }
            }
        }
    }
    return globs;
}
