import React, { useState, useEffect } from 'react';
import { Play } from 'lucide-react';
import { ModernPhoneFrame } from './ModernPhoneFrame';
import { formatLastSeen } from '../../utils/formatDates';
import { API_BASE_URL } from '../../config';

// Dynamic import for heic2any to avoid SSR window error
const convertHeic = async (blob: Blob): Promise<Blob> => {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
    return (Array.isArray(converted) ? converted[0] : converted) as Blob;
};

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

    // Use coverPhotoUrl from API response. Don't auto-generate URL as many sessions lack video artifacts.
    // Pages that need cover photos should provide coverPhotoUrl explicitly.
    const coverUrl = session.coverPhotoUrl
        ? (session.coverPhotoUrl.startsWith('http')
            ? session.coverPhotoUrl
            : `${API_BASE_URL}${session.coverPhotoUrl}`)
        : null;

    useEffect(() => {
        if (!coverUrl) {
            setImageUrl(null);
            setImageLoaded(false);
            return;
        }
        let cancelled = false;
        setImageUrl(null);
        setImageLoaded(false);

        fetch(coverUrl, { credentials: 'include', redirect: 'follow' })
            .then(async res => {
                if (!res.ok) {
                    // Session may not have video artifacts (404 is expected for event-only sessions)
                    if (cancelled) return;
                    setImageUrl(null);
                    setImageLoaded(false);
                    return;
                }
                const contentType = res.headers.get('Content-Type') || '';
                let blob = await res.blob();
                if (cancelled) return;

                // Convert HEIC to JPEG if needed (browsers don't support HEIC natively)
                if (isHeicContentType(contentType)) {
                    try {
                        blob = await convertHeic(blob);
                    } catch (heicError) {
                        // Silently fail - will show placeholder
                        if (cancelled) return;
                        setImageUrl(null);
                        setImageLoaded(false);
                        return;
                    }
                }

                if (cancelled) return;
                setImageUrl(URL.createObjectURL(blob));
            })
            .catch(() => {
                // Silently handle errors - sessions without video artifacts are common
                if (cancelled) return;
                setImageUrl(null);
                setImageLoaded(false);
            });

        return () => { cancelled = true; };
    }, [coverUrl]);

    return (
        <div
            onClick={onClick}
            className={`cursor-pointer group flex-shrink-0 transition-transform active:translate-x-[2px] active:translate-y-[2px] p-1 ${className}`}
        >
            <ModernPhoneFrame size={size} className="transition-shadow duration-300">
                {imageUrl ? (
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
                )}
                {/* Play overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="w-8 h-8 bg-white/90 text-slate-900 rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-90 group-hover:scale-100">
                        <Play size={14} fill="currentColor" className="ml-0.5" />
                    </div>
                </div>
            </ModernPhoneFrame>
            {showMeta && (
                <div className="mt-2">
                    <div className="text-[10px] font-bold text-black truncate max-w-[140px] uppercase">
                        {session.deviceModel || 'Unknown Device'}
                    </div>
                    <div className="text-[9px] font-mono text-slate-500">
                        {formatLastSeen(session.createdAt)}
                    </div>
                </div>
            )}
        </div>
    );
};
