import React from 'react';
import { Link, useLocation } from 'react-router';
import { useToast } from '~/shared/providers/ToastContext';
import { getLocalizedPublicPath, getMarketingHomeCopy, getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';

export const Footer: React.FC = () => {
  const location = useLocation();
  const locale = getMarketingLocaleFromPathname(location.pathname);
  const copy = getMarketingHomeCopy(location.pathname).footer;
  const { showToast } = useToast();
  const docsPath = getLocalizedPublicPath(locale, "/docs/web/getting-started");
  const reactNativeDocsPath = getLocalizedPublicPath(locale, "/docs/reactnative/overview");
  const swiftDocsPath = getLocalizedPublicPath(locale, "/docs/swift/overview");
  const engineeringPath = getLocalizedPublicPath(locale, "/engineering");
  const pricingPath = getLocalizedPublicPath(locale, "/pricing");
  const selfHostedPath = getLocalizedPublicPath(locale, "/docs/selfhosted");
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
  const platformLinks = [
    { label: "AI Funnel Leak Detection", href: "/ai-funnel-leak-detection" },
    { label: "Rejourney Marlin", href: "/rejourney-marlin" },
    { label: "Self-Healing Software", href: "/self-healing-software" },
    { label: "Stability Monitoring", href: "/stability-monitoring" },
    { label: "API Endpoint Insights", href: "/api-endpoint-insights" },
    { label: "Device Insights", href: "/device-insights" },
    { label: "Geographic Analytics", href: "/geographic-analytics" },
  ];
  const replayAnalyticsLinks = [
    { label: "Web Replay Evidence", href: "/web-session-replay" },
    { label: "Mobile Replay Evidence", href: "/mobile-session-replay" },
    { label: "Funnel Replay Evidence", href: "/funnel-replay-evidence" },
    { label: "Heatmaps", href: "/heatmaps" },
    { label: "Revenue Recovery Analytics", href: "/revenue-recovery-analytics" },
    { label: "Standardized Context", href: "/standardized-context" },
    { label: "AI Agent Handoff", href: "/ai-agent-handoff" },
    { label: "Autonomous Debugging", href: "/autonomous-debugging" },
  ];
  const resourceLinks = [
    { label: copy.docs, href: docsPath },
    { label: "Web SDK", href: docsPath },
    { label: "React Native SDK", href: reactNativeDocsPath },
    { label: "iOS SDK", href: swiftDocsPath },
    { label: copy.selfHosted, href: selfHostedPath },
    { label: copy.pricing, href: pricingPath },
    { label: "Benchmarks", href: "/benchmarks" },
    { label: copy.engineering, href: engineeringPath },
    { label: "Demo", href: "/demo" },
  ];

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText('contact@rejourney.co');
    showToast(copy.copyEmailToast);
  };

  const linkClass = "block text-sm font-medium leading-normal text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-slate-100";
  const headingClass = "text-xs font-semibold tracking-wider uppercase text-slate-800 dark:text-slate-200";
  const sectionClass = "min-w-0 space-y-4";

  return (
    <footer className="border-t border-slate-200 dark:border-slate-900 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
      <div className="mx-auto w-full max-w-[1600px] px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_2fr] lg:gap-16">
          <div className="max-w-md">
            <Link to="/" className="inline-flex items-center gap-3 transition hover:opacity-80">
              <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="h-10 w-10 object-contain" />
              <span className="font-mono text-xl font-bold uppercase tracking-tight text-slate-900 dark:text-slate-100">Rejourney</span>
            </Link>
            <p className="mt-5 text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              AI funnel leak detection for teams shipping growth. Rejourney watches replay evidence, ranks revenue leaks, and creates fix packets for product and engineering.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/demo"
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 px-5 text-xs font-semibold uppercase text-white shadow-md shadow-indigo-100 hover:shadow-indigo-200 transition-all duration-200 hover:-translate-y-0.5"
              >
                Demo
              </Link>
              <Link
                to={pricingPath}
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 px-5 text-xs font-semibold uppercase text-slate-700 dark:text-slate-300 transition-all duration-200 hover:-translate-y-0.5 shadow-sm"
              >
                {copy.pricing}
              </Link>
            </div>
          </div>

          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <nav className={sectionClass} aria-label="Platform pages">
              <h2 className={headingClass}>Platform</h2>
              <div className="space-y-4">
                {platformLinks.map((item) => (
                  <Link key={`${item.href}-${item.label}`} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Replay and analytics pages">
              <h2 className={headingClass}>Replay & Analytics</h2>
              <div className="space-y-4">
                {replayAnalyticsLinks.map((item) => (
                  <Link key={`${item.href}-${item.label}`} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Resources">
              <h2 className={headingClass}>Resources</h2>
              <div className="space-y-4">
                {resourceLinks.map((item) => (
                  <Link key={`${item.href}-${item.label}`} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
                <a href="https://github.com/rejourneyco/rejourney/releases" target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {copy.changelog}
                </a>
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Comparison pages">
              <h2 className={headingClass}>Comparisons</h2>
              <div className="space-y-4">
                {comparisonLinks.map((item) => (
                  <Link key={item.href} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Company">
              <h2 className={headingClass}>Company</h2>
              <div className="space-y-4">
                <Link to="/about" className={linkClass}>About</Link>
                <Link to="/dashboard" className={linkClass}>{copy.dashboard}</Link>
                <Link to="/login" className={linkClass}>{copy.login}</Link>
                <Link to="/terms-of-service" className={linkClass}>{copy.terms}</Link>
                <Link to="/dpa" className={linkClass}>{copy.dpa}</Link>
                <Link to="/privacy-policy" className={linkClass}>{copy.privacy}</Link>
                <Link to="/attributions" className={linkClass}>Attributions</Link>
                <button onClick={handleCopyEmail} className={`${linkClass} text-left`}>
                  {copy.contact}
                </button>
                <a href="https://x.com/rejourneyco" target="_blank" rel="noopener noreferrer" className={linkClass} aria-label={copy.xAriaLabel}>
                  X
                </a>
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

        <div className="mt-12 border-t border-slate-200 dark:border-slate-900 pt-6 text-center text-sm font-semibold text-slate-400 dark:text-slate-500">
          {copy.copyright}
        </div>
      </div>
    </footer>
  );
};
