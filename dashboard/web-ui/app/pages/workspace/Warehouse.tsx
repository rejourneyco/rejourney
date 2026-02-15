import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Node,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Home } from 'lucide-react';

import { useDemoMode } from '../../context/DemoModeContext';
import { useSessionData } from '../../context/SessionContext';
import { useTeam } from '../../context/TeamContext';
import {
  ApiProject,
  ApiTeam,
  getProjects,
  getWarehouseAlerting,
  WarehouseAlertingData,
  AlertRecipient,
  AlertConnection
} from '../../services/api';
import { Project } from '../../types';
import TeamNode, { TEAM_NODE_MAX_VISIBLE_ROWS, TEAM_NODE_WIDTH, TeamNodeData } from './TeamNode';
import RecipientNode, { RecipientNodeData } from './RecipientNode';

const nodeTypes = {
  teamNode: TeamNode,
  recipientNode: RecipientNode,
};

type HealthLevel = 'excellent' | 'good' | 'fair' | 'critical';

type WarehouseProject = ApiProject & {
  sessionsTotal: number;
  sessionsLast7Days: number;
  errorsLast7Days: number;
  errorsTotal: number;
  crashesTotal: number;
  anrsTotal: number;
  avgUxScoreAllTime: number;
  apiErrorsTotal: number;
  apiTotalCount: number;
  rageTapTotal: number;
  healthScore: number;
  healthLevel: HealthLevel;
};

type EnrichedWarehouseProject = WarehouseProject & {
  teamLabel: string;
};

const UNASSIGNED_TEAM_ID = '__unassigned__';
const UNKNOWN_TEAM_LABEL = 'Unassigned Projects';
const WAREHOUSE_CACHE_TTL_MS = 60_000;

const TEAM_NODE_HEADER_HEIGHT = 46;
const TEAM_NODE_ROW_HEIGHT = 46;
const TEAM_NODE_EMPTY_HEIGHT = 56;
const TEAM_NODE_FOOTER_HEIGHT = 28;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 56;
const CANVAS_PADDING = 80;
const RECIPIENT_COLUMN_WIDTH = 300;
const RECIPIENT_NODE_HEIGHT = 48; // Estimate
const MAX_COLUMNS = 4;

let warehouseProjectsCache: { projects: WarehouseProject[]; cachedAt: number } | null = null;
let warehouseProjectsInFlight: Promise<WarehouseProject[]> | null = null;
let warehouseAlertingCache: { data: WarehouseAlertingData; cachedAt: number } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeHealthScore(project: {
  sessionsTotal: number;
  errorsTotal: number;
  crashesTotal: number;
  anrsTotal: number;
  avgUxScoreAllTime: number;
  apiErrorsTotal: number;
  apiTotalCount: number;
  rageTapTotal: number;
}): number {
  if (project.sessionsTotal <= 0) return 60;
  const hasAnyMetricSignal = (
    project.avgUxScoreAllTime > 0
    || project.errorsTotal > 0
    || project.crashesTotal > 0
    || project.anrsTotal > 0
    || project.apiTotalCount > 0
    || project.rageTapTotal > 0
  );
  if (!hasAnyMetricSignal) return 65;

  const sessionsCount = Math.max(1, project.sessionsTotal);
  const errorRate = project.errorsTotal / sessionsCount;
  const crashAnrRate = (project.crashesTotal + project.anrsTotal) / sessionsCount;
  const rageTapRate = project.rageTapTotal / sessionsCount;
  const apiErrorRate = project.apiTotalCount > 0 ? project.apiErrorsTotal / project.apiTotalCount : 0;

  const uxScore = project.avgUxScoreAllTime > 0 ? project.avgUxScoreAllTime : 70;
  const reliabilityScore = clamp(100 - (errorRate * 120), 0, 100);
  const stabilityScore = clamp(100 - (crashAnrRate * 250), 0, 100);
  const apiReliabilityScore = project.apiTotalCount > 0
    ? clamp(100 - (apiErrorRate * 140), 0, 100)
    : 85;
  const interactionStabilityScore = clamp(100 - (rageTapRate * 160), 0, 100);

  const score = (
    (uxScore * 0.35)
    + (reliabilityScore * 0.2)
    + (stabilityScore * 0.25)
    + (apiReliabilityScore * 0.15)
    + (interactionStabilityScore * 0.05)
  );

  return Math.round(clamp(score, 0, 100));
}

function getHealthLevel(score: number): HealthLevel {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'critical';
}

function estimateNodeHeight(projectCount: number): number {
  if (projectCount <= 0) {
    return TEAM_NODE_HEADER_HEIGHT + TEAM_NODE_EMPTY_HEIGHT;
  }

  const visibleRows = Math.min(projectCount, TEAM_NODE_MAX_VISIBLE_ROWS);
  const footerHeight = projectCount > TEAM_NODE_MAX_VISIBLE_ROWS ? TEAM_NODE_FOOTER_HEIGHT : 0;
  return TEAM_NODE_HEADER_HEIGHT + (visibleRows * TEAM_NODE_ROW_HEIGHT) + footerHeight;
}

function getColumnCount(totalNodes: number, viewportWidth: number, hasRecipients: boolean): number {
  if (totalNodes <= 1) return 1;

  const offset = hasRecipients ? RECIPIENT_COLUMN_WIDTH : 0;
  const usableWidth = Math.max(
    TEAM_NODE_WIDTH,
    viewportWidth - (CANVAS_PADDING * 2) - offset,
  );
  const maxByWidth = Math.max(
    1,
    Math.floor((usableWidth + HORIZONTAL_GAP) / (TEAM_NODE_WIDTH + HORIZONTAL_GAP)),
  );

  return Math.max(1, Math.min(MAX_COLUMNS, maxByWidth, totalNodes));
}

function toProjectModel(project: WarehouseProject): Project {
  const platforms = (project.platforms || []).filter(
    (platform): platform is 'ios' | 'android' => platform === 'ios' || platform === 'android',
  );

  return {
    id: project.id,
    name: project.name,
    platforms,
    bundleId: project.bundleId || '',
    packageName: project.packageName,
    teamId: project.teamId,
    publicKey: project.publicKey,
    rejourneyEnabled: project.rejourneyEnabled ?? true,
    recordingEnabled: project.recordingEnabled,
    maxRecordingMinutes: project.maxRecordingMinutes,
    createdAt: project.createdAt,
    sessionsLast7Days: project.sessionsLast7Days,
    errorsLast7Days: project.errorsLast7Days,
    avgUxScore: 0,
  };
}

function normalizeWarehouseProjects(projects: ApiProject[]): WarehouseProject[] {
  return projects.map((project) => {
    const normalized: WarehouseProject = {
      ...project,
      sessionsTotal: project.sessionsTotal ?? 0,
      sessionsLast7Days: project.sessionsLast7Days ?? 0,
      errorsLast7Days: project.errorsLast7Days ?? 0,
      errorsTotal: project.errorsTotal ?? 0,
      crashesTotal: project.crashesTotal ?? 0,
      anrsTotal: project.anrsTotal ?? 0,
      avgUxScoreAllTime: project.avgUxScoreAllTime ?? 0,
      apiErrorsTotal: project.apiErrorsTotal ?? 0,
      apiTotalCount: project.apiTotalCount ?? 0,
      rageTapTotal: project.rageTapTotal ?? 0,
      healthScore: project.healthScore ?? 0,
      healthLevel: project.healthLevel ?? 'fair',
    };

    if (normalized.healthScore <= 0) {
      normalized.healthScore = computeHealthScore(normalized);
      normalized.healthLevel = getHealthLevel(normalized.healthScore);
    }

    return normalized;
  });
}

async function fetchWarehouseProjects(): Promise<WarehouseProject[]> {
  if (warehouseProjectsInFlight) return warehouseProjectsInFlight;

  warehouseProjectsInFlight = getProjects()
    .then((projects) => normalizeWarehouseProjects(projects))
    .finally(() => {
      warehouseProjectsInFlight = null;
    });

  return warehouseProjectsInFlight;
}

const WarehouseContent: React.FC = () => {
  const demoMode = useDemoMode();
  const { teams, currentTeam, setCurrentTeam } = useTeam();
  const { selectedProject, setSelectedProject } = useSessionData();
  const { fitView } = useReactFlow();
  const navigate = useNavigate();
  const location = useLocation();

  const [warehouseProjects, setWarehouseProjects] = useState<WarehouseProject[]>([]);
  const [alertingData, setAlertingData] = useState<WarehouseAlertingData | null>(null);
  const [selectedWarehouseProjectId, setSelectedWarehouseProjectId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() => (
    typeof window === 'undefined' ? 1440 : window.innerWidth
  ));

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const pathPrefix = useMemo(
    () => (location.pathname.startsWith('/demo') ? '/demo' : '/dashboard'),
    [location.pathname],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loadProjects = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;

    try {
      if (demoMode.isDemoMode) {
        // ... demo mode logic (simplified for brevity, keeping existing)
        const demoProjects: WarehouseProject[] = demoMode.demoProjects.map((project) => ({
          ...project,
          id: project.id,
          name: project.name,
          bundleId: project.bundleId || undefined,
          packageName: project.packageName,
          teamId: project.teamId,
          platforms: project.platforms,
          publicKey: project.publicKey,
          rejourneyEnabled: project.rejourneyEnabled ?? true,
          recordingEnabled: project.recordingEnabled,
          sampleRate: 1,
          maxRecordingMinutes: project.maxRecordingMinutes,
          sessionsTotal: project.sessionsLast7Days ?? 0,
          sessionsLast7Days: project.sessionsLast7Days ?? 0,
          errorsLast7Days: project.errorsLast7Days ?? 0,
          errorsTotal: project.errorsLast7Days ?? 0,
          crashesTotal: 0,
          anrsTotal: 0,
          avgUxScoreAllTime: 70,
          apiErrorsTotal: 0,
          apiTotalCount: 0,
          rageTapTotal: 0,
          healthScore: 70,
          healthLevel: 'good',
          createdAt: project.createdAt,
          updatedAt: project.createdAt,
        }));

        setWarehouseProjects(demoProjects);
        setAlertingData({ recipients: [], connections: [], projectStatuses: {} }); // No alerts in demo for now
        return;
      }

      if (!force && warehouseProjectsCache && Date.now() - warehouseProjectsCache.cachedAt < WAREHOUSE_CACHE_TTL_MS) {
        setWarehouseProjects(warehouseProjectsCache.projects);
        // Also load alerting if available
        if (warehouseAlertingCache) setAlertingData(warehouseAlertingCache.data);
      } else {
        const [normalizedProjects, alertData] = await Promise.all([
          fetchWarehouseProjects(),
          getWarehouseAlerting().catch(() => ({ recipients: [], connections: [], projectStatuses: {} })),
        ]);

        warehouseProjectsCache = { projects: normalizedProjects, cachedAt: Date.now() };
        setWarehouseProjects(normalizedProjects);
        setAlertingData(alertData);
      }
    } catch (err) {
      console.error('Failed to load warehouse projects:', err);
    }
  }, [demoMode.isDemoMode, demoMode.demoProjects]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const refreshHandler = () => {
      loadProjects({ force: true });
    };

    window.addEventListener('projectCreated', refreshHandler);
    window.addEventListener('teamCreated', refreshHandler);

    return () => {
      window.removeEventListener('projectCreated', refreshHandler);
      window.removeEventListener('teamCreated', refreshHandler);
    };
  }, [loadProjects]);

  const enrichedProjects = useMemo<EnrichedWarehouseProject[]>(() => {
    return warehouseProjects.map((project) => {
      const teamLabel = project.teamId
        ? teams.find((team) => team.id === project.teamId)?.name || `Team ${project.teamId.slice(0, 8)}`
        : UNKNOWN_TEAM_LABEL;

      return {
        ...project,
        teamLabel,
      };
    });
  }, [warehouseProjects, teams]);

  useEffect(() => {
    if (enrichedProjects.length === 0) {
      setSelectedWarehouseProjectId(null);
      return;
    }

    if (selectedWarehouseProjectId && enrichedProjects.some((project) => project.id === selectedWarehouseProjectId)) {
      return;
    }

    if (selectedProject?.id && enrichedProjects.some((project) => project.id === selectedProject.id)) {
      setSelectedWarehouseProjectId(selectedProject.id);
      return;
    }

    setSelectedWarehouseProjectId(enrichedProjects[0].id);
  }, [enrichedProjects, selectedProject?.id, selectedWarehouseProjectId]);

  const syncProjectContext = useCallback(
    (project: ApiProject) => {
      const normalizedProject = normalizeWarehouseProjects([project])[0];
      setSelectedWarehouseProjectId(normalizedProject.id);

      const projectTeam = normalizedProject.teamId
        ? teams.find((team) => team.id === normalizedProject.teamId) || null
        : null;

      if (projectTeam && currentTeam?.id !== projectTeam.id) {
        setCurrentTeam(projectTeam);
      }

      setSelectedProject(toProjectModel(normalizedProject));
      navigate(`${pathPrefix}/issues`);
    },
    [teams, currentTeam?.id, setCurrentTeam, setSelectedProject, navigate, pathPrefix],
  );

  useEffect(() => {
    if (enrichedProjects.length === 0 && teams.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const projectsByTeam = new Map<string, EnrichedWarehouseProject[]>();
    for (const project of enrichedProjects) {
      const teamKey = project.teamId || UNASSIGNED_TEAM_ID;
      if (!projectsByTeam.has(teamKey)) {
        projectsByTeam.set(teamKey, []);
      }
      projectsByTeam.get(teamKey)?.push(project);
    }

    const teamList = [...teams];
    const unassignedProjects = projectsByTeam.get(UNASSIGNED_TEAM_ID) || [];

    const allNodesData: { id: string; name: string; projects: EnrichedWarehouseProject[]; team?: ApiTeam }[] = teamList
      .map((team) => ({
        id: team.id,
        name: team.name?.trim() || `Team ${team.id.slice(0, 8)}`,
        team,
        projects: projectsByTeam.get(team.id) || [],
      }))
      .filter((nodeData) => nodeData.projects.length > 0);

    if (unassignedProjects.length > 0) {
      allNodesData.push({
        id: UNASSIGNED_TEAM_ID,
        name: UNKNOWN_TEAM_LABEL,
        projects: unassignedProjects,
        team: undefined,
      });
    } else if (allNodesData.length === 0 && enrichedProjects.length > 0) {
      allNodesData.push({
        id: UNASSIGNED_TEAM_ID,
        name: UNKNOWN_TEAM_LABEL,
        projects: enrichedProjects,
        team: undefined,
      });
    }

    allNodesData.sort((a, b) => {
      if (a.team?.id === currentTeam?.id) return -1;
      if (b.team?.id === currentTeam?.id) return 1;
      return a.name.localeCompare(b.name);
    });

    if (allNodesData.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // --- Recipient Nodes Logic ---
    const recipients = alertingData?.recipients || [];
    const connections = alertingData?.connections || [];
    const hasRecipients = recipients.length > 0;

    // Sort recipients by connection count
    const recipientConnectionCounts = new Map<string, number>();
    connections.forEach(c => {
      recipientConnectionCounts.set(c.recipientId, (recipientConnectionCounts.get(c.recipientId) || 0) + 1);
    });

    const sortedRecipients = [...recipients].sort((a, b) => {
      const countA = recipientConnectionCounts.get(a.id) || 0;
      const countB = recipientConnectionCounts.get(b.id) || 0;
      return countB - countA;
    });

    const recipientNodes: Node<RecipientNodeData>[] = sortedRecipients.map((recipient, index) => ({
      id: recipient.id,
      type: 'recipientNode',
      position: {
        x: CANVAS_PADDING,
        y: CANVAS_PADDING + (index * (RECIPIENT_NODE_HEIGHT + 12)),
      },
      data: {
        userId: recipient.id,
        email: recipient.email,
        displayName: recipient.displayName,
        avatarUrl: recipient.avatarUrl,
        connectionCount: recipientConnectionCounts.get(recipient.id) || 0,
      },
    }));

    // --- Team Nodes Logic ---
    const columns = getColumnCount(allNodesData.length, viewportWidth, hasRecipients);
    const rowHeights: number[] = [];

    allNodesData.forEach((data, index) => {
      const row = Math.floor(index / columns);
      const height = estimateNodeHeight(data.projects.length);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, height);
    });

    const rowStarts: number[] = [];
    let cursorY = CANVAS_PADDING;
    rowHeights.forEach((height, row) => {
      rowStarts[row] = cursorY;
      cursorY += height + VERTICAL_GAP;
    });

    const teamNodes: Node<TeamNodeData>[] = allNodesData.map((data, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);

      const xOffset = hasRecipients ? RECIPIENT_COLUMN_WIDTH : 0;

      return {
        id: data.id,
        type: 'teamNode',
        position: {
          x: CANVAS_PADDING + xOffset + (col * (TEAM_NODE_WIDTH + HORIZONTAL_GAP)),
          y: rowStarts[row] ?? CANVAS_PADDING,
        },
        data: {
          team: data.team,
          name: data.name,
          projects: data.projects,
          selectedProjectId: selectedWarehouseProjectId,
          onSelectProject: syncProjectContext,
        },
      };
    });

    // --- Edges Logic ---
    const newEdges = connections.map(conn => ({
      id: `edge-${conn.recipientId}-${conn.projectId}`,
      source: conn.recipientId,
      target: allNodesData.find(d => d.projects.some(p => p.id === conn.projectId))?.id || '',
      targetHandle: `project-handle-${conn.projectId}`,
      type: 'default',
      animated: true,
      style: { stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '5,5', strokeOpacity: 0.4 },
    })).filter(e => e.target !== '');

    setNodes([...recipientNodes, ...teamNodes]);
    setEdges(newEdges);

    // Initial fit view only - subsequent updates shouldn't jolt camera
    // We can use a ref to track if initial fit happened
    if (nodes.length === 0) {
      const frame = window.requestAnimationFrame(() => {
        fitView({ padding: 0.12, duration: 350 });
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    enrichedProjects,
    teams,
    currentTeam?.id,
    viewportWidth,
    selectedWarehouseProjectId,
    syncProjectContext,
    setNodes,
    setEdges,
    fitView,
    alertingData, // Add alertingData dependency
  ]);

  return (
    <div className="relative h-full w-full bg-[#f8fafc]">
      <div className="pointer-events-none absolute left-4 top-4 z-20">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white/95 p-1 shadow-sm backdrop-blur">
          <button
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
                return;
              }
              navigate(`${pathPrefix}/issues`);
            }}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            title="Back"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <button
            onClick={() => navigate(`${pathPrefix}/issues`)}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            title="Home"
          >
            <Home className="h-3.5 w-3.5" />
            Home
          </button>
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        panOnScroll
        panOnDrag={[1, 2]}
        zoomOnPinch
        zoomOnScroll
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        selectNodesOnDrag={false}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#94a3b8" variant={BackgroundVariant.Dots} gap={24} size={2} />
      </ReactFlow>
    </div>
  );
};

export const Warehouse: React.FC = () => {
  return (
    <ReactFlowProvider>
      <WarehouseContent />
    </ReactFlowProvider>
  );
};

export default Warehouse;
