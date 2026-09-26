import React, { useState, useMemo } from 'react';
import {
    Search as SearchIcon,
    ArrowRight,
    Settings,
    Users,
    UserRoundCog,
    Route,
    AlertTriangle,
    LayoutDashboard,
    CreditCard,
    Video,
    Smartphone,
    Activity,
    Mail,
    Globe,
    Flame
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { useSessionData } from '~/shared/providers/SessionContext';

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
        // Growth
        { id: 'general', title: 'General', path: '/general', icon: LayoutDashboard, description: 'Unified view of top issues, user replays, and behavior signals', section: 'Growth', keywords: ['issues', 'problems', 'exceptions', 'overview'] },
        { id: 'sessions', title: 'Replays', path: '/sessions', icon: Video, description: 'Watch and inspect user replay sessions', section: 'Growth', keywords: ['recordings', 'replays', 'videos', 'playback'] },
        { id: 'geo', title: 'Geographic', path: '/geo', icon: Globe, description: 'Regional value, engagement segments, and issue hotspots', section: 'Growth', keywords: ['location', 'country', 'region', 'map', 'world'] },
        { id: 'journeys', title: 'User journey', path: '/journeys', icon: Route, description: 'User flows and navigation paths', section: 'Growth', keywords: ['flows', 'navigation', 'screens', 'paths', 'funnels'] },
        { id: 'heatmaps', title: 'Heatmaps', path: '/heatmaps', icon: Flame, description: 'Touch heatmaps and interaction friction by screen', section: 'Growth', keywords: ['heatmap', 'touch', 'tap', 'rage', 'friction', 'interaction', 'hotspot'] },
        // Developer
        { id: 'stability', title: 'Stability', path: '/stability', icon: AlertTriangle, description: 'Crash, ANR, and runtime error triage', section: 'Developer', keywords: ['crash', 'fatal', 'exception', 'native', 'freeze', 'hang', 'unresponsive', 'blocked', 'javascript', 'runtime', 'bug'] },
        { id: 'api', title: 'API insights', path: '/api', icon: Activity, description: 'API reliability, latency, and replay-backed evidence', section: 'Developer', keywords: ['latency', 'endpoints', 'requests', 'network', 'api'] },
        { id: 'devices', title: 'Devices', path: '/devices', icon: Smartphone, description: 'Device models and OS version breakdown', section: 'Developer', keywords: ['device', 'os', 'model', 'android', 'ios', 'version'] },
        // Workspace
        ...(selectedProject ? [{
            id: 'project',
            title: 'Project settings',
            path: `/settings/${selectedProject.id}`,
            icon: Settings,
            description: `Configure ${selectedProject.name} project options`,
            section: 'Workspace',
            keywords: ['project', 'config', 'configure', 'options', 'sdk']
        }] : []),
        { id: 'team', title: 'Team members', path: '/team', icon: Users, description: 'Manage team members and invitations', section: 'Workspace', keywords: ['members', 'invite', 'roles', 'permissions', 'access'] },
        { id: 'billing', title: 'Plan & billing', path: '/billing', icon: CreditCard, description: 'Manage subscription, plans, and payment methods', section: 'Workspace', keywords: ['subscription', 'payment', 'plan', 'upgrade', 'invoice', 'pricing'] },
        { id: 'alerts', title: 'Alerts', path: '/alerts/emails', icon: Mail, description: 'Configure email alerts and notifications', section: 'Workspace', keywords: ['email', 'notifications', 'notify', 'webhook'] },
        // You (Personal - stays same across teams)
        { id: 'account', title: 'Account', path: '/account', icon: UserRoundCog, description: 'Your personal account settings and free tier usage', section: 'You', keywords: ['profile', 'personal', 'free tier', 'usage', 'password', 'security'] },
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
        const sectionOrder = ['Growth', 'Developer', 'Workspace', 'You'];
        
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
        <div className="min-h-screen p-8 bg-transparent">
            <div className="mx-auto max-w-5xl rounded-none border border-[#dadce0] bg-white p-6">
            <div className="mb-8">
                <h1 className="mb-2 text-xl font-normal text-[#202124]">New tab</h1>
                <p className="text-sm text-[#5f6368]">Search and open any workspace page.</p>
            </div>

            <div className="relative mb-8">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <SearchIcon className="h-5 w-5 text-[#80868b]" />
                </div>
                <input
                    type="text"
                    className="w-full rounded-none border border-[#dadce0] bg-white py-3 pl-10 pr-4 text-base text-[#202124] placeholder:text-[#80868b] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20"
                    placeholder="Search pages (e.g., Replays, API insights, Billing)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                />
            </div>

            {groupedItems.length > 0 ? (
                <div className="space-y-8">
                    {groupedItems.map(({ section, items }) => (
                        <div key={section}>
                            <h2 className="mb-3 text-xs font-medium text-[#5f6368]">{section}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {items.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => handleNavigate(item.path)}
                                        className="group flex cursor-pointer items-start gap-4 rounded-none border border-[#dadce0] bg-white p-4 transition-colors hover:border-[#bdc1c6] hover:bg-[#f8fafd]"
                                    >
                                        <div className="rounded-none bg-[#f1f3f4] p-2">
                                            <item.icon className="h-5 w-5 text-[#5f6368]" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-[15px] font-medium text-[#202124]">{item.title}</h3>
                                            <p className="mt-0.5 truncate text-sm text-[#5f6368]">{item.description}</p>
                                        </div>
                                        <ArrowRight className="h-5 w-5 flex-shrink-0 text-[#80868b] opacity-0 transition-opacity group-hover:opacity-100" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="py-12 text-center text-[#5f6368]">
                    No pages found matching "{searchQuery}"
                </div>
            )}
            </div>
        </div>
    );
};

export default Search;
