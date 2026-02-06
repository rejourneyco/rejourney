import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { Badge } from '../../components/ui/Badge';
import {
    Clock,
    ArrowLeft,
    Play,
    Smartphone,
    Copy,
    Check,
    AlertOctagon,
    Server,
    Activity,
    Download
} from 'lucide-react';
import { api } from '../../services/api';

interface ANRReport {
    id: string;
    sessionId: string;
    projectId: string;
    timestamp: string;
    durationMs: number;
    threadState: string;
    deviceMetadata?: {
        model?: string;
        manufacturer?: string;
        systemName?: string;
        systemVersion?: string;
        osVersion?: string;
        sdkInt?: number;
        [key: string]: any;
    };
    status: string;
    fullReport?: any;
}

export const ANRDetail: React.FC<{ anrId?: string; projectId?: string }> = ({ anrId: propAnrId, projectId: propProjectId }) => {
    const { anrId: paramAnrId, projectId: paramProjectId } = useParams<{ anrId: string; projectId: string }>();
    const anrId = propAnrId || paramAnrId;
    const projectId = propProjectId || paramProjectId;
    const { projects } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const [anr, setAnr] = useState<ANRReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const currentProject = projects.find(p => p.id === projectId);

    useEffect(() => {
        if (!anrId || !currentProject) return;

        const fetchANR = async () => {
            setLoading(true);
            try {
                const data = await api.getANR(currentProject.id, anrId);
                setAnr(data);
            } catch (err: any) {
                console.error("Failed to load ANR details:", err);
                setError("Failed to load ANR details. It might be deleted or you don't have access.");
            } finally {
                setLoading(false);
            }
        };

        fetchANR();
    }, [anrId, currentProject]);

    const handleCopyStack = () => {
        const stackText = anr?.threadState || anr?.fullReport?.threadState || '';
        navigator.clipboard.writeText(stackText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownloadStack = () => {
        const stackText = anr?.threadState || anr?.fullReport?.threadState || '';
        const blob = new Blob([stackText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `anr-trace-${anr?.id}-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <div className="text-2xl font-black uppercase animate-pulse">Loading ANR Event...</div>
            </div>
        );
    }

    if (error || !anr) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <div className="text-red-600 font-black uppercase text-xl">{error || "ANR not found"}</div>
                <button
                    onClick={() => navigate(-1)}
                    className="px-6 py-2 bg-black text-white font-black uppercase hover:bg-slate-800 transition-colors"
                >
                    Go Back
                </button>
            </div>
        );
    }

    const threadState = anr.threadState || anr.fullReport?.threadState || 'No thread state captured';
    const deviceMeta = anr.deviceMetadata || anr.fullReport?.deviceInfo || {};

    return (
        <div className="min-h-screen bg-slate-50 p-6 md:p-12 font-sans">
            <div className="max-w-[1800px] mx-auto space-y-8">

                {/* Navigation */}
                <button
                    onClick={() => navigate(`${pathPrefix}/stability/anrs`)}
                    className="flex items-center gap-2 text-sm font-black uppercase text-slate-500 hover:text-black transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to ANRs
                </button>

                {/* Header */}
                <div className="bg-white border-2 border-black p-8 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex items-start gap-6">
                            <div className="w-16 h-16 bg-purple-600 border-2 border-black flex items-center justify-center shrink-0 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                                <Clock className="w-8 h-8 text-white" />
                            </div>
                            <div>
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                    <h1 className="text-3xl md:text-4xl font-black uppercase text-slate-900 tracking-tight leading-none">
                                        App Not Responding
                                    </h1>
                                    <Badge variant={anr.status === 'open' ? 'error' : 'success'} className="font-mono text-sm py-1">
                                        {anr.status}
                                    </Badge>
                                </div>
                                <p className="text-lg md:text-xl font-bold text-slate-600 font-mono border-l-4 border-slate-200 pl-4 py-1">
                                    Main Thread Blocked for <span className="text-purple-600 border-b-2 border-purple-200">{anr.durationMs}ms</span>
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-3 shrink-0">
                            <div className="text-right">
                                <div className="text-xs font-black uppercase text-slate-400">Occurred At</div>
                                <div className="text-lg font-bold font-mono">{new Date(anr.timestamp).toLocaleString()}</div>
                            </div>
                            <button
                                onClick={() => navigate(`${pathPrefix}/sessions/${anr.sessionId}`)}
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
                                    <h2 className="text-xl font-black uppercase text-slate-900">Main Thread State</h2>
                                </div>
                                <button
                                    onClick={handleCopyStack}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-black uppercase border-2 border-slate-200 hover:border-black hover:bg-slate-50 transition-all"
                                >
                                    {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                    {copied ? 'Copied' : 'Copy Trace'}
                                </button>
                                <button
                                    onClick={handleDownloadStack}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-black uppercase border-2 border-slate-200 hover:border-black hover:bg-slate-50 transition-all ml-2"
                                >
                                    <Download className="w-3 h-3" />
                                    Download Trace
                                </button>
                            </div>

                            <div className="bg-slate-900 text-green-400 p-6 font-mono text-xs overflow-x-auto whitespace-pre border-2 border-black shadow-inner min-h-[400px] leading-relaxed">
                                {threadState}
                            </div>

                            <div className="mt-4 p-4 bg-purple-50 border-2 border-purple-200 text-purple-900 text-sm font-bold flex items-start gap-3">
                                <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
                                <p>
                                    This trace represents the state of the main thread when the freeze happened.
                                    Synchronous operations blocking the main thread will appear here.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Metadata */}
                    <div className="space-y-6">
                        {/* Device Info */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                            <h2 className="text-lg font-black uppercase text-slate-900 mb-6 flex items-center gap-2">
                                <Smartphone className="w-5 h-5" /> Device Environment
                            </h2>
                            <div className="space-y-4">
                                <div className="group">
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Model</div>
                                    <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                        {deviceMeta.model || deviceMeta.manufacturer || 'Unknown Device'}
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                    <div className="group flex-1">
                                        <div className="text-xs font-black uppercase text-slate-400 mb-1">System</div>
                                        <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                            {deviceMeta.systemName || 'Unknown'} {deviceMeta.systemVersion || deviceMeta.osVersion || ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Session Info */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                            <h2 className="text-lg font-black uppercase text-slate-900 mb-6 flex items-center gap-2">
                                <Server className="w-5 h-5" /> IDs
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Session ID</div>
                                    <div className="font-mono text-xs font-bold text-black break-all">
                                        {anr.sessionId}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">ANR ID</div>
                                    <div className="font-mono text-xs font-medium text-slate-500 break-all">
                                        {anr.id}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
