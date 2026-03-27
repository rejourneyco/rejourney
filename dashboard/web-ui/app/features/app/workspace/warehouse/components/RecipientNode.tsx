import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

export type RecipientNodeData = {
    userId: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    connectionCount: number;
};

export default memo(({ data }: NodeProps<RecipientNodeData>) => {
    const initials = (data.displayName || data.email || 'U').substring(0, 2).toUpperCase();

    return (
        <div className="relative flex items-center gap-2 rounded-full border border-slate-300 bg-white px-1.5 py-1.5 pr-3 shadow-sm transition-all hover:scale-105 hover:border-slate-400 hover:shadow-md">
            {/* Avatar Circle */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 ring-2 ring-white">
                {data.avatarUrl ? (
                    <img src={data.avatarUrl} alt={initials} className="h-full w-full rounded-full object-cover" />
                ) : (
                    initials
                )}
            </div>

            {/* Name/Email Label */}
            <div className="flex flex-col">
                <span className="max-w-[120px] truncate text-[11px] font-bold text-slate-800">
                    {data.displayName || data.email.split('@')[0]}
                </span>
                <span className="text-[9px] font-medium text-slate-500">
                    {data.connectionCount} project{data.connectionCount !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Connection Handle (Right) */}
            <Handle
                type="source"
                position={Position.Right}
                className="!h-2 !w-2 !bg-slate-400 transition-colors hover:!bg-indigo-500"
                style={{ right: -5 }}
            />
        </div>
    );
});
