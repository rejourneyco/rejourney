import React from 'react';
import { Droplet, Globe } from 'lucide-react';
import { EuFlag } from './EuFlag';
import { MarkExpo, MarkFlutter, MarkReactNative, MarkSwift, MarkNextJs, MarkVue } from './PlatformMarks';
import type { MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const badgeClass =
    'inline-flex h-11 min-w-0 items-center justify-center gap-2 border-2 border-black bg-white px-3 font-mono text-[10px] font-black uppercase tracking-wider shadow-neo-sm sm:h-12 sm:px-5 sm:tracking-widest';
const badgeIconClass = 'h-5 w-5 shrink-0';
const badgeFlagClass = 'h-5 w-8 shrink-0';

export const TrustBanners: React.FC<{ copy: MarketingHomeCopy['trust'] }> = ({ copy }) => {
    return (
        <section
            aria-label={copy.ariaLabel}
            className="relative w-full overflow-hidden border-b-2 border-black bg-[#5dadec] px-4 py-5 text-black sm:px-6 lg:px-8"
        >
            <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-3">
                {/* Frameworks row */}
                <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:flex-nowrap sm:gap-3">
                    <span className={badgeClass}>
                        <MarkExpo className={badgeIconClass} />
                        {copy.expo}
                    </span>
                    <span className={badgeClass}>
                        <MarkReactNative className={`${badgeIconClass} text-[#2563eb]`} />
                        <span className="truncate">{copy.reactNative}</span>
                    </span>
                    <span className={badgeClass}>
                        <MarkFlutter className={`${badgeIconClass} text-[#54c5f8]`} />
                        Flutter
                    </span>
                    <span className={badgeClass}>
                        <MarkSwift className={`${badgeIconClass} text-[#f97316]`} />
                        {copy.swift}
                    </span>
                    <span className={badgeClass}>
                        <MarkNextJs className={badgeIconClass} />
                        Next.js
                    </span>
                    <span className={badgeClass}>
                        <MarkVue className={`${badgeIconClass} text-[#42b883]`} />
                        Vue / Nuxt
                    </span>
                    <span className={badgeClass}>
                        <Globe className={`${badgeIconClass} text-[#5dadec]`} />
                        Any JS Framework
                    </span>
                </div>

                {/* Trust row */}
                <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:gap-3">
                    <span className={`${badgeClass} bg-[#86efac]`}>
                        <EuFlag className={badgeFlagClass} />
                        {copy.gdpr}
                    </span>
                    <span className={badgeClass}>
                        <Droplet className={`${badgeIconClass} fill-[#5dadec] text-[#5dadec]`} strokeWidth={0} />
                        {copy.sdkSize}
                    </span>
                </div>
            </div>
        </section>
    );
};
