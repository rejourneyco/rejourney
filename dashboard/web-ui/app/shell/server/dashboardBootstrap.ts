import type { ApiTeam } from "~/shared/api/client";
import type { User } from "~/shared/providers/AuthContext";
import { normalizeAuthUser } from "~/shared/providers/AuthContext";

export interface DashboardShellBootstrapData {
  __shellBootstrap: true;
  currentTeamId: string | null;
  teams: ApiTeam[];
  user: User;
}

interface ApiAuthResponse {
  user?: Record<string, unknown>;
}

interface ApiTeamsResponse {
  teams?: ApiTeam[];
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

export async function loadDashboardShellBootstrap(request: Request): Promise<DashboardShellBootstrapData | null> {
  const user = await fetchCurrentUser(request);
  if (!user) {
    return null;
  }

  const teams = await fetchTeams(request);

  return {
    __shellBootstrap: true,
    currentTeamId: teams[0]?.id ?? null,
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
