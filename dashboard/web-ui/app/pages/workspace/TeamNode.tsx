import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Database } from 'lucide-react';
import { ApiProject, ApiTeam } from '../../services/api';

type WarehouseProject = ApiProject & {
    sessionsTotal: number;
    sessionsLast7Days: number;
    errorsLast7Days: number;
    healthScore: number;
    healthLevel: 'excellent' | 'good' | 'fair' | 'critical';
};

export type TeamNodeData = {
    team?: ApiTeam;
    name: string;
    projects: WarehouseProject[];
    selectedProjectId: string | null;
    onSelectProject: (project: WarehouseProject) => void;
};

export const TEAM_NODE_MAX_VISIBLE_ROWS = 9;
export const TEAM_NODE_WIDTH = 360;

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function healthBadgeClasses(level: WarehouseProject['healthLevel']): string {
    if (level === 'excellent') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (level === 'good') return 'border-sky-300 bg-sky-50 text-sky-700';
    if (level === 'fair') return 'border-amber-300 bg-amber-50 text-amber-700';
    return 'border-rose-300 bg-rose-50 text-rose-700';
}

export default memo(({ data }: NodeProps<TeamNodeData>) => {
    return (
        <div className="w-[360px] overflow-hidden rounded-[2px] border-2 border-slate-900 bg-white shadow-[4px_4px_0_0_rgba(15,23,42,1)] transition-shadow hover:shadow-[6px_6px_0_0_rgba(15,23,42,1)]">
            <Handle type="target" position={Position.Top} className="!bg-slate-900 opacity-0" />

            <header className="flex items-center justify-between border-b-2 border-slate-900 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-slate-700" />
                    <span className="max-w-[212px] truncate text-sm font-bold text-slate-900">{data.name}</span>
                </div>
                <span className="text-[11px] font-bold text-slate-600">{data.projects.length}</span>
            </header>

            <div className="max-h-[315px] overflow-y-auto bg-white custom-scrollbar nodrag">
                {data.projects.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-400">No projects</div>
                ) : (
                    data.projects.slice(0, TEAM_NODE_MAX_VISIBLE_ROWS).map((project) => {
                        const isSelected = data.selectedProjectId === project.id;
                        const sessionsTotal = project.sessionsTotal ?? 0;

                        return (
                            <button
                                key={project.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onSelectProject(project);
                                }}
                                className={`group relative w-full border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${isSelected ? 'bg-sky-100' : 'hover:bg-slate-50'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-800">
                                        <span className={`h-2.5 w-2.5 border-2 ${isSelected ? 'border-slate-900 bg-sky-500' : 'border-slate-400'}`} />
                                        <span className="truncate font-medium">{project.name}</span>
                                    </span>
                                    <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold">
                                        <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-slate-600">
                                            {compactNumber.format(sessionsTotal)} sessions total
                                        </span>
                                        <span className={`rounded border px-1.5 py-0.5 ${healthBadgeClasses(project.healthLevel)}`}>
                                            Health {project.healthScore} {project.healthLevel}
                                        </span>
                                    </div>
                                </div>
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={`project-handle-${project.id}`}
                                    className="!bg-slate-300 opacity-0 transition-opacity group-hover:opacity-100"
                                    style={{ left: -6, top: '50%' }}
                                />
                            </button>
                        );
                    })
                )}
            </div>

            {data.projects.length > TEAM_NODE_MAX_VISIBLE_ROWS && (
                <footer className="border-t-2 border-slate-900 bg-slate-50 px-3 py-1.5 text-right text-[10px] font-bold text-slate-500">
                    +{data.projects.length - TEAM_NODE_MAX_VISIBLE_ROWS}
                </footer>
            )}

            <Handle type="source" position={Position.Bottom} className="!bg-slate-900 opacity-0" />
        </div>
    );
});
