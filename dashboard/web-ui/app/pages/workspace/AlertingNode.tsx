import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Mail, Bell } from 'lucide-react';

export type AlertingNodeData = {
    projectId: string;
    onNavigate: (projectId: string) => void;
};

export default memo(({ data }: NodeProps<AlertingNodeData>) => {
    return (
        <div className="w-[200px] overflow-hidden rounded-xl border border-rose-200 bg-white shadow-xl shadow-rose-100/50 transition-all hover:shadow-2xl hover:shadow-rose-200/50">
            <Handle
                type="target"
                position={Position.Left}
                className="!bg-rose-500"
            />

            <header className="flex items-center gap-2 border-b border-rose-100 bg-rose-50/50 px-4 py-2">
                <Bell className="h-3.5 w-3.5 text-rose-600" />
                <span className="text-xs font-bold text-rose-900 uppercase tracking-wider">Alerting</span>
            </header>

            <div className="bg-white">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onNavigate(data.projectId);
                    }}
                    className="group w-full px-3 py-2 text-left transition-colors hover:bg-rose-50 flex items-center gap-2"
                >
                    <Mail className="h-3.5 w-3.5 text-slate-400 group-hover:text-rose-500 transition-colors" />
                    <span className="text-xs font-medium text-slate-600 group-hover:text-rose-700 transition-colors">Emails</span>
                </button>
            </div>
        </div>
    );
});
