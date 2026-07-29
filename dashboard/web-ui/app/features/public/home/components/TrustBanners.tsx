import React from 'react';
import { Droplet } from 'lucide-react';
import { EuFlag } from './EuFlag';
import {
    MarkAngular,
    MarkFlutter,
    MarkGatsby,
    MarkHydrogen,
    MarkNextJs,
    MarkReactNative,
    MarkRedux,
    MarkRemix,
    MarkShopify,
    MarkSvelte,
    MarkSwift,
    MarkVue,
} from './PlatformMarks';
import type { MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const pillBadgeClass =
    'inline-flex h-10 w-auto items-center justify-center gap-2 rounded-full border-2 border-black bg-white px-4 font-mono text-[11px] font-black uppercase tracking-wider text-black shadow-neo-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-neo hover:bg-[#ecfeff] whitespace-nowrap shrink-0';
const badgeIconClass = 'h-4 w-4 shrink-0';
const badgeFlagClass = 'h-4 w-6 shrink-0';

const supportedPlatforms = [
    { label: 'Next.js / React', icon: MarkNextJs, iconColor: '' },
    { label: 'Redux Toolkit', icon: MarkRedux, iconColor: 'text-[#764abc]' },
    { label: 'React Native / Expo', icon: MarkReactNative, iconColor: 'text-[#2563eb]' },
    { label: 'Flutter', icon: MarkFlutter, iconColor: 'text-[#54c5f8]' },
    { label: 'Swift', icon: MarkSwift, iconColor: 'text-[#f97316]' },
    { label: 'Vue / Nuxt', icon: MarkVue, iconColor: 'text-[#42b883]' },
    { label: 'Angular', icon: MarkAngular, iconColor: 'text-[#dd0031]' },
    { label: 'SvelteKit', icon: MarkSvelte, iconColor: 'text-[#ff3e00]' },
    { label: 'Remix', icon: MarkRemix, iconColor: '' },
    { label: 'Gatsby', icon: MarkGatsby, iconColor: 'text-[#663399]' },
    { label: 'Shopify', icon: MarkShopify, iconColor: 'text-[#95bf47]' },
    { label: 'Hydrogen', icon: MarkHydrogen, iconColor: 'text-[#00a878]' },
];

export const TrustBanners: React.FC<{ copy: MarketingHomeCopy['trust'] }> = ({ copy }) => {
    return (
        <section
            aria-label={copy.ariaLabel}
            className="relative w-full overflow-hidden border-b-2 border-black bg-[#5dadec] px-4 py-6 text-black sm:px-6 lg:px-8"
        >
            <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-4 text-center">
                {/* Fluid Pill Badge Wrap Container */}
                <div className="flex w-full flex-wrap items-center justify-center gap-2.5 sm:gap-3">
                    {supportedPlatforms.map((platform) => {
                        const IconComponent = platform.icon;
                        return (
                            <span key={platform.label} className={pillBadgeClass}>
                                <IconComponent className={`${badgeIconClass} ${platform.iconColor}`} />
                                <span>{platform.label}</span>
                            </span>
                        );
                    })}
                </div>

                {/* Trust Row Pills */}
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 border-t border-black/20 pt-4">
                    <span className="inline-flex h-9 w-auto items-center justify-center gap-2 rounded-full border-2 border-black bg-[#86efac] px-4 font-mono text-[10px] font-black uppercase tracking-wider text-black shadow-neo-sm">
                        <EuFlag className={badgeFlagClass} />
                        {copy.gdpr}
                    </span>
                    <span className="inline-flex h-9 w-auto items-center justify-center gap-2 rounded-full border-2 border-black bg-white px-4 font-mono text-[10px] font-black uppercase tracking-wider text-black shadow-neo-sm">
                        <Droplet className={`${badgeIconClass} fill-[#5dadec] text-[#5dadec]`} strokeWidth={0} />
                        {copy.sdkSize}
                    </span>
                </div>
            </div>
        </section>
    );
};
