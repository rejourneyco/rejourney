import React from 'react';
import { ArrowRight, Terminal } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { getLocalizedPublicPath, getMarketingLocaleFromPathname, type MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const CTA_ICON_CLASS = 'h-5 w-5 shrink-0';

export const EngineeringCTA: React.FC<{ copy: MarketingHomeCopy['engineeringCta'] }> = ({ copy }) => {
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const engineeringPath = getLocalizedPublicPath(locale, "/engineering");

    return (
        <section className="w-full border-t-2 border-black bg-[#f8fafc] text-black">
            <div className="relative w-full overflow-hidden px-4 py-16 sm:px-6 sm:py-32 lg:px-8">
<div
                    className="pointer-events-none absolute right-8 top-10 hidden h-24 w-72 rotate-[4deg] border-2 border-black bg-[#f9a8d4] shadow-neo-lg lg:block"
                    aria-hidden
                />
                <div
                    className="pointer-events-none absolute bottom-10 left-8 hidden h-20 w-64 rotate-[-3deg] border-2 border-black bg-[#86efac] shadow-neo-lg lg:block"
                    aria-hidden
                />

                <div className="relative z-10 mx-auto max-w-5xl border-2 border-black bg-white p-4 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:p-8 sm:shadow-[14px_14px_0px_0px_rgba(0,0,0,1)] lg:p-12">
                    <div className="mx-auto mb-6 flex max-w-xl flex-wrap justify-center gap-2 sm:mb-8">
                        {copy.badges.map((item, index) => (
                            <span
                                key={item}
                                className={`border-2 border-black px-3 py-1 text-[10px] font-mono font-black uppercase tracking-widest shadow-neo-sm ${
                                    index === 0 ? 'bg-[#5dadec]' : 'bg-[#fef08a]'
                                }`}
                            >
                                {item}
                            </span>
                        ))}
                    </div>

                    <h2 className="mx-auto mb-8 max-w-5xl break-words text-xl font-black uppercase leading-tight tracking-tight text-black sm:text-2xl md:text-3xl lg:text-4xl">
                        {copy.headingBefore}
                        <span className="text-[#5dadec]">
                            {' '}{copy.headingAccent}
                        </span>
                        {' '}{copy.headingAfter}
                    </h2>


                    <div className="flex flex-col justify-center gap-4 sm:flex-row">
                        <Link
                            to={engineeringPath}
                            className="flex w-full items-center justify-center gap-3 border-2 border-black bg-black px-4 py-4 text-xs font-black uppercase tracking-widest text-white shadow-[5px_5px_0px_0px_rgba(93,173,236,1)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#5dadec] hover:text-black hover:shadow-neo-lg active:translate-y-0 sm:w-auto sm:px-8 sm:text-base"
                        >
                            <Terminal className={CTA_ICON_CLASS} strokeWidth={3} aria-hidden />
                            {copy.primary}
                        </Link>

                        <Link
                            to="/login"
                            className="flex w-full items-center justify-center gap-3 border-2 border-black bg-[#fef08a] px-4 py-4 text-xs font-black uppercase tracking-widest text-black shadow-neo transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-neo-lg active:translate-y-0 sm:w-auto sm:px-8 sm:text-base"
                        >
                            {copy.secondary}
                            <ArrowRight className={CTA_ICON_CLASS} strokeWidth={3} aria-hidden />
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
};
