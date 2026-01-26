import React, { useState, useMemo } from 'react';
import { 
    Search as SearchIcon, 
    ArrowRight, 
    Settings, 
    Users, 
    User, 
    Map as MapIcon, 
    AlertTriangle, 
    MessageSquareWarning, 
    CreditCard, 
    Database, 
    Smartphone, 
    Activity, 
    Clock, 
    Terminal, 
    Mail, 
    LineChart, 
    Globe,
    AlertOctagon
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { usePathPrefix } from '../hooks/usePathPrefix';
import { useSessionData } from '../context/SessionContext';

interface SearchableItem {
    id: string;
    title: string;
    path: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    section: string;
    keywords?: string[];
}

export const Search: React.FC = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const { selectedProject } = useSessionData();

    // Build searchable items dynamically based on current project
    const searchableItems: SearchableItem[] = useMemo(() => [
        // Monitor
        { id: 'issues', title: 'Issues', path: '/issues', icon: MessageSquareWarning, description: 'Track and manage errors, crashes, and ANRs', section: 'Monitor', keywords: ['bugs', 'problems', 'exceptions'] },
        { id: 'sessions', title: 'Sessions', path: '/sessions', icon: Database, description: 'Watch user session replays', section: 'Monitor', keywords: ['recordings', 'replays', 'videos', 'playback'] },
        { id: 'api', title: 'API Performance', path: '/analytics/api', icon: Activity, description: 'API latency and endpoint performance', section: 'Analytics', keywords: ['latency', 'endpoints', 'requests', 'network'] },
        { id: 'growth', title: 'Growth', path: '/analytics/growth', icon: LineChart, description: 'Growth metrics, retention cohorts, and user trends', section: 'Analytics', keywords: ['metrics', 'retention', 'dau', 'mau', 'users', 'analytics'] },
        { id: 'journeys', title: 'User Journeys', path: '/analytics/journeys', icon: MapIcon, description: 'User flows and navigation paths', section: 'Analytics', keywords: ['flows', 'navigation', 'screens', 'paths', 'funnels'] },
        { id: 'devices', title: 'Devices', path: '/analytics/devices', icon: Smartphone, description: 'Device models and OS version breakdown', section: 'Analytics', keywords: ['device', 'os', 'model', 'android', 'ios', 'version'] },
        { id: 'geo', title: 'Geographic', path: '/analytics/geo', icon: Globe, description: 'Geographic distribution of issues', section: 'Analytics', keywords: ['location', 'country', 'region', 'map', 'world'] },
        // Stability
        { id: 'crashes', title: 'Crashes', path: '/stability/crashes', icon: AlertOctagon, description: 'Monitor and debug app crashes', section: 'Stability', keywords: ['crash', 'fatal', 'exception', 'native'] },
        { id: 'anrs', title: 'ANRs', path: '/stability/anrs', icon: Clock, description: 'Application Not Responding issues', section: 'Stability', keywords: ['freeze', 'hang', 'unresponsive', 'blocked'] },
        { id: 'errors', title: 'Errors', path: '/stability/errors', icon: Terminal, description: 'JavaScript and runtime errors', section: 'Stability', keywords: ['javascript', 'runtime', 'exception', 'bug'] },
        // Workspace
        ...(selectedProject ? [{
            id: 'project',
            title: 'Project Settings',
            path: `/settings/${selectedProject.id}`,
            icon: Settings,
            description: `Configure ${selectedProject.name} project options`,
            section: 'Workspace',
            keywords: ['project', 'config', 'configure', 'options', 'sdk']
        }] : []),
        { id: 'team', title: 'Team Members', path: '/team', icon: Users, description: 'Manage team members and invitations', section: 'Workspace', keywords: ['members', 'invite', 'roles', 'permissions', 'access'] },
        { id: 'billing', title: 'Plan & Billing', path: '/billing', icon: CreditCard, description: 'Manage subscription, plans, and payment methods', section: 'Workspace', keywords: ['subscription', 'payment', 'plan', 'upgrade', 'invoice', 'pricing'] },
        { id: 'alerts', title: 'Alerts', path: '/alerts/emails', icon: Mail, description: 'Configure email alerts and notifications', section: 'Workspace', keywords: ['email', 'notifications', 'notify', 'webhook'] },
        // You (Personal - stays same across teams)
        { id: 'account', title: 'Account', path: '/account', icon: User, description: 'Your personal account settings and free tier usage', section: 'You', keywords: ['profile', 'personal', 'free tier', 'usage', 'password', 'security'] },
    ], [selectedProject]);

    const filteredItems = useMemo(() => {
        const items = searchableItems.map(item => ({ ...item, path: `${pathPrefix}${item.path}` }));
        
        if (!searchQuery) return items;
        
        const query = searchQuery.toLowerCase();
        return items.filter(item =>
            item.title.toLowerCase().includes(query) ||
            item.description.toLowerCase().includes(query) ||
            item.section.toLowerCase().includes(query) ||
            item.keywords?.some(kw => kw.includes(query))
        );
    }, [searchQuery, pathPrefix, searchableItems]);

    // Group items by section for display
    const groupedItems = useMemo(() => {
        const groups: Record<string, typeof filteredItems> = {};
        const sectionOrder = ['Monitor', 'Growth', 'Stability', 'Breakdowns', 'Workspace', 'You'];
        
        filteredItems.forEach(item => {
            if (!groups[item.section]) {
                groups[item.section] = [];
            }
            groups[item.section].push(item);
        });
        
        // Return in order
        return sectionOrder
            .filter(section => groups[section]?.length > 0)
            .map(section => ({ section, items: groups[section] }));
    }, [filteredItems]);

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">New Tab</h1>
                <p className="text-slate-500">Search for a page to open</p>
            </div>

            <div className="relative mb-8">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <SearchIcon className="h-5 w-5 text-slate-400" />
                </div>
                <input
                    type="text"
                    className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg placeholder:text-slate-400"
                    placeholder="Search pages (e.g., Crashes, Sessions, Billing)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                />
            </div>

            {groupedItems.length > 0 ? (
                <div className="space-y-8">
                    {groupedItems.map(({ section, items }) => (
                        <div key={section}>
                            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{section}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {items.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => handleNavigate(item.path)}
                                        className="group flex items-start gap-4 p-4 bg-white border border-slate-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
                                    >
                                        <div className="p-2 bg-slate-50 rounded-md group-hover:bg-blue-50 transition-colors">
                                            <item.icon className="h-5 w-5 text-slate-500 group-hover:text-blue-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-semibold text-slate-900 group-hover:text-blue-700">{item.title}</h3>
                                            <p className="text-sm text-slate-500 mt-0.5 truncate">{item.description}</p>
                                        </div>
                                        <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-12 text-slate-500">
                    No pages found matching "{searchQuery}"
                </div>
            )}
        </div>
    );
};
