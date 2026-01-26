import React from 'react';

interface PhoneFrameProps {
    children: React.ReactNode;
    className?: string;
    /** Size multiplier (default 1 = 180px width) */
    scale?: number;
    /** Show side buttons (visual only) - not implemented in slim version */
    showButtons?: boolean;
}

/**
 * Realistic iPhone-style frame component with Dynamic Island
 */
export const PhoneFrame: React.FC<PhoneFrameProps> = ({
    children,
    className = '',
    scale = 1,
    showButtons = true, // Keep for API compatibility, not rendered
}) => {
    const baseWidth = 180;
    const baseHeight = 390;
    const width = baseWidth * scale;
    const height = baseHeight * scale;

    return (
        <div className={`relative inline-block ${className}`} style={{ width, height }}>
            {/* Outer frame (dark bezel) */}
            <div
                className="absolute inset-0 rounded-[2rem] bg-slate-900 shadow-xl"
                style={{ padding: 4 * scale }}
            >
                {/* Screen area */}
                <div className="w-full h-full bg-black rounded-[1.75rem] overflow-hidden relative">
                    {/* Dynamic Island notch */}
                    <div
                        className="absolute top-2 left-1/2 -translate-x-1/2 bg-black rounded-full z-20 flex items-center justify-center"
                        style={{
                            width: 48 * scale,
                            height: 12 * scale,
                        }}
                    >
                        {/* Camera dot */}
                        <div
                            className="rounded-full bg-slate-800"
                            style={{
                                width: 5 * scale,
                                height: 5 * scale,
                                marginLeft: 14 * scale,
                            }}
                        />
                    </div>

                    {/* Screen content */}
                    <div className="absolute inset-0 overflow-hidden">
                        {children}
                    </div>

                    {/* Home indicator */}
                    <div
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-white/30 rounded-full z-10"
                        style={{
                            width: 40 * scale,
                            height: 3 * scale,
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default PhoneFrame;
