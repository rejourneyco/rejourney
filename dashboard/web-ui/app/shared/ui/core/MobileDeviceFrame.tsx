import React from 'react';

interface MobileDeviceFrameProps {
    children: React.ReactNode;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
}

/** Compact mobile-device frame for session previews. */
export const MobileDeviceFrame: React.FC<MobileDeviceFrameProps> = ({
    children,
    size = 'md',
    className = '',
}) => {
    const sizeConfig = {
        xs: { width: 'w-[100px]', height: 'aspect-[9/19.5]', bezel: 'p-[3px]', cutoutWidth: '30%', cutoutHeight: '11px' },
        sm: { width: 'w-[140px]', height: 'aspect-[9/19.5]', bezel: 'p-[4px]', cutoutWidth: '28%', cutoutHeight: '16px' },
        md: { width: 'w-[180px]', height: 'aspect-[9/19.5]', bezel: 'p-[5px]', cutoutWidth: '28%', cutoutHeight: '18px' },
        lg: { width: 'w-[220px]', height: 'aspect-[9/19.5]', bezel: 'p-[6px]', cutoutWidth: '28%', cutoutHeight: '20px' },
    };

    const config = sizeConfig[size];

    return (
        <div className={`relative ${config.width} ${className}`}>
            {/* Device shell */}
            <div
                className={`${config.height} rounded-[1.25rem] bg-black ${config.bezel} relative overflow-hidden shadow-lg ring-1 ring-black/20 transition-all duration-300 ease-out hover:shadow-xl`}
            >
                {/* Screen */}
                <div className="relative w-full h-full rounded-[1.1rem] overflow-hidden bg-white">
                    {/* Camera cutout */}
                    <div
                        className="absolute top-2 left-1/2 -translate-x-1/2 bg-black rounded-full z-20 pointer-events-none"
                        style={{ width: config.cutoutWidth, height: config.cutoutHeight }}
                    />

                    {/* Content */}
                    <div className="absolute inset-0 bg-white overflow-hidden">
                        {children}
                    </div>

                    {/* Gesture indicator */}
                    <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[35%] h-[4px] bg-black rounded-full z-20 pointer-events-none" />
                </div>
            </div>
        </div>
    );
};
