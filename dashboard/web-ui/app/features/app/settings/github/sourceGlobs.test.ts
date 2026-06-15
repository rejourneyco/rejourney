import { describe, it, expect } from 'vitest';
import { deriveSourceGlobs, type FolderNode } from './sourceGlobs';

const tree: FolderNode[] = [
    { name: 'src', children: ['api', 'web'] },
    { name: 'docs', children: [] },
    { name: 'dashboard', children: ['web-ui'] },
];

describe('deriveSourceGlobs', () => {
    it('returns ["**"] when nothing is deselected (everything allowed)', () => {
        expect(deriveSourceGlobs(tree, new Set())).toEqual(['**']);
    });

    it('omits a fully-deselected top-level folder, keeps the rest at /**', () => {
        expect(deriveSourceGlobs(tree, new Set(['docs']))).toEqual(['*', 'src/**', 'dashboard/**']);
    });

    it('expands a partially-deselected folder to root files + kept children', () => {
        expect(deriveSourceGlobs(tree, new Set(['src/api']))).toEqual([
            '*',
            'src/*',
            'src/web/**',
            'docs/**',
            'dashboard/**',
        ]);
    });

    it('combines a top-level and a nested deselection', () => {
        expect(deriveSourceGlobs(tree, new Set(['docs', 'src/web']))).toEqual([
            '*',
            'src/*',
            'src/api/**',
            'dashboard/**',
        ]);
    });

    it('returns only root files when every top-level folder is deselected', () => {
        expect(deriveSourceGlobs(tree, new Set(['src', 'docs', 'dashboard']))).toEqual(['*']);
    });
});
