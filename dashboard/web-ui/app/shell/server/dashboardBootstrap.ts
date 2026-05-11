import type { ApiProject, ApiTeam } from "~/shared/api/client";
import type { User } from "~/shared/providers/AuthContext";
import { normalizeAuthUser } from "~/shared/providers/AuthContext";
import { readCookieValue, SELECTED_PROJECT_COOKIE, SELECTED_TEAM_COOKIE } from "~/shared/utils/selectionCookies";

export interface DashboardShellBootstrapData {
  __shellBootstrap: true;
  currentTeamId: string | null;
  projects: ApiProject[];
  projectsTeamId: string | null;
  selectedProjectId: string | null;
  teams: ApiTeam[];
  user: User;
}

interface ApiAuthResponse {
  user?: Record<string, unknown>;
}

interface ApiTeamsResponse {
  teams?: ApiTeam[];
}

interface ApiProjectsResponse {
  projects?: ApiProject[];
}

// Thrown when the upstream API is temporarily unreachable (5xx, fetch failure,
// timeout). Distinct from a 401/403 which means the user is genuinely logged
// out. The dashboard loader catches this and renders an error boundary instead
// of bouncing to /login — bouncing valid sessions on a 30-second deploy blip
// looks like a forced logout to the user.
export class BootstrapTransientError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BootstrapTransientError";
    this.status = status;
  }
}

function normalizeTeamsResponse(payload: unknown): ApiTeam[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as ApiTeamsResponse).teams)) {
    return (payload as ApiTeamsResponse).teams ?? [];
  }

  return [];
}

const BOOTSTRAP_FETCH_TIMEOUT_MS = 4000;
const BOOTSTRAP_RETRY_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBootstrapJson(request: Request, path: string): Promise<Response> {
  const baseUrl = process.env.API_URL || new URL(request.url).origin;
  const url = new URL(path, baseUrl);
  const headers = new Headers();
  const cookie = request.headers.get("cookie");

  if (cookie) {
    headers.set("cookie", cookie);
  }

  headers.set("accept", "application/json");

  // One retry with short backoff smooths over rolling-deploy windows where the
  // Service briefly has no Ready endpoints (Traefik 502/503 for ~1s).
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BOOTSTRAP_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status >= 500 && response.status <= 599 && attempt === 0) {
        await sleep(BOOTSTRAP_RETRY_DELAY_MS);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === 0) {
        await sleep(BOOTSTRAP_RETRY_DELAY_MS);
        continue;
      }
    }
  }
  throw new BootstrapTransientError(
    `Upstream API unreachable for ${path}: ${String(lastError)}`,
    503,
  );
}

async function fetchCurrentUser(request: Request): Promise<User | null> {
  const response = await fetchBootstrapJson(request, "/api/auth/me");
  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    // 5xx after retry — surface as transient so the loader can render an
    // error boundary instead of treating the user as logged out.
    throw new BootstrapTransientError(
      `Failed to load auth bootstrap: ${response.status}`,
      response.status,
    );
  }

  const payload = (await response.json()) as ApiAuthResponse;
  const userData = payload.user || payload;
  if (!userData) {
    return null;
  }

  return normalizeAuthUser(userData);
}

async function fetchTeams(request: Request): Promise<ApiTeam[]> {
  try {
    const response = await fetchBootstrapJson(request, "/api/teams");
    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      console.error(`Failed to load team bootstrap: ${response.status}`);
      return [];
    }

    return normalizeTeamsResponse(await response.json());
  } catch (error) {
    // Teams/projects are not auth-critical — degrade gracefully rather than
    // 503-ing the whole shell. The client-side fetchers will retry.
    console.error("Failed to load teams for dashboard shell:", error);
    return [];
  }
}

function normalizeProjectsResponse(payload: unknown): ApiProject[] {
  if (Array.isArray(payload)) {
    return payload as ApiProject[];
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as ApiProjectsResponse).projects)) {
    return (payload as ApiProjectsResponse).projects ?? [];
  }

  return [];
}

async function fetchProjects(request: Request): Promise<ApiProject[]> {
  try {
    const response = await fetchBootstrapJson(request, "/api/projects");
    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      console.error(`Failed to load projects bootstrap: ${response.status}`);
      return [];
    }

    return normalizeProjectsResponse(await response.json());
  } catch (error) {
    console.error("Failed to load projects for dashboard shell:", error);
    return [];
  }
}

export async function loadDashboardShellBootstrap(request: Request): Promise<DashboardShellBootstrapData | null> {
  const user = await fetchCurrentUser(request);
  if (!user) {
    return null;
  }

  const cookieHeader = request.headers.get("cookie");
  const teams = await fetchTeams(request);
  const preferredTeamId = readCookieValue(cookieHeader, SELECTED_TEAM_COOKIE);
  const currentTeamId = teams.find((team) => team.id === preferredTeamId)?.id ?? teams[0]?.id ?? null;
  const allProjects = await fetchProjects(request);
  const projects = currentTeamId
    ? allProjects.filter((project) => !project.teamId || project.teamId === currentTeamId)
    : allProjects;
  const preferredProjectId = readCookieValue(cookieHeader, SELECTED_PROJECT_COOKIE);
  const selectedProjectId = projects.find((project) => project.id === preferredProjectId)?.id ?? projects[0]?.id ?? null;

  return {
    __shellBootstrap: true,
    currentTeamId,
    projects,
    projectsTeamId: currentTeamId,
    selectedProjectId,
    teams,
    user,
  };
}

export function isDashboardShellBootstrapData(value: unknown): value is DashboardShellBootstrapData {
  return Boolean(
    value
    && typeof value === "object"
    && "__shellBootstrap" in value
    && (value as DashboardShellBootstrapData).__shellBootstrap
  );
}
