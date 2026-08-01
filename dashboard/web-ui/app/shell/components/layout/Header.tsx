import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '~/shared/providers/AuthContext';
import { ChevronDown, Menu, Star, X } from 'lucide-react';
import {
  MARKETING_LOCALES,
  getLocalizedPublicPath,
  getMarketingHomeCopy,
  getMarketingLocaleFromPathname,
} from '~/shared/lib/internationalMarketing';
import {
  getLocalizedSeoPage,
  isSeoLocalizedLocaleCode,
  isSeoLocalizedPagePath,
} from '~/features/public/seo/seoLocalization';

const GITHUB_REPO_URL = 'https://github.com/rejourneyco/rejourney';
const GITHUB_REPO_API_URL = 'https://api.github.com/repos/rejourneyco/rejourney';
const FALLBACK_GITHUB_STARS = 146;

const LOCALIZED_HEADER_COPY = {
  ar: { platform: "المنتج", docs: "الوثائق", benchmarks: "المعايير", pricing: "الأسعار", login: "تسجيل الدخول", dashboard: "لوحة التحكم", getStarted: "ابدأ", engineering: "الهندسة", menuLabel: "فتح قائمة التنقل", groupTitles: ["المنصة", "أدلة المنتج", "الاستقرار"] },
  es: { platform: "Producto", docs: "Documentación", benchmarks: "Benchmarks", pricing: "Precios", login: "Iniciar sesión", dashboard: "Panel", getStarted: "Empezar", engineering: "Ingeniería", menuLabel: "Abrir navegación", groupTitles: ["Plataforma", "Evidencia de producto", "Estabilidad"] },
  fr: { platform: "Produit", docs: "Documentation", benchmarks: "Benchmarks", pricing: "Tarifs", login: "Connexion", dashboard: "Tableau de bord", getStarted: "Commencer", engineering: "Ingénierie", menuLabel: "Ouvrir la navigation", groupTitles: ["Plateforme", "Preuves produit", "Stabilité"] },
  de: { platform: "Produkt", docs: "Dokumentation", benchmarks: "Benchmarks", pricing: "Preise", login: "Anmelden", dashboard: "Dashboard", getStarted: "Starten", engineering: "Engineering", menuLabel: "Navigation öffnen", groupTitles: ["Plattform", "Produktbelege", "Stabilität"] },
} as const;

const FEATURE_GROUPS = [
  {
    title: "Platform",
    items: [
      { label: "How Rejourney Works", href: "/how-it-works", desc: "See how lightweight analytics connects product signals to session evidence" },
      { label: "Website Analytics", href: "/website-analytics", desc: "Understand website traffic, funnels, errors, and the sessions behind drop-offs" },
      { label: "App Analytics", href: "/app-analytics", desc: "Measure mobile engagement, retention, crashes, and the sessions behind every signal" },
      { label: "Rejourney Marlin", href: "/rejourney-marlin", desc: "Turn replay-backed product evidence into suggested GitHub fixes" },
    ]
  },
  {
    title: "Product Evidence",
    items: [
      { label: "Web Session Replay", href: "/web-session-replay", desc: "Connect browser behavior, product events, requests, and console context" },
      { label: "Mobile Session Replay", href: "/mobile-session-replay", desc: "Replay native sessions on Flutter, React Native, Expo, and iOS" },
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
  const navigationLocale = getMarketingLocaleFromPathname(location.pathname) ?? MARKETING_LOCALES.en;
  const copy = getMarketingHomeCopy(navigationLocale).header;
  const localizedLocaleCode = isSeoLocalizedLocaleCode(navigationLocale.code) ? navigationLocale.code : null;
  const localizedHeaderCopy = localizedLocaleCode ? LOCALIZED_HEADER_COPY[localizedLocaleCode] : null;
  const localizedFeatureGroups = localizedLocaleCode
    ? FEATURE_GROUPS.map((group, groupIndex) => ({
        ...group,
        title: localizedHeaderCopy?.groupTitles[groupIndex] ?? group.title,
        items: group.items.flatMap((item) => {
          if (!isSeoLocalizedPagePath(item.href)) return [];
          const localizedPage = getLocalizedSeoPage(localizedLocaleCode, item.href);
          return [{ ...item, href: localizedPage.localizedPath, label: localizedPage.h1, desc: localizedPage.intro }];
        }),
      })).filter((group) => group.items.length > 0)
    : FEATURE_GROUPS;
  const docsPath = getLocalizedPublicPath(navigationLocale, "/docs");
  const benchmarksPath = getLocalizedPublicPath(navigationLocale, "/benchmarks");
  const pricingPath = getLocalizedPublicPath(navigationLocale, "/pricing");
  const publicNavLinkClass = "inline-flex min-h-10 items-center rounded-none px-3.5 text-sm font-semibold text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none";
  const mobileNavLinkClass = "inline-flex shrink-0 items-center gap-1.5 border border-slate-200 bg-white px-4 py-1.5 font-sans text-sm font-semibold text-slate-600 rounded-none transition hover:bg-slate-50";
  
  const isHomePage = location.pathname === "/";

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const storageKey = 'rejourney.githubStars';

    const fetchStars = () => {
      fetch(GITHUB_REPO_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
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
          // Keep current fallback/cached value if offline.
        });
    };

    try {
      const cachedStars = Number(window.sessionStorage.getItem(storageKey));
      if (Number.isFinite(cachedStars) && cachedStars > 0) {
        setGithubStars(cachedStars);
      }
    } catch {
      // Session storage is optional.
    }

    fetchStars();
    const interval = setInterval(fetchStars, 30000);

    return () => {
      isMounted = false;
      controller.abort();
      clearInterval(interval);
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
    <div className={`${isBrutalistPage ? "" : "soft-border-scope"} max-w-full overflow-x-clip lg:overflow-visible`}>
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
              <span className="text-xl font-bold tracking-tight text-slate-950 transition-colors">Rejourney</span>
            </Link>

            <nav className="hidden items-center gap-1.5 lg:flex xl:gap-2 h-full">
              <div className="relative group h-full flex items-center">
                <button
                  className={`${publicNavLinkClass} flex items-center gap-1.5 cursor-pointer`}
                  aria-expanded="false"
                  aria-haspopup="true"
                >
                  {localizedHeaderCopy?.platform ?? "Platform"}
                  <ChevronDown className="h-4 w-4 text-slate-500 transition-transform duration-200 group-hover:rotate-180" />
                </button>
                
                {/* Mega Menu Dropdown */}
                <div className="absolute start-0 top-full pt-3 w-[780px] lg:w-[840px] pointer-events-none opacity-0 translate-y-2 scale-[0.98] transition-all duration-205 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 z-50">
                  <div className="rounded-none border border-black/20 bg-white p-6 shadow-neo grid grid-cols-3 gap-6">
                    {localizedFeatureGroups.map((group) => (
                      <div key={group.title} className="flex flex-col gap-1">
                        <span className="px-2.5 pb-2 text-[11px] font-black uppercase tracking-wider text-slate-800">
                          {group.title}
                        </span>
                        <div className="flex flex-col gap-1">
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              to={localizedLocaleCode ? item.href : getLocalizedPublicPath(navigationLocale, item.href)}
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
                to="/engineering"
                className={publicNavLinkClass}
              >
                {localizedHeaderCopy?.engineering ?? "Engineering"}
              </Link>
              <Link
                to={docsPath}
                className={publicNavLinkClass}
              >
                {localizedHeaderCopy?.docs ?? copy.docs}
              </Link>
              
              <Link
                to={pricingPath}
                className={publicNavLinkClass}
              >
                {localizedHeaderCopy?.pricing ?? copy.pricing}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">

            {!isAuthenticated && (
              <Link to="/login" className="hidden min-h-10 items-center rounded-none px-3.5 text-sm font-semibold text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 sm:inline-flex">
                {localizedHeaderCopy?.login ?? copy.login}
              </Link>
            )}
            <Link
              to={isAuthenticated ? "/dashboard" : "/login"}
              className="hidden min-h-10 items-center justify-center rounded-none bg-slate-900 px-5 py-2 font-sans text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-slate-800 sm:inline-flex"
            >
              {isAuthenticated ? (localizedHeaderCopy?.dashboard ?? copy.dashboard) : (localizedHeaderCopy?.getStarted ?? "Get started")}
            </Link>

            {/* Hamburger Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex lg:hidden h-9 w-9 items-center justify-center border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 rounded-none transition shadow-sm"
              aria-label={localizedHeaderCopy?.menuLabel ?? "Toggle navigation menu"}
            >
              {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Cabinet */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-[60px] z-50 max-w-full overflow-x-clip rounded-none border border-slate-200 bg-white p-5 shadow-sm lg:hidden">
            <nav className="flex flex-col gap-4 text-start">
              <div>
                <button
                  onClick={() => setIsMobilePlatformOpen(!isMobilePlatformOpen)}
                  className="flex w-full items-center justify-between text-base font-semibold text-slate-800 py-1 focus:outline-none"
                >
                  <span>{localizedHeaderCopy?.platform ?? "Platform"}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isMobilePlatformOpen ? 'rotate-180' : ''} text-slate-500`} />
                </button>
                
                {isMobilePlatformOpen && (
                  <div className="mt-2 ps-3 border-s border-black/30 flex flex-col gap-3.5">
                    {localizedFeatureGroups.map((group) => (
                      <div key={group.title} className="flex flex-col gap-1.5 mt-2">
                        <span className="text-xs font-semibold text-slate-500 px-1">
                          {group.title}
                        </span>
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            to={localizedLocaleCode ? item.href : getLocalizedPublicPath(navigationLocale, item.href)}
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

              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }}
                className="text-base font-semibold text-slate-800 transition-colors"
              >
                GitHub
              </a>
              <Link to="/engineering" onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-800 transition-colors">
                {localizedHeaderCopy?.engineering ?? "Engineering"}
              </Link>
              <Link to={docsPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-800 transition-colors">
                {localizedHeaderCopy?.docs ?? copy.docs}
              </Link>
              <Link to={benchmarksPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-800 transition-colors">
                {localizedHeaderCopy?.benchmarks ?? "Benchmarks"}
              </Link>
              <Link to={pricingPath} onClick={() => { setIsOpen(false); setIsMobilePlatformOpen(false); }} className="text-base font-semibold text-slate-800 transition-colors">
                {localizedHeaderCopy?.pricing ?? copy.pricing}
              </Link>
              
              <div className="h-px bg-slate-200 my-2" />
              
              <div className="flex flex-col gap-3">
                {!isAuthenticated && (
                  <Link to="/login" onClick={() => setIsOpen(false)} className="flex items-center justify-center text-sm font-semibold text-slate-700 py-2 border border-slate-200 rounded-none bg-white hover:bg-slate-50 transition-colors duration-200">
                    {localizedHeaderCopy?.login ?? copy.login}
                  </Link>
                )}
                <Link
                  to={isAuthenticated ? "/dashboard" : "/login"}
                  onClick={() => setIsOpen(false)}
                  className="flex min-h-10 items-center justify-center rounded-none bg-slate-900 px-5 py-2 font-sans text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-slate-800"
                >
                  {isAuthenticated ? (localizedHeaderCopy?.dashboard ?? copy.dashboard) : (localizedHeaderCopy?.getStarted ?? "Get started")}
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
