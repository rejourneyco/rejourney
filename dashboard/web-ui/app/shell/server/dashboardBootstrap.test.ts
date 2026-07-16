import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuthBootstrap, loadDashboardShellBootstrap } from './dashboardBootstrap';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('dashboard bootstrap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('hydrates an anonymous login without a client auth check', async () => {
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(loadAuthBootstrap(new Request('https://app.example.test/login'))).resolves.toEqual({
      __authBootstrap: true,
      authServiceUnavailable: false,
      error: null,
      user: null,
    });
  });

  it('loads teams and projects concurrently after authentication', async () => {
    vi.stubEnv('API_URL', 'https://api.example.test');
    let resolveTeams!: (response: Response) => void;
    let resolveProjects!: (response: Response) => void;
    const teamsResponse = new Promise<Response>((resolve) => { resolveTeams = resolve; });
    const projectsResponse = new Promise<Response>((resolve) => { resolveProjects = resolve; });
    const requestedPaths: string[] = [];

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      requestedPaths.push(url.pathname);
      if (url.pathname === '/api/auth/me') {
        return Promise.resolve(jsonResponse({
          user: {
            id: 'user-1',
            email: 'person@example.com',
            displayName: 'Person',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        }));
      }
      if (url.pathname === '/api/teams') return teamsResponse;
      if (url.pathname === '/api/projects') return projectsResponse;
      return Promise.resolve(new Response(null, { status: 404 }));
    }));

    const bootstrapPromise = loadDashboardShellBootstrap(new Request('https://app.example.test/dashboard'));
    await vi.waitFor(() => {
      expect(requestedPaths).toEqual(['/api/auth/me', '/api/teams', '/api/projects']);
    });

    resolveTeams(jsonResponse({ teams: [{ id: 'team-1', name: 'Team' }] }));
    resolveProjects(jsonResponse({ projects: [] }));

    await expect(bootstrapPromise).resolves.toMatchObject({
      __shellBootstrap: true,
      currentTeamId: 'team-1',
      projects: [],
      teams: [{ id: 'team-1', name: 'Team' }],
      user: { id: 'user-1', email: 'person@example.com' },
    });
  });
});
