import React from 'react';

export const GermanFlag: React.FC<{ className?: string }> = ({ className = '' }) => (
    <svg viewBox="0 0 48 32" className={className} role="img" aria-label="German flag">
        <g clipPath="url(#de-flag-clip-path)">
            <rect width="48" height="32" fill="#FFCD05" />
            <rect width="48" height="21.333" fill="#ED1F24" />
            <rect width="48" height="10.667" fill="#141414" />
        </g>
        <defs>
            <clipPath id="de-flag-clip-path">
                <rect width="48" height="32" rx="6" />
            </clipPath>
        </defs>
    </svg>
);
