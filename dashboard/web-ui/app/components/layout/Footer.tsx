import React from 'react';
import { Link } from 'react-router';
import { useToast } from '~/context/ToastContext';

export const Footer: React.FC = () => {
  const { showToast } = useToast();

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText('contact@rejourney.co');
    showToast('Email copied to clipboard!');
  };

  return (
    <footer className="border-t border-input bg-background mt-16">
      <div className="container mx-auto px-6 py-8">
        <div className="flex flex-wrap gap-4 items-center justify-center text-sm font-mono font-bold uppercase tracking-tight text-gray-500">
          <Link to="/dashboard/general" className="hover:text-black transition-colors">Dashboard</Link>
          <span>•</span>
          <Link to="/docs/reactnative/overview" className="hover:text-black transition-colors">Docs</Link>
          <span>•</span>
          <Link to="/engineering" className="hover:text-black transition-colors">Engineering</Link>
          <span>•</span>
          <Link to="/changelog" className="hover:text-black transition-colors">Changelog</Link>
          <span>•</span>
          <Link to="/pricing" className="hover:text-black transition-colors">Pricing</Link>
          <span>•</span>
          <Link to="/docs/selfhosted" className="hover:text-black transition-colors">Self Hosted</Link>
          <span>•</span>
          <Link to="/login" className="hover:text-black transition-colors">Login</Link>
          <span>•</span>
          <Link to="/terms-of-service" className="hover:text-black transition-colors">Terms</Link>
          <span>•</span>
          <Link to="/privacy-policy" className="hover:text-black transition-colors">Privacy</Link>
          <span>•</span>
          <button onClick={handleCopyEmail} className="hover:text-black transition-colors uppercase">
            Contact
          </button>
        </div>
        <div className="text-center text-sm text-muted-foreground mt-4">
          © 2026 Rejourney. All rights reserved.
        </div>
      </div>
    </footer>
  );
};



