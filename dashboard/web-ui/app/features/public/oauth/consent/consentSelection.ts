/** Team and project choice on the consent screen. Pure, so it is easy to test. */

import type { ConsentDecisionBody, ConsentDetails, ConsentTeam } from "./consentApi";

export type ProjectMode = "all" | "selected";

export interface ConsentSelection {
    teamId: string | null;
    mode: ProjectMode;
    /** Only used when mode is "selected". */
    projectIds: string[];
}

export function selectableTeams(details: ConsentDetails): ConsentTeam[] {
    return details.teams.filter((team) => team.mcpEnabled);
}

/** Preselects the team only when exactly one can be chosen; otherwise the user picks. */
export function initialSelection(details: ConsentDetails): ConsentSelection {
    const teams = selectableTeams(details);
    return { teamId: teams.length === 1 ? teams[0].id : null, mode: "all", projectIds: [] };
}

export function findSelectedTeam(details: ConsentDetails, selection: ConsentSelection): ConsentTeam | null {
    if (!selection.teamId) return null;
    return details.teams.find((team) => team.id === selection.teamId && team.mcpEnabled) ?? null;
}

export function chooseTeam(selection: ConsentSelection, teamId: string): ConsentSelection {
    if (selection.teamId === teamId) return selection;
    return { teamId, mode: "all", projectIds: [] };
}

export function chooseMode(selection: ConsentSelection, mode: ProjectMode): ConsentSelection {
    return { ...selection, mode };
}

export function toggleProject(selection: ConsentSelection, projectId: string, checked: boolean): ConsentSelection {
    const without = selection.projectIds.filter((id) => id !== projectId);
    return { ...selection, projectIds: checked ? [...without, projectId] : without };
}

/** Why Allow cannot be pressed yet, or null when the choice is complete. */
export function selectionProblem(details: ConsentDetails, selection: ConsentSelection): string | null {
    if (selectableTeams(details).length === 0) {
        return "None of your teams has MCP access turned on. A team admin can turn it on in the MCP page of the dashboard.";
    }
    const team = findSelectedTeam(details, selection);
    if (!team) return "Choose a team.";
    if (team.projects.length === 0) return `${team.name} has no projects yet. Create a project first, or choose another team.`;
    if (selection.mode === "selected" && chosenProjectIds(team, selection).length === 0) {
        return "Choose at least one project, or choose All projects in this team.";
    }
    return null;
}

function chosenProjectIds(team: ConsentTeam, selection: ConsentSelection): string[] {
    const chosen = new Set(selection.projectIds);
    return team.projects.filter((project) => chosen.has(project.id)).map((project) => project.id);
}

/** Request body for Allow. "All projects" is sent as the explicit list of the team's current projects. */
export function buildAllowBody(details: ConsentDetails, selection: ConsentSelection): ConsentDecisionBody | null {
    if (selectionProblem(details, selection)) return null;
    const team = findSelectedTeam(details, selection);
    if (!team) return null;
    const projectIds = selection.mode === "all"
        ? team.projects.map((project) => project.id)
        : chosenProjectIds(team, selection);
    return { decision: "allow", teamId: team.id, projectIds };
}
