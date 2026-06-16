import React from 'react';
import {
  Activity,
  AlertTriangle,
  CreditCard,
  Droplets,
  Flame,
  Globe,
  LayoutDashboard,
  Mail,
  Rocket,
  Route,
  Settings,
  Smartphone,
  UserRoundCog,
  Users,
  Video,
} from 'lucide-react';

export type DashboardPageKey =
  | 'general'
  | 'sessions'
  | 'geo'
  | 'journeys'
  | 'heatmaps'
  | 'stability'
  | 'api'
  | 'devices'
  | 'leaks'
  | 'emails'
  | 'setup'
  | 'project'
  | 'team'
  | 'billing'
  | 'account';

export type DashboardPageMeta = {
  sidebarLabel: string;
  tabTitle: string;
  icon: React.ElementType;
  accent: string;
  activeBg: string;
  iconBgClass: string;
};

export const DASHBOARD_PAGE_META: Record<DashboardPageKey, DashboardPageMeta> = {
  general: {
    sidebarLabel: 'General',
    tabTitle: 'General',
    icon: LayoutDashboard,
    accent: '#0891b2',
    activeBg: '#ecfeff',
    iconBgClass: 'bg-[#ecfeff]',
  },
  sessions: {
    sidebarLabel: 'Replays',
    tabTitle: 'Replays',
    icon: Video,
    accent: '#2563eb',
    activeBg: '#eff6ff',
    iconBgClass: 'bg-[#eff6ff]',
  },
  geo: {
    sidebarLabel: 'Geographic',
    tabTitle: 'Geographic',
    icon: Globe,
    accent: '#059669',
    activeBg: '#ecfdf5',
    iconBgClass: 'bg-[#ecfdf5]',
  },
  journeys: {
    sidebarLabel: 'User Journey',
    tabTitle: 'User Journey',
    icon: Route,
    accent: '#db2777',
    activeBg: '#fdf2f8',
    iconBgClass: 'bg-[#fdf2f8]',
  },
  heatmaps: {
    sidebarLabel: 'Heat Maps',
    tabTitle: 'Heat Maps',
    icon: Flame,
    accent: '#f97316',
    activeBg: '#fff7ed',
    iconBgClass: 'bg-[#fff7ed]',
  },
  stability: {
    sidebarLabel: 'Stability',
    tabTitle: 'Stability',
    icon: AlertTriangle,
    accent: '#dc2626',
    activeBg: '#fef2f2',
    iconBgClass: 'bg-[#fef2f2]',
  },
  api: {
    sidebarLabel: 'API Insights',
    tabTitle: 'API Insights',
    icon: Activity,
    accent: '#16a34a',
    activeBg: '#f0fdf4',
    iconBgClass: 'bg-[#f0fdf4]',
  },
  devices: {
    sidebarLabel: 'Devices',
    tabTitle: 'Devices',
    icon: Smartphone,
    accent: '#7c3aed',
    activeBg: '#f5f3ff',
    iconBgClass: 'bg-[#f5f3ff]',
  },
  leaks: {
    sidebarLabel: 'Leaks',
    tabTitle: 'Leaks',
    icon: Droplets,
    accent: '#0891b2',
    activeBg: '#ecfeff',
    iconBgClass: 'bg-[#ecfeff]',
  },
  emails: {
    sidebarLabel: 'Emails',
    tabTitle: 'Email Alerts',
    icon: Mail,
    accent: '#d97706',
    activeBg: '#fffbeb',
    iconBgClass: 'bg-[#fffbeb]',
  },
  setup: {
    sidebarLabel: 'Setup',
    tabTitle: 'Setup',
    icon: Rocket,
    accent: '#1a73e8',
    activeBg: '#eef4ff',
    iconBgClass: 'bg-[#eef4ff]',
  },
  project: {
    sidebarLabel: 'Project',
    tabTitle: 'Project Settings',
    icon: Settings,
    accent: '#475569',
    activeBg: '#f8fafc',
    iconBgClass: 'bg-[#f8fafc]',
  },
  team: {
    sidebarLabel: 'Team',
    tabTitle: 'Team',
    icon: Users,
    accent: '#0f766e',
    activeBg: '#f0fdfa',
    iconBgClass: 'bg-[#f0fdfa]',
  },
  billing: {
    sidebarLabel: 'Plan & Billing',
    tabTitle: 'Billing',
    icon: CreditCard,
    accent: '#ca8a04',
    activeBg: '#fefce8',
    iconBgClass: 'bg-[#fefce8]',
  },
  account: {
    sidebarLabel: 'Account',
    tabTitle: 'Account',
    icon: UserRoundCog,
    accent: '#4f46e5',
    activeBg: '#eef2ff',
    iconBgClass: 'bg-[#eef2ff]',
  },
};

export function dashboardPageHeaderProps(pageKey: DashboardPageKey) {
  const meta = DASHBOARD_PAGE_META[pageKey];
  const Icon = meta.icon;

  return {
    icon: React.createElement(Icon, {
      className: 'h-[18px] w-[18px]',
      strokeWidth: 2.25,
    }),
    iconColor: meta.iconBgClass,
    iconAccent: meta.accent,
  };
}
