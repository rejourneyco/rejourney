import React from 'react';

interface ModernPhoneFrameProps {
    children: React.ReactNode;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
}

/**
 * Modern, sleek iPhone frame
 * Refined bezel with clear device appearance.
 */
export const ModernPhoneFrame: React.FC<ModernPhoneFrameProps> = ({
    children,
    size = 'md',
    className = '',
}) => {
    // Size configurations
    const sizeConfig = {
        xs: { width: 'w-[100px]', height: 'aspect-[9/19.5]', bezel: 'p-[3px]', notchW: '30%', notchH: '11px' },
        sm: { width: 'w-[140px]', height: 'aspect-[9/19.5]', bezel: 'p-[4px]', notchW: '28%', notchH: '16px' },
        md: { width: 'w-[180px]', height: 'aspect-[9/19.5]', bezel: 'p-[5px]', notchW: '28%', notchH: '18px' },
        lg: { width: 'w-[220px]', height: 'aspect-[9/19.5]', bezel: 'p-[6px]', notchW: '28%', notchH: '20px' },
    };

    const config = sizeConfig[size];

    return (
        <div className={`relative ${config.width} ${className}`}>
            {/* Device Frame */}
            <div
                className={`${config.height} rounded-[2rem] bg-black ${config.bezel} relative overflow-hidden shadow-lg ring-1 ring-black/20 transition-all duration-300 ease-out hover:shadow-xl`}
            >
                {/* Screen Container */}
                <div className="relative w-full h-full rounded-[1.7rem] overflow-hidden bg-white">
                    {/* Dynamic Island / Notch */}
                    <div 
                        className="absolute top-2 left-1/2 -translate-x-1/2 bg-black rounded-full z-20 pointer-events-none" 
                        style={{ width: config.notchW, height: config.notchH }}
                    />

                    {/* Content */}
                    <div className="absolute inset-0 bg-white overflow-hidden">
                        {children}
                    </div>

                    {/* Home Indicator */}
                    <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[35%] h-[4px] bg-black rounded-full z-20 pointer-events-none" />
                </div>
            </div>
        </div>
    );
};
