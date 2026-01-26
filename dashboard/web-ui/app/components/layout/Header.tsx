import React from 'react';
import { Link } from 'react-router';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { ExternalLink } from 'lucide-react';

export const Header: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return (
    <header aria-label="Site navigation" className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[95%] lg:max-w-[98%] items-center justify-between gap-3 px-4 sm:px-6 lg:px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity group animate-scale-in">
          <div className="w-10 h-10 flex items-center justify-center group-hover:rotate-6 transition-transform">
            <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney | Open Source Session Replay & Observability" className="w-10 h-10 object-contain" />
          </div>
          <span className="text-xl font-black tracking-tighter uppercase font-mono text-slate-900 group-hover:text-[#5dadec] transition-colors">REJOURNEY</span>
        </Link>

        <nav className="hidden items-center gap-8 sm:flex">
          <Link
            to="/engineering"
            className="text-base font-bold uppercase tracking-wide hover:underline decoration-2 underline-offset-4 decoration-slate-900 text-slate-900 font-mono"
          >
            Engineering
          </Link>
          <Link
            to="/docs/reactnative/overview"
            className="text-base font-bold uppercase tracking-wide hover:underline decoration-2 underline-offset-4 decoration-slate-900 text-slate-900 font-mono"
          >
            Docs
          </Link>
          <Link
            to="/pricing"
            className="text-base font-bold uppercase tracking-wide hover:underline decoration-2 underline-offset-4 decoration-slate-900 text-slate-900 font-mono"
          >
            Pricing
          </Link>
          <a
            href="https://github.com/rejourneyco/rejourney"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-base font-bold uppercase tracking-wide hover:underline decoration-2 underline-offset-4 decoration-slate-900 text-slate-900 font-mono"
          >
            <ExternalLink className="w-5 h-5" />
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-4">
          <Link to="/docs/selfhosted">
            <Button variant="ghost" className="font-mono uppercase font-black text-sm px-6 py-2 border-2 border-transparent hover:border-black transition-all rounded-none hidden sm:flex">
              Self-hosted
            </Button>
          </Link>
          <Link to={isAuthenticated ? "/dashboard/issues" : "/login"}>
            <Button variant="ghost" className="font-mono uppercase font-black text-sm px-6 py-2 border-2 border-black bg-white text-black hover:bg-white hover:text-black hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] transition-all rounded-none">
              {isAuthenticated ? "Dashboard" : "Log in"}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
};
