import React from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '~/shared/ui/core/Button';
import { useAuth } from '~/shared/providers/AuthContext';
import { Github } from 'lucide-react';
import { getLocalizedPublicPath, getMarketingHomeCopy, getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';

export const Header: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const locale = getMarketingLocaleFromPathname(location.pathname);
  const copy = getMarketingHomeCopy(location.pathname).header;
  const engineeringPath = getLocalizedPublicPath(locale, "/engineering");
  const docsPath = getLocalizedPublicPath(locale, "/docs/web/getting-started");
  const pricingPath = getLocalizedPublicPath(locale, "/pricing");
  const selfHostedPath = getLocalizedPublicPath(locale, "/docs/selfhosted");
  const roadmapPath = getLocalizedPublicPath(locale, "/roadmap");
  const publicNavLinkClass = "text-base font-bold uppercase tracking-wide hover:underline decoration-2 underline-offset-4 decoration-slate-900 text-slate-900 font-mono";
  const mobileNavLinkClass = "inline-flex shrink-0 items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 font-mono text-[11px] font-black uppercase text-slate-900 shadow-sm transition hover:border-black hover:bg-[#ecfeff]";

  return (
    <>
      <header aria-label={copy.ariaLabel} className="fixed inset-x-0 top-0 z-[100] border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-nowrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:max-w-[98%] lg:px-6">
          <Link to={locale.path} className="flex items-center gap-2 hover:opacity-80 transition-opacity group animate-scale-in">
            <div className="flex h-9 w-9 items-center justify-center transition-transform group-hover:rotate-6 sm:h-10 sm:w-10">
              <img src="/rejourneyIcon-removebg-preview.png" alt={copy.logoAlt} className="h-9 w-9 object-contain sm:h-10 sm:w-10" />
            </div>
            <span className="text-lg font-black tracking-tighter uppercase font-mono text-slate-900 group-hover:text-[#5dadec] transition-colors sm:text-xl">REJOURNEY</span>
          </Link>

          <nav className="hidden items-center gap-5 lg:flex xl:gap-8">
            <Link
              to={engineeringPath}
              className={publicNavLinkClass}
            >
              {copy.engineering}
            </Link>
            <Link
              to={docsPath}
              className={publicNavLinkClass}
            >
              {copy.docs}
            </Link>
            <Link
              to={roadmapPath}
              className={`relative ${publicNavLinkClass}`}
            >
              {copy.roadmap}
              <span className="absolute -right-4 -top-2 rotate-12 border border-black bg-[#f9a8d4] px-1 py-[1px] text-[8px] font-black uppercase leading-none text-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                {copy.newBadge}
              </span>
            </Link>
            <Link
              to={pricingPath}
              className={publicNavLinkClass}
            >
              {copy.pricing}
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-4">
            <Link to={selfHostedPath}>
              <Button variant="ghost" className="font-mono uppercase font-black text-sm px-6 py-2 border-2 border-transparent hover:border-black transition-all rounded-none hidden md:flex">
                {copy.selfHosted}
              </Button>
            </Link>
            <a
              href="https://github.com/rejourneyco/rejourney"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.github}
              className="hidden h-10 w-10 items-center justify-center border-2 border-transparent text-slate-900 transition-all hover:border-black hover:bg-[#ecfeff] md:inline-flex"
            >
              <Github className="h-5 w-5" />
            </a>
            <Link to={isAuthenticated ? "/dashboard/general" : "/login"}>
              <Button variant="ghost" className="font-mono uppercase font-black text-xs sm:text-sm px-3 sm:px-6 py-2 border-2 border-black bg-white text-black hover:bg-white hover:text-black hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] transition-all rounded-none">
                {isAuthenticated ? copy.dashboard : copy.login}
              </Button>
            </Link>
          </div>
        </div>
        <nav className="border-t border-slate-200 bg-white/90 lg:hidden" aria-label={copy.mobileAriaLabel}>
          <div className="no-scrollbar mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-4 py-2 sm:px-6">
            <Link to={engineeringPath} className={mobileNavLinkClass}>
              {copy.engineering}
            </Link>
            <Link to={docsPath} className={mobileNavLinkClass}>
              {copy.docs}
            </Link>
            <Link to={roadmapPath} className={`relative ${mobileNavLinkClass}`}>
              {copy.roadmap}
              <span className="ml-0.5 border border-black bg-[#f9a8d4] px-1 text-[8px] font-black leading-none text-black">
                {copy.newBadge}
              </span>
            </Link>
            <Link to={pricingPath} className={mobileNavLinkClass}>
              {copy.pricing}
            </Link>
            <Link to={selfHostedPath} className={mobileNavLinkClass}>
              {copy.selfHosted}
            </Link>
            <a
              href="https://github.com/rejourneyco/rejourney"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-[31px] w-[34px] shrink-0 items-center justify-center border border-slate-300 bg-white text-slate-900 shadow-sm transition hover:border-black hover:bg-[#ecfeff]"
              aria-label={copy.github}
            >
              <Github className="h-3.5 w-3.5" />
            </a>
          </div>
        </nav>
      </header>
      <div aria-hidden="true" className="h-[111px] shrink-0 lg:h-16" />
    </>
  );
};
