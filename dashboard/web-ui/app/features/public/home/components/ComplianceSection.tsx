import React from 'react';
import { Code2 } from 'lucide-react';
import { EuFlag } from './EuFlag';
import { GermanFlag } from './GermanFlag';

export const ComplianceSection: React.FC = () => {
    return (
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-semibold text-slate-600">
            <div className="flex items-center gap-1.5">
                <EuFlag className="h-3.5 w-5 shrink-0 rounded-xs shadow-xs" />
                <span>GDPR Compliant</span>
            </div>

            <span className="hidden h-3.5 w-px bg-slate-300/80 sm:inline-block" aria-hidden="true" />

            <div className="flex items-center gap-1.5">
                <GermanFlag className="h-3.5 w-5 shrink-0 rounded-xs shadow-xs" />
                <span>Hosted in Germany</span>
            </div>

            <span className="hidden h-3.5 w-px bg-slate-300/80 sm:inline-block" aria-hidden="true" />

            <div className="flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5 text-slate-700 shrink-0" strokeWidth={2} />
                <span>Open Source</span>
            </div>
        </div>
    );
};
