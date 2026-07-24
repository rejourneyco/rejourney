import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '~/shared/providers/AuthContext';
import { ChevronDown, Menu, X } from 'lucide-react';
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
      { label: "How Rejourney Works", href: "/how-it-works", desc: "See the end-to-end flow from session recording to AI code fix" },
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
      { label: "Mobile Replay Evidence", href: "/mobile-session-replay", desc: "Record native sessions on Flutter, React Native, and Swift" },
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

export const Header: React.FC<{ variant?: 'floating' | 'full'; noSpacer?: boolean }> = ({ variant = 'full', noSpacer = false }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [githubStars, setGithubStars] = useState(FALLBACK_GITHUB_STARS);
  const [isMobilePlatformOpen, setIsMobilePlatformOpen] = useState(false);
  const navigationLocale = MARKETING_LOCALES.en;
  const copy = getMarketingHomeCopy(navigationLocale).header;
  const docsPath = getLocalizedPublicPath(navigationLocale, "/docs");
  const benchmarksPath = getLocalizedPublicPath(navigationLocale, "/benchmarks");
  const pricingPath = getLocalizedPublicPath(navigationLocale, "/pricing");
  const publicNavLinkClass = "inline-flex min-h-10 items-center rounded-none px-3.5 text-[15px] font-black uppercase tracking-[-0.01em] text-black transition-all duration-200 hover:bg-[#ecfeff] hover:text-black focus-visible:outline-none border border-transparent hover:border-black/20 shadow-none hover:shadow-neo-sm";
  const mobileNavLinkClass = "inline-flex shrink-0 items-center gap-1.5 border border-black/20 bg-white px-4 py-1.5 font-sans text-xs font-black uppercase text-black rounded-none transition hover:bg-slate-100 shadow-neo-sm";
  
  const isHomePage = location.pathname === "/";

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    let idleHandle: number | null = null;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    const storageKey = 'rejourney.githubStars';

    const loadStars = () => {
      try {
        const cachedStars = Number(window.sessionStorage.getItem(storageKey));
        if (Number.isFinite(cachedStars) && cachedStars > 0) {
          setGithubStars(cachedStars);
          return;
        }
      } catch {
        // Session storage is optional.
      }

      fetch(GITHUB_REPO_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      })
        .then((response) => response.ok ? response.json() : null)
        .then((data: { stargazers_count?: number } | null) => {
          if (isMounted && typeof data?.stargazers_count === 'number') {
            setGithubStars(data.stargazers_count);
            try {
              window.sessionStorage.setItem(storageKey, String(data.stargazers_count));
            } catch {
              // Session storage is optional.
            }
          }
        })
        .catch(() => {
          // Keep the baked-in fallback if GitHub is unavailable.
        });
    };

    if ('requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(loadStars, { timeout: 3000 });
    } else {
      fallbackTimeout = globalThis.setTimeout(loadStars, 1500);
    }

    return () => {
      isMounted = false;
      controller.abort();
      if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
      if (fallbackTimeout !== null) globalThis.clearTimeout(fallbackTimeout);
    };
  }, []);

  const cleanPath = location.pathname.replace(/\/$/, "");
  const isBrutalistPage = cleanPath === "" ||
                          cleanPath.endsWith("/pricing") ||
                          cleanPath.endsWith("/login") ||
                          cleanPath === "/en" ||
                          cleanPath === "/es" ||
                          cleanPath === "/fr";

  return (
    <div className={isBrutalistPage ? "" : "soft-border-scope"}>
      <header
        aria-label={copy.ariaLabel}
        className={
          variant === 'floating'
            ? "fixed inset-x-0 top-4 z-[100] mx-auto w-[92%] max-w-7xl rounded-none border border-black/25 bg-white px-4 py-2 shadow-neo transition-all duration-200 hover:shadow-neo-lg"
            : "relative z-[100] w-full border-b border-slate-200/90 bg-white/95 px-4 py-1.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-xl transition-colors duration-200 sm:fixed sm:inset-x-0 sm:top-0 sm:px-6"
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
              <span className="text-[17px] font-black uppercase tracking-tight text-slate-950 transition-colors">Rejourney</span>
            </Link>

            <nav className="hidden items-center gap-1.5 lg:flex xl:gap-2 h-full">
              <div className="relative group h-full flex items-center">
                <button
                  className={`${publicNavLinkClass} flex items-center gap-1.5 cursor-pointer`}
                  aria-expanded="false"
                  aria-haspopup="true"
                >
                  Platform
                  <ChevronDown className="h-4 w-4 text-slate-500 transition-transform duration-200 group-hover:rotate-180" />
                </button>
                
                {/* Mega Menu Dropdown */}
                <div className="absolute left-0 top-full pt-3 w-[780px] lg:w-[840px] pointer-events-none opacity-0 translate-y-2 scale-[0.98] transition-all duration-205 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 z-50">
                  <div className="rounded-none border border-black/20 bg-white p-6 shadow-neo grid grid-cols-3 gap-6">
                    {FEATURE_GROUPS.map((group) => (
                      <div key={group.title} className="flex flex-col gap-1">
                        <span className="px-2.5 pb-2 text-[11px] font-black uppercase tracking-wider text-slate-800">
                          {group.title}
                        </span>
                        <div className="flex flex-col gap-1">
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              to={getLocalizedPublicPath(navigationLocale, item.href)}
                              className="group/item flex flex-col gap-0.5 rounded-none p-2.5 transition-colors duration-150 hover:bg-[#ecfeff]"
                            >
                              <span className="text-sm font-bold text-slate-900 group-hover/item:text-black transition-colors">
                                {item.label}
                              </span>
                              <span className="text-xs text-slate-600 leading-normal font-medium">
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
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={publicNavLinkClass}
              >
                GitHub
              </a>
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


            {!isAuthenticated && (
              <Link to="/login" className="hidden min-h-10 items-center rounded-none px-3.5 text-[15px] font-black uppercase text-black transition-all duration-200 hover:bg-slate-100 sm:inline-flex border border-transparent hover:border-black/20 shadow-none hover:shadow-neo-sm">
                {copy.login}
              </Link>
            )}
            <Link
              to={isAuthenticated ? "/dashboard" : "/login"}
              className="hidden min-h-10 items-center rounded-none border border-black bg-black px-5 py-2 font-sans text-[15px] font-black uppercase text-white shadow-neo-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-900 hover:shadow-neo active:translate-y-0 active:shadow-none sm:inline-flex"
            >
              {isAuthenticated ? copy.dashboard : "Get started"}
            </Link>

            {/* Hamburger Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex lg:hidden h-9 w-9 items-center justify-center border border-black text-black bg-white hover:bg-slate-50 rounded-none transition shadow-neo-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
              aria-label="Toggle navigation menu"
            >
              {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Cabinet */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-[60px] z-50 rounded-none border border-black/20 bg-white p-5 shadow-neo lg:hidden">
            <nav className="flex flex-col gap-4 text-left">
              <div>
                <button
                  onClick={() => setIsMobilePlatformOpen(!isMobilePlatformOpen)}
                  className="flex w-full items-center justify-between text-base font-black uppercase text-black py-1 focus:outline-none"
                >
                  <span>Platform</span>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isMobilePlatformOpen ? 'rotate-180' : ''} text-slate-500`} />
                </button>
                
                {isMobilePlatformOpen && (
                  <div className="mt-2 pl-3 border-l border-black/30 flex flex-col gap-3.5">
                    {FEATURE_GROUPS.map((group) => (
                      <div key={group.title} className="flex flex-col gap-1.5 mt-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-800 px-1">
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
                            className="text-sm font-bold text-slate-700 hover:text-black py-1 px-1 transition-colors"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Link to={docsPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-black uppercase text-black transition-colors">
                {copy.docs}
              </Link>
              <Link to={benchmarksPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-black uppercase text-black transition-colors">
                Benchmarks
              </Link>
              <Link to={pricingPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-black uppercase text-black transition-colors">
                {copy.pricing}
              </Link>
              
              <div className="h-0.5 bg-black/20 my-2" />
              
              <div className="flex flex-col gap-3">
                {!isAuthenticated && (
                  <Link to="/login" onClick={() => setIsOpen(false)} className="flex items-center justify-center text-sm font-black uppercase text-black py-2 border border-black rounded-none bg-white shadow-neo-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all duration-200">
                    {copy.login}
                  </Link>
                )}
                <Link
                  to={isAuthenticated ? "/dashboard" : "/login"}
                  onClick={() => setIsOpen(false)}
                  className="w-full rounded-none border border-black bg-black py-2 text-center font-sans text-sm font-black uppercase text-white shadow-neo-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-900 hover:shadow-neo active:translate-y-0 active:shadow-none"
                >
                  {isAuthenticated ? copy.dashboard : "Get started"}
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

      </div>
  );
};
