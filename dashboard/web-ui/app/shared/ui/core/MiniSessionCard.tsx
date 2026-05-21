import React, { useState, useEffect } from 'react';
import { Globe, Play } from 'lucide-react';
import { ModernPhoneFrame } from './ModernPhoneFrame';
import { formatLastSeen } from '~/shared/lib/formatDates';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';
import { getWebSessionEnvironment } from '~/shared/lib/webSessionEnvironment';
import { API_BASE_URL } from '~/shared/config/appConfig';

// Dynamic import for heic2any to avoid SSR window error
const convertHeic = async (blob: Blob): Promise<Blob> => {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
    return (Array.isArray(converted) ? converted[0] : converted) as Blob;
};

const COVER_BLOB_CACHE_TTL_MS = 5 * 60 * 1000;
const COVER_MISS_CACHE_TTL_MS = 60 * 1000;
const COVER_BLOB_CACHE_LIMIT = 120;
const coverBlobCache = new Map<string, { blob: Blob | null; timestamp: number }>();
const coverBlobInFlight = new Map<string, Promise<Blob | null>>();

function rememberCoverBlob(url: string, blob: Blob | null): Blob | null {
    coverBlobCache.set(url, { blob, timestamp: Date.now() });
    while (coverBlobCache.size > COVER_BLOB_CACHE_LIMIT) {
        const oldestKey = coverBlobCache.keys().next().value;
        if (!oldestKey) break;
        coverBlobCache.delete(oldestKey);
    }
    return blob;
}

async function loadCoverBlob(url: string): Promise<Blob | null> {
    const cached = coverBlobCache.get(url);
    if (cached) {
        const ttl = cached.blob ? COVER_BLOB_CACHE_TTL_MS : COVER_MISS_CACHE_TTL_MS;
        if (Date.now() - cached.timestamp < ttl) return cached.blob;
        coverBlobCache.delete(url);
    }

    const inFlight = coverBlobInFlight.get(url);
    if (inFlight) return inFlight;

    const promise = fetch(url, { credentials: 'include', redirect: 'follow' })
        .then(async (res) => {
            if (!res.ok) return rememberCoverBlob(url, null);

            const contentType = res.headers.get('Content-Type') || '';
            let blob = await res.blob();

            if (isHeicContentType(contentType)) {
                try {
                    blob = await convertHeic(blob);
                } catch {
                    return rememberCoverBlob(url, null);
                }
            }

            return rememberCoverBlob(url, blob);
        })
        .catch(() => rememberCoverBlob(url, null))
        .finally(() => {
            coverBlobInFlight.delete(url);
        });

    coverBlobInFlight.set(url, promise);
    return promise;
}

function isHeicContentType(contentType: string): boolean {
    const ct = contentType.toLowerCase();
    return ct.includes('heic') || ct.includes('heif');
}

interface MiniSessionCardProps {
    session: {
        id: string | null;
        deviceModel?: string;
        createdAt: string;
        coverPhotoUrl?: string | null; // URL from API response
        platform?: string | null;
        appVersion?: string | null;
        sdkVersion?: string | null;
        osVersion?: string | null;
        webLandingRoute?: string | null;
        metadata?: Record<string, unknown> | null;
        browser?: string | null;
        browserVersion?: string | null;
        networkType?: string | null;
        deviceInfo?: Record<string, unknown> | null;
    };
    onClick: () => void;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    showMeta?: boolean;
    className?: string;
}

export const MiniSessionCard: React.FC<MiniSessionCardProps> = ({
    session,
    onClick,
    size = 'sm',
    showMeta = true,
    className = '',
}) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const isWebSession = String(session.platform || '').toLowerCase() === 'web';
    const webEnvironment = isWebSession ? getWebSessionEnvironment(session) : null;
    const webChrome = webEnvironment?.osLabel.toLowerCase().startsWith('windows')
        ? 'windows'
        : webEnvironment?.osLabel.toLowerCase().startsWith('macos')
            ? 'macos'
            : 'other';
    const displayUrl = session.webLandingRoute || '/';

    // Prefer API-provided cover URL, but fall back to the standard cover endpoint when an id is available.
    // (404s are expected for sessions without visual artifacts; we treat them as "no preview".)
    const normalizedCoverPath = (() => {
        const raw = session.coverPhotoUrl && session.coverPhotoUrl.trim().length > 0
            ? session.coverPhotoUrl.trim()
            : (session.id ? `/api/sessions/cover/${session.id}` : null);
        if (!raw) return null;
        // Normalize legacy path: /api/sessions/:id/cover -> /api/sessions/cover/:id
        const legacyMatch = raw.match(/^\/api\/sessions\/([^/]+)\/cover$/);
        if (legacyMatch) return `/api/sessions/cover/${legacyMatch[1]}`;
        return raw;
    })();

    const coverUrl = normalizedCoverPath
        ? (normalizedCoverPath.startsWith('http')
            ? normalizedCoverPath
            : `${API_BASE_URL}${normalizedCoverPath}`)
        : null;

    useEffect(() => {
        if (!coverUrl) {
            setImageUrl(null);
            setImageLoaded(false);
            return;
        }
        let cancelled = false;
        let objectUrl: string | null = null;
        setImageUrl(null);
        setImageLoaded(false);

        loadCoverBlob(coverUrl)
            .then((blob) => {
                if (cancelled) return;
                if (!blob) {
                    setImageUrl(null);
                    setImageLoaded(false);
                    return;
                }
                objectUrl = URL.createObjectURL(blob);
                setImageUrl(objectUrl);
            })
            .catch(() => {
                // Silently handle errors - sessions without video artifacts are common
                if (cancelled) return;
                setImageUrl(null);
                setImageLoaded(false);
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [coverUrl]);

    const previewContent = imageUrl ? (
        <img
            src={imageUrl}
            alt="Session"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
        />
    ) : (
        <div className="absolute inset-0 bg-slate-50 flex items-center justify-center">
            <span className="text-[10px] font-bold text-slate-300 transform -rotate-45">NO PREVIEW</span>
        </div>
    );

    const playOverlay = (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <div className="w-8 h-8 bg-white/90 text-slate-900 rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-90 group-hover:scale-100">
                <Play size={14} fill="currentColor" className="ml-0.5" />
            </div>
        </div>
    );

    const webSizeConfig = {
        xs: 'w-[160px]',
        sm: 'w-[220px]',
        md: 'w-[280px]',
        lg: 'w-[360px]',
    }[size];

    return (
        <div
            onClick={onClick}
            className={`cursor-pointer group flex-shrink-0 transition-transform active:translate-x-[2px] active:translate-y-[2px] p-1 ${className}`}
        >
            {isWebSession ? (
                <div className={`relative ${webSizeConfig} overflow-hidden border-2 border-black bg-white shadow-lg ring-1 ring-black/10 transition-shadow duration-300 group-hover:shadow-xl`}>
                    {webChrome === 'windows' ? (
                        <div className="flex h-6 items-center border-b border-black/10 bg-[#f3f3f3]">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-[9px] font-semibold text-slate-500">
                                <Globe className="h-2.5 w-2.5 shrink-0 text-slate-400" />
                                <span className="truncate">{displayUrl}</span>
                            </div>
                            <div className="flex shrink-0 items-stretch text-[9px] text-slate-500">
                                <span className="flex h-6 w-5 items-center justify-center">-</span>
                                <span className="flex h-6 w-5 items-center justify-center">□</span>
                                <span className="flex h-6 w-5 items-center justify-center">x</span>
                            </div>
                        </div>
                    ) : (
                        <div className={`flex h-6 items-center gap-2 border-b border-black/10 px-2 ${webChrome === 'macos' ? 'bg-[#e8e8e8]' : 'bg-[#f0f0f0]'}`}>
                            {webChrome === 'macos' ? (
                                <div className="flex shrink-0 items-center gap-1">
                                    <span className="h-2 w-2 rounded-full bg-[#FF5F57]" />
                                    <span className="h-2 w-2 rounded-full bg-[#FFBD2E]" />
                                    <span className="h-2 w-2 rounded-full bg-[#28C840]" />
                                </div>
                            ) : null}
                            <div className="flex min-w-0 flex-1 items-center gap-1 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]">
                                <Globe className="h-2.5 w-2.5 shrink-0 text-slate-400" />
                                <span className="truncate">{displayUrl}</span>
                            </div>
                        </div>
                    )}
                    <div className="relative aspect-[16/10] overflow-hidden bg-white">
                        {previewContent}
                        {playOverlay}
                    </div>
                </div>
            ) : (
                <ModernPhoneFrame size={size} className="transition-shadow duration-300">
                    {previewContent}
                    {playOverlay}
                </ModernPhoneFrame>
            )}
            {showMeta && (
                <div className="mt-2">
                    <div
                        className="text-[10px] font-bold text-black truncate max-w-[140px] uppercase"
                        title={session.deviceModel}
                    >
                        {isWebSession ? webEnvironment?.browserLabel : formatDeviceModel(session.deviceModel)}
                    </div>
                    <div className="text-[9px] font-mono text-slate-500">
                        {isWebSession && webEnvironment?.osLabel ? webEnvironment.osLabel : formatLastSeen(session.createdAt)}
                    </div>
                </div>
            )}
        </div>
    );
};
