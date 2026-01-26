import React from 'react';

interface ProfessionalFrameProps {
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

/**
 * Professional, lightweight frame with sharp corners.
 * Abstracted from specific phone models to look like a pro utility.
 */
export const ProfessionalFrame: React.FC<ProfessionalFrameProps> = ({
    children,
    size = 'md',
    className = '',
}) => {
    // Size configurations (matching IPhoneFrame for layout consistency)
    const sizeConfig = {
        sm: { width: 'w-[140px]', height: 'aspect-[9/19.5]' },
        md: { width: 'w-[180px]', height: 'aspect-[9/19.5]' },
        lg: { width: 'w-[220px]', height: 'aspect-[9/19.5]' },
    };

    const config = sizeConfig[size];

    return (
        <div className={`relative ${config.width} ${className}`}>
            {/* Minimalist Frame */}
            <div
                className={`${config.height} rounded-sm bg-white relative overflow-hidden ring-1 ring-slate-200 shadow-sm`}
            >
                {/* Screen Content */}
                <div className="absolute inset-0 bg-white overflow-hidden">
                    {children}
                </div>

                {/* Subtle Overlay to give it depth without being a 'phone' */}
                <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5" />
            </div>
        </div>
    );
};

export default ProfessionalFrame;
