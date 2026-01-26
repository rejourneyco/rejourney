import React from 'react';

interface IPhoneFrameProps {
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
    showButtons?: boolean;
    className?: string;
}

/**
 * Neo-brutalist iPhone frame
 * Thick borders, hard shadows, no gradient nonsense
 */
export const IPhoneFrame: React.FC<IPhoneFrameProps> = ({
    children,
    size = 'md',
    showButtons = true, // Kept for API compatibility but ignoring visual buttons to reduce clutter
    className = '',
}) => {
    // Size configurations
    const sizeConfig = {
        sm: { width: 'w-[140px]', height: 'aspect-[9/19.5]', bezel: 'p-[4px]' },
        md: { width: 'w-[180px]', height: 'aspect-[9/19.5]', bezel: 'p-[6px]' },
        lg: { width: 'w-[220px]', height: 'aspect-[9/19.5]', bezel: 'p-[8px]' },
    };

    const config = sizeConfig[size];

    return (
        <div className={`relative ${config.width} ${className}`}>
            {/* Hard Frame */}
            <div
                className={`${config.height} rounded-[2rem] bg-black ${config.bezel} relative overflow-hidden shadow-[8px_8px_0_0_rgba(0,0,0,1)] border-2 border-black`}
            >
                {/* Screen Area */}
                <div className="relative w-full h-full rounded-[1.7rem] overflow-hidden bg-white border border-black">
                    {/* Notch / Dynamic Island placeholder (Simplified) */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[30%] h-[16px] bg-black rounded-full z-20 pointer-events-none" />

                    {/* Screen Content */}
                    <div className="absolute inset-0 bg-white overflow-hidden">
                        {children}
                    </div>

                    {/* Home Indicator */}
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-[40%] h-[4px] bg-black rounded-full z-20 pointer-events-none" />
                </div>
            </div>
        </div>
    );
};

export default IPhoneFrame;
