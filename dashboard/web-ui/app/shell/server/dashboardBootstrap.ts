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

function normalizeTeamsResponse(payload: unknown): ApiTeam[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as ApiTeamsResponse).teams)) {
    return (payload as ApiTeamsResponse).teams ?? [];
  }

  return [];
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

  return fetch(url.toString(), {
    headers,
    cache: "no-store",
  });
}

async function fetchCurrentUser(request: Request): Promise<User | null> {
  try {
    const response = await fetchBootstrapJson(request, "/api/auth/me");
    if (response.status === 401 || response.status === 403) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to load auth bootstrap: ${response.status}`);
    }

    const payload = (await response.json()) as ApiAuthResponse;
    const userData = payload.user || payload;
    if (!userData) {
      return null;
    }

    return normalizeAuthUser(userData);
  } catch (error) {
    console.error("Failed to load current user for dashboard shell:", error);
    return null;
  }
}

async function fetchTeams(request: Request): Promise<ApiTeam[]> {
  try {
    const response = await fetchBootstrapJson(request, "/api/teams");
    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      throw new Error(`Failed to load team bootstrap: ${response.status}`);
    }

    return normalizeTeamsResponse(await response.json());
  } catch (error) {
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
      throw new Error(`Failed to load projects bootstrap: ${response.status}`);
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
