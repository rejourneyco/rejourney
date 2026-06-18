import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '~/shared/ui/core/Button';
import { useAuth } from '~/shared/providers/AuthContext';
import { ChevronDown, Github, Menu, Star, X } from 'lucide-react';
import {
  MARKETING_LOCALES,
  getLocalizedPublicPath,
  getMarketingHomeCopy,
} from '~/shared/lib/internationalMarketing';

const GITHUB_REPO_URL = 'https://github.com/rejourneyco/rejourney';
const GITHUB_REPO_API_URL = 'https://api.github.com/repos/rejourneyco/rejourney';
const FALLBACK_GITHUB_STARS = 146;

const FEATURE_GROUPS = [
  {
    title: "AI Workflows",
    items: [
      { label: "AI Funnel Leak Detection", href: "/ai-funnel-leak-detection", desc: "Automatically map, rank, and track revenue friction points" },
      { label: "Rejourney Marlin", href: "/rejourney-marlin", desc: "Use replay context to suggest GitHub code fixes for revenue leaks" },
      { label: "Self-Healing Software", href: "/self-healing-software", desc: "Turn repeated production friction into fix-ready repair loops" },
      { label: "Autonomous Debugging", href: "/autonomous-debugging", desc: "Let developer agents start from exact session context" },
      { label: "AI Agent Handoff", href: "/ai-agent-handoff", desc: "Pass diagnostic packets directly to Claude, Cursor, or Codex" },
    ]
  },
  {
    title: "Product Evidence",
    items: [
      { label: "Web Replay Evidence", href: "/web-session-replay", desc: "Track DOM mutations and console exceptions in web apps" },
      { label: "Mobile Replay Evidence", href: "/mobile-session-replay", desc: "Record native sessions on React Native and Swift" },
      { label: "Funnel Replay Evidence", href: "/funnel-replay-evidence", desc: "Drill directly into dropped-off sessions from funnels" },
      { label: "Heatmaps", href: "/heatmaps", desc: "Aggregate scroll maps, click patterns, and rage clicks" },
      { label: "Geographic Analytics", href: "/geographic-analytics", desc: "Visualize sentiment and infrastructure issues by country" },
    ]
  },
  {
    title: "Operational Insights",
    items: [
      { label: "Stability Monitoring", href: "/stability-monitoring", desc: "Group crashes, errors, ANRs, and API spikes with replay context" },
      { label: "API Endpoint Insights", href: "/api-endpoint-insights", desc: "Rank endpoints by latency, failure codes, volume, and user impact" },
      { label: "Device Insights", href: "/device-insights", desc: "Find device, OS, and app-version friction hidden in averages" },
      { label: "Revenue Recovery Analytics", href: "/revenue-recovery-analytics", desc: "Connect revenue metrics with session-level evidence" },
      { label: "Standardized Context", href: "/standardized-context", desc: "Format session data into LLM-friendly schemas" },
    ]
  }
];

const formatGithubStars = (stars: number) => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: stars >= 10000 ? 'compact' : 'standard',
}).format(stars);

export const Header: React.FC<{ variant?: 'floating' | 'full'; noSpacer?: boolean }> = ({ variant = 'floating', noSpacer = false }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [githubStars, setGithubStars] = useState(FALLBACK_GITHUB_STARS);
  const [isMobilePlatformOpen, setIsMobilePlatformOpen] = useState(false);
  const navigationLocale = MARKETING_LOCALES.en;
  const copy = getMarketingHomeCopy(navigationLocale).header;
  const docsPath = getLocalizedPublicPath(navigationLocale, "/docs/web/getting-started");
  const benchmarksPath = getLocalizedPublicPath(navigationLocale, "/benchmarks");
  const pricingPath = getLocalizedPublicPath(navigationLocale, "/pricing");
  const publicNavLinkClass = "text-base font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors duration-200";
  const mobileNavLinkClass = "inline-flex shrink-0 items-center gap-1.5 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-1.5 font-sans text-xs font-semibold text-slate-600 dark:text-slate-100 rounded-full transition hover:border-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm";
  
  const isHomePage = location.pathname === "/";

  useEffect(() => {
    let isMounted = true;

    fetch(GITHUB_REPO_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { stargazers_count?: number } | null) => {
        if (isMounted && typeof data?.stargazers_count === 'number') {
          setGithubStars(data.stargazers_count);
        }
      })
      .catch(() => {
        // Keep the baked-in fallback if GitHub is unavailable.
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
          <div className="flex items-center gap-6 lg:gap-8 xl:gap-10 h-full">
            <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity group shrink-0">
              <div className="flex h-8 w-8 items-center justify-center transition-transform group-hover:rotate-3">
                <img src="/rejourneyIcon-removebg-preview.png" alt={copy.logoAlt} className="h-8 w-8 object-contain" />
              </div>
              <span className="text-base font-bold tracking-tight text-slate-950 dark:text-slate-100 transition-colors">Rejourney</span>
            </Link>

            <nav className="hidden items-center gap-6 lg:flex xl:gap-8 h-full">
              <div className="relative group h-full flex items-center">
                <button
                  className={`${publicNavLinkClass} flex items-center gap-1.5 focus:outline-none cursor-pointer py-3`}
                  aria-expanded="false"
                  aria-haspopup="true"
                >
                  Platform
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 group-hover:rotate-180 text-slate-400 dark:text-slate-500" />
                </button>
                
                {/* Mega Menu Dropdown */}
                <div className="absolute left-0 top-full pt-3 w-[780px] lg:w-[840px] pointer-events-none opacity-0 translate-y-2 scale-[0.98] transition-all duration-300 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 z-50">
                  <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-lg p-6 shadow-xl grid grid-cols-3 gap-6">
                    {FEATURE_GROUPS.map((group) => (
                      <div key={group.title} className="flex flex-col gap-1">
                        <span className="px-2.5 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-550">
                          {group.title}
                        </span>
                        <div className="flex flex-col gap-1">
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              to={getLocalizedPublicPath(navigationLocale, item.href)}
                              className="group/item flex flex-col gap-0.5 rounded-xl p-2.5 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                            >
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover/item:text-blue-600 dark:group-hover/item:text-blue-400 transition-colors">
                                {item.label}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 leading-normal font-normal">
                                {item.desc}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
<Link
                to={benchmarksPath}
                className={publicNavLinkClass}
              >
                Benchmarks
              </Link>
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
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${copy.github}, ${formatGithubStars(githubStars)} stars`}
              className="hidden h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/60 px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-350 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-350 dark:hover:border-white dark:hover:bg-slate-800 md:inline-flex"
            >
              <Github className="h-4 w-4" />
              <span>GitHub</span>
              <span className="h-4 w-px bg-slate-200 dark:bg-slate-700/60" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-slate-600 dark:text-slate-300">
                <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
                {formatGithubStars(githubStars)}
              </span>
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
              <div>
                <button
                  onClick={() => setIsMobilePlatformOpen(!isMobilePlatformOpen)}
                  className="flex w-full items-center justify-between text-base font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors focus:outline-none py-1"
                >
                  <span>Platform</span>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isMobilePlatformOpen ? 'rotate-180' : ''} text-slate-400 dark:text-slate-500`} />
                </button>
                
                {isMobilePlatformOpen && (
                  <div className="mt-2 pl-3 border-l border-slate-100 dark:border-slate-900 flex flex-col gap-3.5">
                    {FEATURE_GROUPS.map((group) => (
                      <div key={group.title} className="flex flex-col gap-1.5 mt-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-550 px-1">
                          {group.title}
                        </span>
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            to={getLocalizedPublicPath(navigationLocale, item.href)}
                            onClick={() => {
                              setIsOpen(false);
                              setIsMobilePlatformOpen(false);
                            }}
                            className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white py-1 px-1 transition-colors"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Link to={docsPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors">
                {copy.docs}
              </Link>
              <Link to={benchmarksPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors">
                Benchmarks
              </Link>
              <Link to={pricingPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-600 dark:text-slate-350 hover:text-slate-950 dark:hover:text-white transition-colors">
                {copy.pricing}
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
