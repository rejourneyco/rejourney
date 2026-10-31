import { describe, expect, it } from 'vitest';
import { resolveRequestedProjectScope } from '../utils/projectScope.js';

describe('resolveRequestedProjectScope', () => {
    const accessible = ['project-a', 'project-b'];

    it('scopes to every accessible project when no project is requested', () => {
        expect(resolveRequestedProjectScope(undefined, accessible)).toEqual(accessible);
        expect(resolveRequestedProjectScope('', accessible)).toEqual(accessible);
    });

    it('honors a requested project the caller can access', () => {
        expect(resolveRequestedProjectScope('project-b', accessible)).toEqual(['project-b']);
    });

    it('denies a requested project outside the caller\'s teams', () => {
        expect(resolveRequestedProjectScope('someone-elses-project', accessible)).toBeNull();
    });

    it('denies non-string project ids such as repeated query params', () => {
        expect(resolveRequestedProjectScope(['project-a', 'other'], accessible)).toBeNull();
    });

    it('does not share the caller\'s array', () => {
        const scope = resolveRequestedProjectScope(undefined, accessible)!;
        scope.sort().reverse();
        expect(accessible).toEqual(['project-a', 'project-b']);
    });
});
