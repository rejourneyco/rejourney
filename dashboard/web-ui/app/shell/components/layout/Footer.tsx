import React from 'react';
import { Link, useLocation } from 'react-router';
import { useToast } from '~/shared/providers/ToastContext';
import { getLocalizedPublicPath, getMarketingHomeCopy, getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';

export const Footer: React.FC = () => {
  const location = useLocation();
  const locale = getMarketingLocaleFromPathname(location.pathname);
  const copy = getMarketingHomeCopy(location.pathname).footer;
  const { showToast } = useToast();
  const docsPath = getLocalizedPublicPath(locale, "/docs/reactnative/overview");
  const engineeringPath = getLocalizedPublicPath(locale, "/engineering");
  const pricingPath = getLocalizedPublicPath(locale, "/pricing");
  const selfHostedPath = getLocalizedPublicPath(locale, "/docs/selfhosted");

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText('contact@rejourney.co');
    showToast(copy.copyEmailToast);
  };

  return (
    <footer className="border-t border-input bg-background mt-16">
      <div className="container mx-auto px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 text-center text-xs font-mono font-bold uppercase tracking-tight text-gray-500 sm:text-sm">
          <Link to="/dashboard/general" className="hover:text-black transition-colors">{copy.dashboard}</Link>
          <span className="hidden sm:inline">•</span>
          <Link to={docsPath} className="hover:text-black transition-colors">{copy.docs}</Link>
          <span className="hidden sm:inline">•</span>
          <Link to={engineeringPath} className="hover:text-black transition-colors">{copy.engineering}</Link>
          <span className="hidden sm:inline">•</span>
          <a href="https://github.com/rejourneyco/rejourney/releases" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">{copy.changelog}</a>
          <span className="hidden sm:inline">•</span>
          <Link to={pricingPath} className="hover:text-black transition-colors">{copy.pricing}</Link>
          <span className="hidden sm:inline">•</span>
          <Link to={selfHostedPath} className="hover:text-black transition-colors">{copy.selfHosted}</Link>
          <span className="hidden sm:inline">•</span>
          <Link to="/login" className="hover:text-black transition-colors">{copy.login}</Link>
          <span className="hidden sm:inline">•</span>
          <Link to="/terms-of-service" className="hover:text-black transition-colors">{copy.terms}</Link>
          <span className="hidden sm:inline">•</span>
          <Link to="/privacy-policy" className="hover:text-black transition-colors">{copy.privacy}</Link>
          <span className="hidden sm:inline">•</span>
          <button onClick={handleCopyEmail} className="hover:text-black transition-colors uppercase">
            {copy.contact}
          </button>
          <span className="hidden sm:inline">•</span>
          <a
            href="https://x.com/rejourneyco"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black transition-colors"
            aria-label={copy.xAriaLabel}
          >
            X
          </a>
          <span className="hidden sm:inline">•</span>
          <a
            href="https://github.com/rejourneyco"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black transition-colors"
            aria-label={copy.githubAriaLabel}
          >
            GitHub
          </a>
        </div>
        <div className="text-center text-sm text-muted-foreground mt-4">
          {copy.copyright}
        </div>
      </div>
    </footer>
  );
};
