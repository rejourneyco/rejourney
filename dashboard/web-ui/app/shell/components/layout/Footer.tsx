import React from 'react';
import { Link, useLocation } from 'react-router';
import { useToast } from '~/shared/providers/ToastContext';
import { getLocalizedPublicPath, getMarketingHomeCopy, getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';
import {
  getLocalizedSeoPage,
  isSeoLocalizedLocaleCode,
  isSeoLocalizedPagePath,
} from '~/features/public/seo/seoLocalization';

const LOCALIZED_FOOTER_COPY = {
  ar: { summary: "تحليلات منتج خفيفة للويب والجوال تجمع إعادة الجلسات والمسارات والخرائط الحرارية والأعطال وأدلة API في مساحة واحدة.", product: "تحليلات المنتج", replay: "إعادة تشغيل الجلسات", resources: "الموارد", comparisons: "المقارنات", company: "الشركة", pricing: "الأسعار", demo: "العرض المباشر", guides: "الأدلة", engineering: "الهندسة", about: "عن Rejourney", contact: "اتصل بنا", login: "تسجيل الدخول", terms: "شروط الخدمة", privacy: "سياسة الخصوصية" },
  es: { summary: "Analítica de producto ligera para web y móvil con replay, embudos, mapas de calor, crashes y evidencia de API en un solo espacio.", product: "Analítica de producto", replay: "Replay de sesiones", resources: "Recursos", comparisons: "Comparaciones", company: "Empresa", pricing: "Precios", demo: "Demo en vivo", guides: "Guías", engineering: "Ingeniería", about: "Acerca de Rejourney", contact: "Contacto", login: "Iniciar sesión", terms: "Términos del servicio", privacy: "Privacidad" },
  fr: { summary: "Une analytics produit légère pour le web et le mobile, avec replay, funnels, heatmaps, crashs et preuves API dans un seul espace.", product: "Analytics produit", replay: "Replay de sessions", resources: "Ressources", comparisons: "Comparaisons", company: "Entreprise", pricing: "Tarifs", demo: "Démo en direct", guides: "Guides", engineering: "Ingénierie", about: "À propos", contact: "Contact", login: "Connexion", terms: "Conditions d’utilisation", privacy: "Confidentialité" },
  de: { summary: "Leichtgewichtige Produktanalyse für Web und Mobile mit Replay, Funnels, Heatmaps, Abstürzen und API-Belegen in einem Arbeitsbereich.", product: "Produktanalyse", replay: "Session Replay", resources: "Ressourcen", comparisons: "Vergleiche", company: "Unternehmen", pricing: "Preise", demo: "Live-Demo", guides: "Leitfäden", engineering: "Engineering", about: "Über Rejourney", contact: "Kontakt", login: "Anmelden", terms: "Nutzungsbedingungen", privacy: "Datenschutz" },
} as const;

export const Footer: React.FC = () => {
  const location = useLocation();
  const locale = getMarketingLocaleFromPathname(location.pathname);
  const copy = getMarketingHomeCopy(location.pathname).footer;
  const localizedLocaleCode = isSeoLocalizedLocaleCode(locale.code) ? locale.code : null;
  const localizedFooterCopy = localizedLocaleCode ? LOCALIZED_FOOTER_COPY[localizedLocaleCode] : null;
  const { showToast } = useToast();
  const docsPath = getLocalizedPublicPath(locale, "/docs");
  const webDocsPath = getLocalizedPublicPath(locale, "/docs/web/getting-started");
  const reactNativeDocsPath = getLocalizedPublicPath(locale, "/docs/reactnative/overview");
  const flutterDocsPath = getLocalizedPublicPath(locale, "/docs/flutter/overview");
  const swiftDocsPath = getLocalizedPublicPath(locale, "/docs/swift/overview");
  const engineeringPath = getLocalizedPublicPath(locale, "/engineering");
  const pricingPath = getLocalizedPublicPath(locale, "/pricing");
  const selfHostedPath = getLocalizedPublicPath(locale, "/docs/selfhosted");
  const localizeSeoLink = (item: { label: string; href: string }) => {
    if (!localizedLocaleCode || !isSeoLocalizedPagePath(item.href)) return item;
    const localizedPage = getLocalizedSeoPage(localizedLocaleCode, item.href);
    return { label: localizedPage.primaryKeyword, href: localizedPage.localizedPath };
  };
  const basePlatformLinks = [
    { label: "How Rejourney Works", href: "/how-it-works" },
    { label: "Website Analytics", href: "/website-analytics" },
    { label: "App Analytics", href: "/app-analytics" },
    { label: "Stability Monitoring", href: "/stability-monitoring" },
    { label: "API Endpoint Insights", href: "/api-endpoint-insights" },
    { label: "Device Insights", href: "/device-insights" },
    { label: "Rejourney Marlin", href: "/rejourney-marlin" },
    { label: localizedFooterCopy?.pricing ?? copy.pricing, href: pricingPath },
  ];
  const platformLinks = (localizedLocaleCode
    ? basePlatformLinks.filter((item) => isSeoLocalizedPagePath(item.href) || item.href === pricingPath)
    : basePlatformLinks).map(localizeSeoLink);
  const sessionReplayLinks = [
    { label: "Web Session Replay", href: "/web-session-replay" },
    { label: "Mobile Session Replay", href: "/mobile-session-replay" },
    { label: "Record User Sessions", href: "/record-user-sessions" },
    { label: "What Is Session Replay?", href: "/what-is-session-replay" },
    { label: "Funnel Replay Evidence", href: "/funnel-replay-evidence" },
    { label: "Heatmaps", href: "/heatmaps" },
  ].map(localizeSeoLink);
  const resourceLinks = [
    { label: copy.docs, href: docsPath },
    { label: "Web SDK", href: webDocsPath },
    { label: "React Native SDK", href: reactNativeDocsPath },
    { label: "Flutter SDK", href: flutterDocsPath },
    { label: "iOS SDK", href: swiftDocsPath },
    { label: copy.selfHosted, href: selfHostedPath },
    { label: localizedFooterCopy?.guides ?? "Guides", href: "/guides" },
    { label: localizedFooterCopy?.engineering ?? copy.engineering, href: engineeringPath },
    { label: "Revenue Leak Guide", href: "/guides/2026-07-12/revenue-leak-detection" },
    { label: localizedFooterCopy?.demo ?? "Demo", href: "/demo" },
  ];
  const comparisonLinks = [
    { label: "vs PostHog", href: "/alternatives/posthog-session-replay" },
    { label: "vs Sentry", href: "/alternatives/sentry-session-replay" },
    { label: "vs Datadog", href: "/alternatives/datadog-session-replay" },
    { label: "vs Amplitude", href: "/alternatives/amplitude-session-replay" },
    { label: "vs Mixpanel", href: "/alternatives/mixpanel-session-replay" },
    { label: "vs Pendo", href: "/alternatives/pendo-session-replay" },
    { label: "vs Fullstory", href: "/alternatives/fullstory" },
    { label: "vs Smartlook", href: "/alternatives/smartlook" },
    { label: "vs Hotjar", href: "/alternatives/hotjar" },
  ];

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText('contact@rejourney.co');
    showToast(copy.copyEmailToast);
  };

  const linkClass = "block text-sm font-semibold leading-normal text-slate-600 transition-colors duration-150 hover:text-slate-950 focus-visible:outline-none focus-visible:text-slate-950";
  const headingClass = "text-[0.7rem] font-extrabold uppercase tracking-[0.16em] text-slate-950";
  const sectionClass = "min-w-0 space-y-4";

  const cleanPath = location.pathname.replace(/\/$/, "");
  const isBrutalistPage = cleanPath === "" || 
                          cleanPath.endsWith("/pricing") || 
                          cleanPath.endsWith("/login") || 
                          cleanPath === "/en" || 
                          cleanPath === "/es" || 
                          cleanPath === "/fr";

  return (
    <div className={isBrutalistPage ? "" : "soft-border-scope"}>
      <footer className="relative overflow-hidden border-t border-slate-200 bg-[#fdfbf7] text-slate-700">
        <div className="relative mx-auto w-full max-w-[1600px] px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_2fr] lg:gap-16">
            <div className="max-w-md">
              <Link to="/" className="inline-flex items-center gap-3 transition hover:opacity-80">
                <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="h-10 w-10 object-contain" />
                <span className="font-mono text-xl font-black uppercase tracking-tight text-slate-950">Rejourney</span>
              </Link>
              <p className="mt-5 text-sm font-semibold leading-relaxed text-slate-600">
                {localizedFooterCopy?.summary ?? "Lightweight product analytics for web and mobile, with replay, funnels, heatmaps, crash context, and API evidence in one workspace."}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  to="/demo"
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-950 bg-slate-950 px-5 text-xs font-extrabold uppercase text-white shadow-sm transition-colors duration-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfbf7]"
                >
                  {localizedFooterCopy?.demo ?? "Demo"}
                </Link>
                <Link
                  to={pricingPath}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-xs font-extrabold uppercase text-slate-900 shadow-sm transition-colors duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfbf7]"
                >
                  {localizedFooterCopy?.pricing ?? copy.pricing}
                </Link>
              </div>
          </div>

          <div className="grid grid-cols-2 items-start gap-x-8 gap-y-10 xl:grid-cols-5">
            <nav className={sectionClass} aria-label="Platform pages">
              <h2 className={headingClass}>{localizedFooterCopy?.product ?? "Product Analytics"}</h2>
              <div className="space-y-4">
                {platformLinks.map((item) => (
                  <Link key={`${item.href}-${item.label}`} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Session replay pages">
              <h2 className={headingClass}>{localizedFooterCopy?.replay ?? "Session Replay"}</h2>
              <div className="space-y-4">
                {sessionReplayLinks.map((item) => (
                  <Link key={item.href} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Resources">
              <h2 className={headingClass}>{localizedFooterCopy?.resources ?? "Resources"}</h2>
              <div className="space-y-4">
                {resourceLinks.map((item) => (
                  <Link key={`${item.href}-${item.label}`} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Comparisons">
              <h2 className={headingClass}>{localizedFooterCopy?.comparisons ?? "Comparisons"}</h2>
              <div className="space-y-4">
                {comparisonLinks.map((item) => (
                  <Link key={item.href} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Company">
              <h2 className={headingClass}>{localizedFooterCopy?.company ?? "Company"}</h2>
              <div className="space-y-4">
                <Link to="/about" className={linkClass}>{localizedFooterCopy?.about ?? "About"}</Link>
                <Link to="/login" className={linkClass}>{localizedFooterCopy?.login ?? copy.login}</Link>
                <Link to="/terms-of-service" className={linkClass}>{localizedFooterCopy?.terms ?? copy.terms}</Link>
                <Link to="/dpa" className={linkClass}>{copy.dpa}</Link>
                <Link to="/privacy-policy" className={linkClass}>{localizedFooterCopy?.privacy ?? copy.privacy}</Link>
                <button onClick={handleCopyEmail} className={`${linkClass} text-start`}>
                  {localizedFooterCopy?.contact ?? copy.contact}
                </button>
                <a href="https://www.linkedin.com/company/rejourneyco/" target="_blank" rel="noopener noreferrer" className={linkClass} aria-label={copy.linkedinAriaLabel}>
                  LinkedIn
                </a>
                <a href="https://github.com/rejourneyco" target="_blank" rel="noopener noreferrer" className={linkClass} aria-label={copy.githubAriaLabel}>
                  GitHub
                </a>
              </div>
            </nav>
          </div>
        </div>

        <div className="mt-12 border-t border-slate-200 pt-6 text-center text-xs font-semibold text-slate-500">
          {copy.copyright}
        </div>
      </div>
    </footer>
    </div>
  );
};
