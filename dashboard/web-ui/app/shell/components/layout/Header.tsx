import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '~/shared/ui/core/Button';
import { useAuth } from '~/shared/providers/AuthContext';
import { Github, Menu, X } from 'lucide-react';
import {
  MARKETING_LOCALES,
  getLocalizedPublicPath,
  getMarketingHomeCopy,
} from '~/shared/lib/internationalMarketing';

export const Header: React.FC<{ variant?: 'floating' | 'full'; noSpacer?: boolean }> = ({ variant = 'floating', noSpacer = false }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const navigationLocale = MARKETING_LOCALES.en;
  const copy = getMarketingHomeCopy(navigationLocale).header;
  const engineeringPath = getLocalizedPublicPath(navigationLocale, "/engineering");
  const docsPath = getLocalizedPublicPath(navigationLocale, "/docs/web/getting-started");
  const pricingPath = getLocalizedPublicPath(navigationLocale, "/pricing");
  const selfHostedPath = getLocalizedPublicPath(navigationLocale, "/docs/selfhosted");
  const publicNavLinkClass = "text-[14px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors duration-200";
  const mobileNavLinkClass = "inline-flex shrink-0 items-center gap-1.5 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-1.5 font-sans text-xs font-semibold text-slate-600 dark:text-slate-100 rounded-full transition hover:border-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm";
  
  const isHomePage = location.pathname === "/";

  return (
    <>
      <header
        aria-label={copy.ariaLabel}
        className={
          variant === 'floating'
            ? "fixed inset-x-0 top-4 z-[100] mx-auto w-[92%] max-w-7xl rounded-full border border-slate-200/80 dark:border-slate-900 bg-white/80 dark:bg-slate-950/80 px-4 py-2 backdrop-blur-md shadow-md transition-all duration-305 hover:shadow-lg"
            : "fixed inset-x-0 top-0 z-[100] w-full border-b border-slate-200/80 dark:border-slate-900 bg-white/90 dark:bg-slate-950/90 px-6 py-2 backdrop-blur-md shadow-sm transition-all duration-305"
        }
      >
        <div
          className={
            variant === 'floating'
              ? "mx-auto flex h-12 w-full items-center justify-between gap-3 px-2"
              : "mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-3 px-2"
          }
        >
          <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity group">
            <div className="flex h-8 w-8 items-center justify-center transition-transform group-hover:rotate-3">
              <img src="/rejourneyIcon-removebg-preview.png" alt={copy.logoAlt} className="h-8 w-8 object-contain" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-950 dark:text-slate-100 transition-colors">Rejourney</span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex xl:gap-8">
            <Link
              to={docsPath}
              className={publicNavLinkClass}
            >
              {copy.docs}
            </Link>
            <Link
              to={pricingPath}
              className={publicNavLinkClass}
            >
              {copy.pricing}
            </Link>
            <Link
              to={engineeringPath}
              className={publicNavLinkClass}
            >
              {copy.engineering}
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="https://github.com/rejourneyco/rejourney"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.github}
              className="hidden h-9 w-9 items-center justify-center border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-350 transition-all hover:border-slate-350 dark:hover:border-white hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full sm:inline-flex shadow-sm"
            >
              <Github className="h-4 w-4" />
            </a>
            {!isAuthenticated && (
              <Link to="/login" className="hidden sm:inline-flex text-[14px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors duration-200 mr-1">
                {copy.login}
              </Link>
            )}
            <Link to={isAuthenticated ? "/dashboard" : "/login"} className="hidden sm:inline-flex">
              <Button variant="ghost" className="font-sans font-semibold text-sm px-4.5 py-2 border border-slate-950 dark:border-slate-800 bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 hover:!text-white dark:hover:!text-slate-950 transition-all duration-200 rounded-full shadow-sm">
                {isAuthenticated ? copy.dashboard : "Get started"}
              </Button>
            </Link>

            {/* Hamburger Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex lg:hidden h-9 w-9 items-center justify-center border border-slate-200 dark:border-slate-850 text-slate-600 dark:text-slate-350 hover:text-slate-900 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition shadow-sm"
              aria-label="Toggle navigation menu"
            >
              {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Cabinet */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-[60px] z-50 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 shadow-xl animate-fade-in-down lg:hidden">
            <nav className="flex flex-col gap-4 text-left">
              <Link to={docsPath} onClick={() => setIsOpen(false)} className="text-sm font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors">
                {copy.docs}
              </Link>
              <Link to={pricingPath} onClick={() => setIsOpen(false)} className="text-sm font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors">
                {copy.pricing}
              </Link>
              <Link to={engineeringPath} onClick={() => setIsOpen(false)} className="text-sm font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors">
                {copy.engineering}
              </Link>
              
              <div className="h-px bg-slate-100 dark:bg-slate-900 my-2" />
              
              <div className="flex flex-col gap-3">
                {!isAuthenticated && (
                  <Link to="/login" onClick={() => setIsOpen(false)} className="flex items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 py-2 border border-slate-200 dark:border-slate-850 rounded-full bg-slate-50 dark:bg-slate-900">
                    {copy.login}
                  </Link>
                )}
                <Link to={isAuthenticated ? "/dashboard" : "/login"} onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full font-sans font-semibold text-sm py-2 border border-slate-950 dark:border-slate-800 bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 hover:!text-white dark:hover:!text-slate-950 transition-all duration-200 rounded-full text-center shadow-sm">
                    {isAuthenticated ? copy.dashboard : "Get started"}
                  </Button>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>
      {!isHomePage && !noSpacer && (
        <div
          aria-hidden="true"
          className={variant === 'floating' ? "h-24 shrink-0" : "h-16 shrink-0"}
        />
      )}

    </>
  );
};
