import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { api, CrashReport } from '../../services/api';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { useSessionData } from '../../context/SessionContext';
import { Badge } from '../../components/ui/Badge';
import {
    ArrowLeft,
    Play,
    Smartphone,
    Calendar,
    Copy,
    Check,
    Server,
    Bug,
    Activity,
    AlertOctagon
} from 'lucide-react';

export const CrashDetail: React.FC<{ crashId?: string; projectId?: string }> = ({ crashId: propCrashId, projectId: propProjectId }) => {
    const { crashId: paramCrashId, projectId: paramProjectId } = useParams<{ crashId: string; projectId: string }>();
    const crashId = propCrashId || paramCrashId;
    const projectId = propProjectId || paramProjectId;
    const { projects } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const [crash, setCrash] = useState<CrashReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Validate project access from context (security + correctness)
    const currentProject = projects.find(p => p.id === projectId);

    useEffect(() => {
        if (!crashId || !currentProject) return;

        const fetchCrash = async () => {
            setLoading(true);
            try {
                const data = await api.getCrash(currentProject.id, crashId);
                setCrash(data);
            } catch (err: any) {
                console.error("Failed to load crash details:", err);
                setError("Failed to load crash details. It might be deleted or you don't have access.");
            } finally {
                setLoading(false);
            }
        };

        fetchCrash();
    }, [crashId, currentProject]);

    const handleCopyStack = () => {
        if (!crash?.stackTrace) return;
        navigator.clipboard.writeText(crash.stackTrace);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <div className="text-2xl font-black uppercase animate-pulse">Loading Crash Report...</div>
            </div>
        );
    }

    if (error || !crash) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <div className="text-red-600 font-black uppercase text-xl">{error || "Crash not found"}</div>
                <button
                    onClick={() => navigate(-1)}
                    className="px-6 py-2 bg-black text-white font-black uppercase hover:bg-slate-800 transition-colors"
                >
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6 md:p-12 font-sans">
            <div className="max-w-[1800px] mx-auto space-y-8">

                {/* Navigation */}
                <button
                    onClick={() => navigate(`${pathPrefix}/stability/crashes`)}
                    className="flex items-center gap-2 text-sm font-black uppercase text-slate-500 hover:text-black transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Crash List
                </button>

                {/* Header */}
                <div className="bg-white border-2 border-black p-8 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex items-start gap-6">
                            <div className="w-16 h-16 bg-red-600 border-2 border-black flex items-center justify-center shrink-0 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                                <Bug className="w-8 h-8 text-white" />
                            </div>
                            <div>
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                    <h1 className="text-3xl md:text-4xl font-black uppercase text-slate-900 tracking-tight leading-none">
                                        {crash.exceptionName}
                                    </h1>
                                    <Badge variant={crash.status === 'new' ? 'error' : 'neutral'} className="font-mono text-sm py-1">
                                        {crash.status}
                                    </Badge>
                                </div>
                                <p className="text-lg md:text-xl font-bold text-slate-600 font-mono border-l-4 border-slate-200 pl-4 py-1">
                                    {crash.reason}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-3 shrink-0">
                            <div className="text-right">
                                <div className="text-xs font-black uppercase text-slate-400">Occurred At</div>
                                <div className="text-lg font-bold font-mono">{new Date(crash.timestamp).toLocaleString()}</div>
                            </div>
                            <button
                                onClick={() => navigate(`${pathPrefix}/sessions/${crash.sessionId}`)}
                                className="flex items-center gap-2 px-6 py-3 bg-black text-white font-black uppercase hover:bg-slate-800 transition-colors shadow-[4px_4px_0_0_rgba(200,200,200,1)] hover:shadow-[4px_4px_0_0_rgba(0,0,0,0)] hover:translate-x-[2px] hover:translate-y-[2px]"
                            >
                                <Play className="w-4 h-4" /> Replay Session
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* Left Column: Stack Trace */}
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] p-6">
                            <div className="flex items-center justify-between mb-4 border-b-2 border-slate-100 pb-4">
                                <div className="flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-black" />
                                    <h2 className="text-xl font-black uppercase text-slate-900">Stack Trace</h2>
                                </div>
                                <button
                                    onClick={handleCopyStack}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-black uppercase border-2 border-slate-200 hover:border-black hover:bg-slate-50 transition-all"
                                >
                                    {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                    {copied ? 'Copied to Clipboard' : 'Copy Trace'}
                                </button>
                            </div>

                            <div className="bg-slate-900 text-green-400 p-6 font-mono text-xs overflow-x-auto whitespace-pre border-2 border-black shadow-inner min-h-[400px]">
                                {crash.stackTrace || "No stack trace available for this crash."}
                            </div>

                            <div className="mt-4 p-4 bg-amber-50 border-2 border-amber-200 text-amber-900 text-sm font-bold flex items-start gap-3">
                                <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
                                <p>
                                    This stack trace shows the execution path at the moment of the crash.
                                    Highlighted frames indicate your application code.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Metadata */}
                    <div className="space-y-6">
                        {/* Device Info */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                            <h2 className="text-lg font-black uppercase text-slate-900 mb-6 flex items-center gap-2">
                                <Smartphone className="w-5 h-5" /> Device Details
                            </h2>
                            <div className="space-y-4">
                                <div className="group">
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Model</div>
                                    <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                        {crash.deviceMetadata?.model || 'Unknown Device'}
                                    </div>
                                </div>
                                <div className="group">
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Operating System</div>
                                    <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                        {crash.deviceMetadata?.systemName} {crash.deviceMetadata?.systemVersion}
                                    </div>
                                </div>
                                <div className="group">
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Device ID</div>
                                    <div className="font-mono text-xs font-medium text-slate-500 bg-slate-50 p-2 border-2 border-slate-100 truncate group-hover:border-black transition-colors" title={crash.deviceMetadata?.identifierForVendor}>
                                        {crash.deviceMetadata?.identifierForVendor || 'N/A'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Session Info */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                            <h2 className="text-lg font-black uppercase text-slate-900 mb-6 flex items-center gap-2">
                                <Server className="w-5 h-5" /> Session Context
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Session ID</div>
                                    <div className="font-mono text-xs font-bold text-black break-all">
                                        {crash.sessionId}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Crash ID</div>
                                    <div className="font-mono text-xs font-medium text-slate-500 break-all">
                                        {crash.id}
                                    </div>
                                </div>
                                <div className="pt-4 border-t-2 border-slate-100">
                                    <button
                                        onClick={() => navigate(`${pathPrefix}/sessions/${crash.sessionId}`)}
                                        className="w-full py-2 bg-white border-2 border-black text-xs font-black uppercase hover:bg-black hover:text-white transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Play className="w-3 h-3" /> Jump to Session
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
