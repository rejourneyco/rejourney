import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { Badge } from '../../components/ui/Badge';
import {
    Bug,
    ArrowLeft,
    Play,
    Smartphone,
    Calendar,
    Copy,
    Check,
    Code,
    Monitor,
    AlertTriangle,
    Server,
    Layers
} from 'lucide-react';
import { api } from '../../services/api';

interface JSErrorReport {
    id: string;
    sessionId: string;
    projectId: string;
    timestamp: string;
    errorType: string;
    errorName: string;
    message: string;
    stack?: string;
    screenName?: string;
    componentName?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
}

export const ErrorDetail: React.FC<{ errorId?: string; projectId?: string }> = ({ errorId: propErrorId, projectId: propProjectId }) => {
    const { errorId: paramErrorId, projectId: paramProjectId } = useParams<{ errorId: string; projectId: string }>();
    const errorId = propErrorId || paramErrorId;
    const projectId = propProjectId || paramProjectId;
    const { projects } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const [errorData, setErrorData] = useState<JSErrorReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const currentProject = projects.find(p => p.id === projectId);

    useEffect(() => {
        if (!errorId || !currentProject) return;

        const fetchErrorDetails = async () => {
            setLoading(true);
            try {
                const data = await api.getError(currentProject.id, errorId);
                setErrorData(data);
            } catch (err: any) {
                console.error("Failed to load error details:", err);
                setFetchError("Failed to load error details. It might be deleted or you don't have access.");
            } finally {
                setLoading(false);
            }
        };

        fetchErrorDetails();
    }, [errorId, currentProject]);

    const handleCopyStack = () => {
        const stackText = errorData?.stack || '';
        navigator.clipboard.writeText(stackText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getErrorTypeLabel = (errorType: string) => {
        switch (errorType) {
            case 'promise_rejection': return 'Promise Rejection';
            case 'unhandled_exception': return 'Unhandled Exception';
            case 'js_error': return 'JavaScript Error';
            default: return errorType;
        }
    };

    const getErrorTypeColor = (errorType: string) => {
        switch (errorType) {
            case 'promise_rejection': return 'bg-amber-500 text-white';
            case 'unhandled_exception': return 'bg-red-500 text-white';
            default: return 'bg-slate-800 text-white';
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <div className="text-2xl font-black uppercase animate-pulse">Loading Error Details...</div>
            </div>
        );
    }

    if (fetchError || !errorData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <div className="text-red-600 font-black uppercase text-xl">{fetchError || "Error not found"}</div>
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
                    onClick={() => navigate(`${pathPrefix}/stability/errors`)}
                    className="flex items-center gap-2 text-sm font-black uppercase text-slate-500 hover:text-black transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Error List
                </button>

                {/* Header */}
                <div className="bg-white border-2 border-black p-8 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex items-start gap-6">
                            <div className="w-16 h-16 bg-amber-500 border-2 border-black flex items-center justify-center shrink-0 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                                <Bug className="w-8 h-8 text-white" />
                            </div>
                            <div>
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                    <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-none font-mono">
                                        {errorData.errorName}
                                    </h1>
                                    <span className={`px-3 py-1 text-xs font-black uppercase border-2 border-black ${getErrorTypeColor(errorData.errorType)}`}>
                                        {getErrorTypeLabel(errorData.errorType)}
                                    </span>
                                </div>
                                <p className="text-lg font-bold text-slate-600 font-mono border-l-4 border-slate-200 pl-4 py-1 max-w-4xl">
                                    {errorData.message}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-3 shrink-0">
                            <div className="text-right">
                                <div className="text-xs font-black uppercase text-slate-400">Occurred At</div>
                                <div className="text-lg font-bold font-mono">{new Date(errorData.timestamp).toLocaleString()}</div>
                            </div>
                            <button
                                onClick={() => navigate(`${pathPrefix}/sessions/${errorData.sessionId}`)}
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
                                    <Code className="w-5 h-5 text-black" />
                                    <h2 className="text-xl font-black uppercase text-slate-900">Stack Trace</h2>
                                </div>
                                {errorData.stack && (
                                    <button
                                        onClick={handleCopyStack}
                                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-black uppercase border-2 border-slate-200 hover:border-black hover:bg-slate-50 transition-all"
                                    >
                                        {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                        {copied ? 'Copied' : 'Copy'}
                                    </button>
                                )}
                            </div>

                            <div className="bg-slate-900 text-green-400 p-6 font-mono text-xs overflow-x-auto whitespace-pre border-2 border-black shadow-inner min-h-[400px] leading-relaxed">
                                {errorData.stack || "No stack trace available for this error."}
                            </div>

                            <div className="mt-4 p-4 bg-slate-100 border-2 border-slate-200 text-slate-600 text-sm font-bold">
                                <p>
                                    Review the stack trace to identify the exact line of code where the error originated.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Metadata */}
                    <div className="space-y-6">
                        {/* Context Info */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                            <h2 className="text-lg font-black uppercase text-slate-900 mb-6 flex items-center gap-2">
                                <Layers className="w-5 h-5" /> Error Context
                            </h2>
                            <div className="space-y-4">
                                {errorData.screenName && (
                                    <div className="group">
                                        <div className="text-xs font-black uppercase text-slate-400 mb-1 flex items-center gap-1"><Monitor className="w-3 h-3" /> Active Screen</div>
                                        <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                            {errorData.screenName}
                                        </div>
                                    </div>
                                )}
                                {errorData.componentName && (
                                    <div className="group">
                                        <div className="text-xs font-black uppercase text-slate-400 mb-1 flex items-center gap-1"><Code className="w-3 h-3" /> Component</div>
                                        <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                            {errorData.componentName}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Device Info */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                            <h2 className="text-lg font-black uppercase text-slate-900 mb-6 flex items-center gap-2">
                                <Smartphone className="w-5 h-5" /> Environment
                            </h2>
                            <div className="space-y-4">
                                <div className="group">
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Device Model</div>
                                    <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                        {errorData.deviceModel || 'Unknown Device'}
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                    <div className="group flex-1">
                                        <div className="text-xs font-black uppercase text-slate-400 mb-1">OS Version</div>
                                        <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                            {errorData.osVersion || 'N/A'}
                                        </div>
                                    </div>
                                    <div className="group flex-1">
                                        <div className="text-xs font-black uppercase text-slate-400 mb-1">App Version</div>
                                        <div className="font-mono font-bold text-slate-900 bg-slate-50 p-2 border-2 border-slate-100 group-hover:border-black transition-colors">
                                            {errorData.appVersion || 'N/A'}
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
                                        {errorData.sessionId}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-black uppercase text-slate-400 mb-1">Error ID</div>
                                    <div className="font-mono text-xs font-medium text-slate-500 break-all">
                                        {errorData.id}
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

export default ErrorDetail;
