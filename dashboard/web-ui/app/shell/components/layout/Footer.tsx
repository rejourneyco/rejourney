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
  const featureLinks = [
    { label: "Record User Sessions", href: "/record-user-sessions" },
    { label: "Website Session Recording", href: "/web-session-replay" },
    { label: "Mobile Session Replay", href: "/mobile-session-replay" },
    { label: "Web Session Replay", href: "/web-session-replay" },
    { label: "Replay-First Mentality", href: "/replay-first-mentality" },
    { label: "Importance of Open Source", href: "/importance-of-open-source" },
    { label: "What Is Session Replay", href: "/what-is-session-replay" },
    { label: "How to See What Your Users Do", href: "/how-to-see-what-your-users-do" },
    { label: "Be Your Users", href: "/be-your-users" },
  ];
  const resourceLinks = [
    { label: copy.docs, href: docsPath },
    { label: "Web SDK", href: docsPath },
    { label: "React Native SDK", href: reactNativeDocsPath },
    { label: "iOS SDK", href: swiftDocsPath },
    { label: copy.selfHosted, href: selfHostedPath },
    { label: copy.pricing, href: pricingPath },
    { label: copy.engineering, href: engineeringPath },
    { label: "Roadmap", href: getLocalizedPublicPath(locale, "/roadmap") },
    { label: "Demo", href: "/demo/general" },
  ];

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText('contact@rejourney.co');
    showToast(copy.copyEmailToast);
  };

  const linkClass = "block text-base font-black leading-tight text-zinc-400 transition hover:text-white sm:text-lg";
  const headingClass = "text-xl font-black text-white sm:text-2xl";
  const sectionClass = "min-w-0 space-y-5";

  return (
    <footer className="border-t-2 border-black bg-[#070707] text-white">
      <div className="mx-auto w-full max-w-[1600px] px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_2fr] lg:gap-16">
          <div className="max-w-md">
            <Link to={locale.path} className="inline-flex items-center gap-3 transition hover:opacity-80">
              <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="h-10 w-10 object-contain" />
              <span className="font-mono text-2xl font-black uppercase tracking-tight text-white">Rejourney</span>
            </Link>
            <p className="mt-5 text-base font-bold leading-7 text-zinc-400">
              Replay-first analytics for web and mobile teams. Session replay, heatmaps, journeys, crashes, API context, and product analytics in one workspace.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/demo/general"
                className="inline-flex min-h-11 items-center justify-center border-2 border-white bg-[#86efac] px-4 text-sm font-black uppercase text-black shadow-[4px_4px_0_0_rgba(255,255,255,1)] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#fef08a]"
              >
                Demo
              </Link>
              <Link
                to={pricingPath}
                className="inline-flex min-h-11 items-center justify-center border-2 border-white bg-transparent px-4 text-sm font-black uppercase text-white transition hover:bg-white hover:text-black"
              >
                {copy.pricing}
              </Link>
            </div>
          </div>

          <div className="grid gap-10 sm:grid-cols-2 xl:grid-cols-4">
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

            <nav className={sectionClass} aria-label="Feature pages">
              <h2 className={headingClass}>Features</h2>
              <div className="space-y-4">
                {featureLinks.map((item) => (
                  <Link key={item.href} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Resources">
              <h2 className={headingClass}>Resources</h2>
              <div className="space-y-4">
                {resourceLinks.map((item) => (
                  <Link key={item.href} to={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                ))}
                <a href="https://github.com/rejourneyco/rejourney/releases" target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {copy.changelog}
                </a>
              </div>
            </nav>

            <nav className={sectionClass} aria-label="Company">
              <h2 className={headingClass}>Company</h2>
              <div className="space-y-4">
                <Link to="/about" className={linkClass}>About</Link>
                <Link to="/dashboard/general" className={linkClass}>{copy.dashboard}</Link>
                <Link to="/login" className={linkClass}>{copy.login}</Link>
                <Link to="/terms-of-service" className={linkClass}>{copy.terms}</Link>
                <Link to="/dpa" className={linkClass}>{copy.dpa}</Link>
                <Link to="/privacy-policy" className={linkClass}>{copy.privacy}</Link>
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

        <div className="mt-12 border-t border-zinc-800 pt-6 text-center text-sm font-bold text-zinc-500">
          {copy.copyright}
        </div>
      </div>
    </footer>
  );
};
