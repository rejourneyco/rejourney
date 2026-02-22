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
} from '../../services/api';
import { Project } from '../../types';
import TeamNode, { TEAM_NODE_MAX_VISIBLE_ROWS, TEAM_NODE_WIDTH, TeamNodeData } from './TeamNode';
import AlertingNode, { AlertingNodeData } from './AlertingNode';

const nodeTypes = {
  teamNode: TeamNode,
  alertingNode: AlertingNode,
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
const CANVAS_PADDING = 100;
const MAX_COLUMNS = 4;
// When alert nodes exist, reserve space so they don't overlap the next column
const ALERT_NODE_WIDTH = 200;
const GAP_TEAM_TO_ALERT = 40;
const GAP_AFTER_ALERT = 48;
const HORIZONTAL_GAP_WITH_ALERT = GAP_TEAM_TO_ALERT + ALERT_NODE_WIDTH + GAP_AFTER_ALERT; // 288

let warehouseProjectsCache: { projects: WarehouseProject[]; cachedAt: number } | null = null;
let warehouseProjectsInFlight: Promise<[WarehouseProject[], WarehouseAlertingData | { recipients: any[]; connections: any[]; projectStatuses: {} }]> | null = null;
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

function getColumnCount(totalNodes: number, viewportWidth: number, hasAlertNodes: boolean): number {
  if (totalNodes <= 1) return 1;

  const horizontalGap = hasAlertNodes ? HORIZONTAL_GAP_WITH_ALERT : HORIZONTAL_GAP;
  const columnStep = TEAM_NODE_WIDTH + horizontalGap;
  const usableWidth = Math.max(TEAM_NODE_WIDTH, viewportWidth - (CANVAS_PADDING * 2));
  const maxByWidth = Math.max(1, Math.floor((usableWidth + horizontalGap) / columnStep));

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
  const [isInitialized, setIsInitialized] = useState(false);
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

  // SWR Pattern: Render cache immediately, then fetch fresh data
  const loadProjects = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;

    if (demoMode.isDemoMode) {
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
      setAlertingData({ recipients: [], connections: [], projectStatuses: {} });
      return;
    }

    // 1. Render from cache immediately if available
    if (!force && warehouseProjectsCache) {
      setWarehouseProjects(warehouseProjectsCache.projects);
      if (warehouseAlertingCache) setAlertingData(warehouseAlertingCache.data);
    }

    // 2. Fetch fresh data (Revalidate) unless an equivalent request is already in flight
    if (warehouseProjectsInFlight) return;

    // Determine if we should skip fetch (only if we have cache AND it's very fresh, < 5s)
    const isCacheFresh = warehouseProjectsCache && (Date.now() - warehouseProjectsCache.cachedAt < 5000);
    if (!force && isCacheFresh) {
      return;
    }

    warehouseProjectsInFlight = Promise.all([
      getProjects().then(normalizeWarehouseProjects),
      getWarehouseAlerting().catch(() => ({ recipients: [], connections: [], projectStatuses: {} })),
    ]).finally(() => {
      warehouseProjectsInFlight = null;
    });

    try {
      const [normalizedProjects, alertData] = await warehouseProjectsInFlight;

      warehouseProjectsCache = { projects: normalizedProjects, cachedAt: Date.now() };
      warehouseAlertingCache = { data: alertData, cachedAt: Date.now() };

      setWarehouseProjects(normalizedProjects);
      setAlertingData(alertData);
    } catch (err) {
      console.error('Failed to load warehouse projects:', err);
    }
  }, [demoMode.isDemoMode, demoMode.demoProjects]);

  useEffect(() => {
    loadProjects({ force: true });
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
      navigate(`${pathPrefix}/general`);
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

    // --- Team Nodes Logic ---
    const connectedProjectIds = new Set(alertingData?.connections?.map(c => c.projectId) || []);
    const hasAlertNodes = connectedProjectIds.size > 0;
    const horizontalGap = hasAlertNodes ? HORIZONTAL_GAP_WITH_ALERT : HORIZONTAL_GAP;
    const columns = getColumnCount(allNodesData.length, viewportWidth, hasAlertNodes);
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

      return {
        id: data.id,
        type: 'teamNode',
        position: {
          x: CANVAS_PADDING + (col * (TEAM_NODE_WIDTH + horizontalGap)),
          y: rowStarts[row] ?? CANVAS_PADDING,
        },
        data: {
          team: data.team,
          name: data.name,
          projects: data.projects,
          selectedProjectId: selectedWarehouseProjectId,
          onSelectProject: syncProjectContext,
        },
        draggable: true,
      };
    });

    // --- Alerting Nodes ---
    const alertingNodes: Node<AlertingNodeData>[] = [];
    const alertingEdges: any[] = [];

    if (alertingData) {
      allNodesData.forEach((teamNodeData, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const baseX = CANVAS_PADDING + (col * (TEAM_NODE_WIDTH + horizontalGap));
        const baseY = rowStarts[row] ?? CANVAS_PADDING;

        teamNodeData.projects.forEach((proj, projIndex) => {
          if (projIndex >= TEAM_NODE_MAX_VISIBLE_ROWS) return;
          // Only show alert node when this project has alert recipients configured
          if (!connectedProjectIds.has(proj.id)) return;

          const projectY = baseY + TEAM_NODE_HEADER_HEIGHT + (projIndex * TEAM_NODE_ROW_HEIGHT) + (TEAM_NODE_ROW_HEIGHT / 2);
          const alertingNodeId = `alerting-${proj.id}`;
          alertingNodes.push({
            id: alertingNodeId,
            type: 'alertingNode',
            position: {
              x: baseX + TEAM_NODE_WIDTH + GAP_TEAM_TO_ALERT,
              y: projectY - 24,
            },
            data: {
              projectId: proj.id,
              onNavigate: (pid) => {
                syncProjectContext({ id: pid } as ApiProject);
                navigate(`${pathPrefix}/alerts/emails`);
              },
            },
            draggable: true,
          });
          alertingEdges.push({
            id: `edge-project-${proj.id}-alerting`,
            source: teamNodeData.id,
            sourceHandle: `project-source-${proj.id}`,
            target: alertingNodeId,
            type: 'default',
            animated: true,
            style: { stroke: '#fb7185', strokeWidth: 1.5, strokeDasharray: '4,4' },
          });
        });
      });
    }

    const nextNodes = [...teamNodes, ...alertingNodes];

    setNodes((prevNodes) => {
      if (prevNodes.length === 0) return nextNodes;

      const prevNodesMap = new Map(prevNodes.map(n => [n.id, n]));
      return nextNodes.map(node => {
        const existing = prevNodesMap.get(node.id);
        return existing ? { ...node, position: existing.position } : node;
      });
    });

    setEdges([...alertingEdges]);

    if (!isInitialized) {
      const timeoutId = setTimeout(() => {
        fitView({ padding: 0.2, minZoom: 0.25, maxZoom: 1.25, duration: 400 });
      }, 200);
      setIsInitialized(true);
      return () => clearTimeout(timeoutId);
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
    alertingData,
    isInitialized,
  ]);

  return (
    <div className="relative h-full w-full bg-[#f8fafc]">
      <div className="pointer-events-none absolute left-4 top-4 z-20">
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-slate-200/60 bg-white/50 p-1 shadow-sm backdrop-blur-sm transition-opacity hover:bg-white/80">
          <button
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
                return;
              }
              navigate(`${pathPrefix}/general`);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-4 w-[1px] bg-slate-200/60" />
          <button
            onClick={() => navigate(`${pathPrefix}/general`)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900"
            title="Home"
          >
            <Home className="h-4 w-4" />
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
        panOnDrag={true}
        zoomOnPinch={true}
        zoomOnScroll={true}
        zoomOnDoubleClick={false}
        nodesDraggable={true}
        nodesConnectable={false}
        selectNodesOnDrag={false}
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="#cbd5e1"
          variant={BackgroundVariant.Lines}
          gap={40}
          size={1}
          style={{ opacity: 0.4 }}
        />
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
