import React from 'react';
import { cn } from '~/shared/lib/cn';

export type DashboardGhostLoaderVariant =
  | 'general'
  | 'analytics'
  | 'list'
  | 'map'
  | 'settings'
  | 'alerts';

interface DashboardGhostLoaderProps {
  variant?: DashboardGhostLoaderVariant;
}

const GhostBlock: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={cn(
      'dashboard-ghost-block rounded-none border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]',
      className,
    )}
  />
);

const GhostSurface: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div
    className={cn(
      'dashboard-card-surface bg-white/90 p-5',
      className,
    )}
  >
    {children}
  </div>
);

const PageHeaderGhost: React.FC<{ withControls?: boolean }> = ({ withControls = false }) => (
  <div className="dashboard-page-header w-full border-b border-slate-200 bg-white">
    <div className="grid w-full gap-x-4 gap-y-2 px-3 py-2 sm:px-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <GhostBlock className="h-5 w-1.5 shrink-0 rounded-none" />
        <GhostBlock className="h-4 w-32 rounded-none" />
      </div>
      {withControls && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 xl:justify-end">
          <GhostBlock className="h-8 w-28 rounded-none" />
          <GhostBlock className="h-8 w-20 rounded-none" />
        </div>
      )}
    </div>
  </div>
);

const SettingsHeaderGhost: React.FC = () => (
  <div className="sticky top-0 z-50 border-b-2 border-black bg-[#f8fafc]">
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 items-center gap-6">
        <GhostBlock className="h-8 w-40 rounded-none" />
        <div className="hidden h-8 w-0.5 bg-black md:block" />
        <GhostBlock className="hidden h-3 w-52 rounded-none md:block" />
      </div>
      <GhostBlock className="h-9 w-28 rounded-none" />
    </div>
  </div>
);

const GA4CardGhost: React.FC<{ className?: string; minHeight?: string; children: React.ReactNode }> = ({ className, minHeight = '260px', children }) => (
  <div className={cn('dashboard-surface p-4', className)} style={{ minHeight }}>
    {children}
  </div>
);

const GeneralGhostBody: React.FC = () => (
  <div className="mx-auto w-full max-w-[1560px] space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6">
    {/* Momentum KPI cards — matches grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4 */}
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={`momentum-${index}`} className="min-w-0 rounded-xl border border-[#dadce0] bg-white p-4 sm:p-5">
          <GhostBlock className="h-3 w-28 rounded-none" />
          <GhostBlock className="mt-3 h-8 w-20 rounded-none" />
          <GhostBlock className="mt-4 h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>

    {/* First GA4 row — xl:grid-cols-12 with col-span-5 + col-span-3 + col-span-4 */}
    <div className="soft-border-scope space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <GA4CardGhost className="xl:col-span-5" minHeight="260px">
          <GhostBlock className="h-4 w-44 rounded-none" />
          <div className="mb-3 mt-3 grid grid-cols-2 gap-3">
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
          </div>
          <GhostBlock className="h-[130px] w-full rounded-none" />
        </GA4CardGhost>
        <GA4CardGhost className="xl:col-span-3" minHeight="260px">
          <GhostBlock className="h-4 w-36 rounded-none" />
          <GhostBlock className="mx-auto mt-4 h-10 w-28 rounded-none" />
          <GhostBlock className="mt-2 h-3 w-40 max-w-full rounded-none" />
          <GhostBlock className="mt-3 h-[80px] w-full rounded-none" />
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex justify-between gap-2">
                <GhostBlock className="h-3 w-20 rounded-none" />
                <GhostBlock className="h-3 w-8 rounded-none" />
              </div>
            ))}
          </div>
        </GA4CardGhost>
        <GA4CardGhost className="xl:col-span-4" minHeight="260px">
          <GhostBlock className="h-4 w-32 rounded-none" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <GhostBlock className="h-8 w-8 shrink-0 rounded-none" />
                <div className="min-w-0 flex-1 space-y-1">
                  <GhostBlock className="h-3 w-full rounded-none" />
                  <GhostBlock className="h-1.5 w-full rounded-none" />
                </div>
              </div>
            ))}
          </div>
        </GA4CardGhost>
      </div>

      {/* Second GA4 row — xl:grid-cols-12 with col-span-4 + col-span-4 + col-span-4 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <GA4CardGhost className="xl:col-span-4" minHeight="240px">
          <GhostBlock className="h-4 w-40 rounded-none" />
          <GhostBlock className="mt-4 h-[180px] w-full rounded-none" />
          <div className="mt-2 flex flex-wrap gap-3">
            <GhostBlock className="h-2.5 w-12 rounded-none" />
            <GhostBlock className="h-2.5 w-16 rounded-none" />
            <GhostBlock className="h-2.5 w-10 rounded-none" />
          </div>
        </GA4CardGhost>
        <GA4CardGhost className="xl:col-span-4" minHeight="240px">
          <GhostBlock className="h-4 w-44 rounded-none" />
          <div className="mb-3 mt-3 grid grid-cols-2 gap-3">
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
          </div>
          <GhostBlock className="h-[130px] w-full rounded-none" />
        </GA4CardGhost>
        <GA4CardGhost className="xl:col-span-4" minHeight="240px">
          <GhostBlock className="h-4 w-36 rounded-none" />
          <div className="mt-4">
            <GhostBlock className="h-[180px] w-full rounded-none" />
          </div>
        </GA4CardGhost>
      </div>

      {/* Third GA4 row — xl:grid-cols-12 with col-span-4 + col-span-8 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <GA4CardGhost className="xl:col-span-4" minHeight="200px">
          <GhostBlock className="h-4 w-36 rounded-none" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between gap-4">
                <GhostBlock className="h-3 w-24 rounded-none" />
                <GhostBlock className="h-3 w-16 rounded-none" />
              </div>
            ))}
          </div>
        </GA4CardGhost>
        <GA4CardGhost className="xl:col-span-8" minHeight="200px">
          <GhostBlock className="h-4 w-52 rounded-none" />
          <div className="mb-3 mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
            <GhostBlock className="h-8 rounded-none" />
          </div>
          <GhostBlock className="h-[180px] w-full rounded-none" />
        </GA4CardGhost>
      </div>
    </div>
  </div>
);

const KpiCardGhost: React.FC<{ accentColor: string }> = ({ accentColor }) => (
  <div className="dashboard-keep-neo dashboard-kpi-card min-w-0 p-2.5 sm:p-4">
    <div className="mb-2 h-1 border-2 border-black sm:mb-2.5 sm:h-1.5" style={{ backgroundColor: accentColor }} />
    <GhostBlock className="h-3 w-24 rounded-none" />
    <GhostBlock className="mt-2 h-7 w-20 rounded-none sm:h-8" />
    <div className="mt-1.5 flex items-center gap-2 sm:mt-2">
      <GhostBlock className="h-5 w-14 rounded-none" />
      <GhostBlock className="h-3 w-20 rounded-none" />
    </div>
  </div>
);

const KPI_ACCENT_COLORS = ['#67e8f9', '#86efac', '#f9a8d4', '#c4b5fd'];

const AnalyticsGhostBody: React.FC<{ kpiCount?: number }> = ({ kpiCount = 4 }) => (
  <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
    {/* KpiCardsGrid — controls bar + cards */}
    <section>
      <div className="dashboard-surface mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <GhostBlock className="h-8 w-36 rounded-none" />
          <GhostBlock className="h-8 w-28 rounded-none" />
          <GhostBlock className="h-8 w-24 rounded-none" />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
        {Array.from({ length: kpiCount }).map((_, index) => (
          <KpiCardGhost key={index} accentColor={KPI_ACCENT_COLORS[index % KPI_ACCENT_COLORS.length]} />
        ))}
      </div>
    </section>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <GhostSurface className="min-h-[320px]">
        <GhostBlock className="h-5 w-44 rounded-none" />
        <GhostBlock className="mt-4 h-56 w-full rounded-none" />
        <div className="mt-5 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <GhostBlock key={index} className="h-14 rounded-none" />
          ))}
        </div>
      </GhostSurface>
      <GhostSurface className="min-h-[320px]">
        <GhostBlock className="h-5 w-36 rounded-none" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <GhostBlock className="h-4 w-32 rounded-none" />
              <GhostBlock className="h-4 w-16 rounded-none" />
            </div>
          ))}
        </div>
        <GhostBlock className="mt-6 h-28 w-full rounded-none" />
      </GhostSurface>
    </div>

    <GhostSurface className="min-h-[280px]">
      <GhostBlock className="h-5 w-40 rounded-none" />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GhostBlock className="h-44 rounded-none lg:col-span-2" />
        <div className="space-y-4">
          <GhostBlock className="h-20 rounded-none" />
          <GhostBlock className="h-20 rounded-none" />
        </div>
      </div>
    </GhostSurface>
  </div>
);

const ListGhostBody: React.FC = () => (
  <>
    {/* Search/controls row — matches border-b-2 border-black bg-[#f8fafc] row in real list pages */}
    <div className="border-b-2 border-black bg-[#f8fafc] px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-2 sm:flex-row sm:items-center">
        <GhostBlock className="h-10 min-w-[240px] flex-1 rounded-none" />
        <div className="flex items-center gap-2">
          <GhostBlock className="h-10 w-24 rounded-none" />
        </div>
      </div>
    </div>

    <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 pt-6">
      <GhostSurface className="overflow-hidden p-0">
        {/* Table header row */}
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-4 text-[11px]">
            <GhostBlock className="h-3 w-6 rounded-none" />
            <GhostBlock className="h-3 flex-1 rounded-none" />
            <GhostBlock className="hidden h-3 w-24 rounded-none md:block" />
            <GhostBlock className="hidden h-3 w-16 rounded-none sm:block" />
            <GhostBlock className="hidden h-3 w-16 rounded-none lg:block" />
            <GhostBlock className="h-3 w-12 rounded-none" />
            <GhostBlock className="h-3 w-12 rounded-none" />
            <GhostBlock className="h-3 w-6 rounded-none" />
          </div>
        </div>

        <div className="divide-y divide-slate-100 bg-white">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-4">
              <GhostBlock className="h-6 w-6 shrink-0 rounded-none" />
              <div className="min-w-0 flex-1 space-y-2">
                <GhostBlock className="h-4 w-64 max-w-full rounded-none" />
                <GhostBlock className="h-3 w-80 max-w-full rounded-none" />
              </div>
              <GhostBlock className="hidden h-6 w-24 rounded-none md:block" />
              <GhostBlock className="hidden h-4 w-16 rounded-none sm:block" />
              <GhostBlock className="hidden h-4 w-16 rounded-none lg:block" />
              <GhostBlock className="h-4 w-10 rounded-none" />
              <GhostBlock className="h-4 w-10 rounded-none" />
              <GhostBlock className="h-6 w-6 shrink-0 rounded-none" />
            </div>
          ))}
        </div>
      </GhostSurface>
    </div>
  </>
);

const MapGhostBody: React.FC = () => (
  <div className="relative flex-1 w-full bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.98),_rgba(248,250,252,0.92)_48%,_rgba(241,245,249,0.86)_100%)]">
    <div className="absolute left-6 right-6 top-6 z-10 flex flex-wrap gap-3">
      <GhostBlock className="h-16 w-44 rounded-none" />
      <GhostBlock className="h-16 w-44 rounded-none" />
      <GhostBlock className="h-16 w-36 rounded-none" />
    </div>
    <div className="absolute inset-0 p-6">
      <GhostBlock className="h-full w-full rounded-none" />
    </div>
  </div>
);

const SettingsGhostBody: React.FC = () => (
  <div className="mx-auto flex-1 w-full max-w-[1600px] space-y-8 px-6 py-6 md:px-8">
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <GhostSurface className="space-y-4 lg:col-span-2">
        <GhostBlock className="h-5 w-36 rounded-none" />
        <GhostBlock className="h-32 w-full rounded-none" />
        <GhostBlock className="h-56 w-full rounded-none" />
      </GhostSurface>
      <div className="space-y-6">
        <GhostSurface>
          <GhostBlock className="h-5 w-28 rounded-none" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <GhostBlock key={index} className="h-10 w-full rounded-none" />
            ))}
          </div>
        </GhostSurface>
        <GhostSurface>
          <GhostBlock className="h-5 w-24 rounded-none" />
          <GhostBlock className="mt-4 h-24 w-full rounded-none" />
        </GhostSurface>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <GhostSurface className="min-h-[220px]">
        <GhostBlock className="h-5 w-32 rounded-none" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <GhostBlock key={index} className="h-10 w-full rounded-none" />
          ))}
        </div>
      </GhostSurface>
      <GhostSurface className="min-h-[220px]">
        <GhostBlock className="h-5 w-32 rounded-none" />
        <GhostBlock className="mt-4 h-40 w-full rounded-none" />
      </GhostSurface>
    </div>
  </div>
);

const AlertsGhostBody: React.FC = () => (
  <div className="mx-auto w-full max-w-[1200px] space-y-8 px-8 py-8 pb-12">
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <GhostSurface className="min-h-[260px]">
        <GhostBlock className="h-5 w-40 rounded-none" />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <GhostBlock key={index} className="h-14 w-full rounded-none" />
          ))}
        </div>
      </GhostSurface>
      <GhostSurface className="min-h-[260px]">
        <GhostBlock className="h-5 w-36 rounded-none" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <GhostBlock key={index} className="h-12 w-full rounded-none" />
          ))}
        </div>
      </GhostSurface>
    </div>

    <GhostSurface className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-white/55 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <GhostBlock className="h-10 min-w-[220px] flex-1 rounded-none" />
          <GhostBlock className="h-10 w-32 rounded-none" />
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <GhostBlock className="h-4 w-48 rounded-none" />
              <GhostBlock className="h-3 w-64 max-w-full rounded-none" />
            </div>
            <GhostBlock className="h-9 w-24 rounded-none" />
          </div>
        ))}
      </div>
    </GhostSurface>
  </div>
);

export const DashboardGhostLoader: React.FC<DashboardGhostLoaderProps> = ({ variant = 'analytics' }) => {
  if (variant === 'general') {
    return (
      <div className="rejourney-general-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-black">
        <PageHeaderGhost withControls />
        <GeneralGhostBody />
      </div>
    );
  }

  if (variant === 'settings') {
    return (
      <div className="min-h-screen bg-white font-sans text-black">
        <SettingsHeaderGhost />
        <SettingsGhostBody />
      </div>
    );
  }

  if (variant === 'map') {
    return (
      <div className="flex min-h-screen flex-col bg-transparent font-sans text-black">
        <PageHeaderGhost withControls />
        <MapGhostBody />
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className="min-h-screen bg-[#f8fafd] font-sans text-black">
        <PageHeaderGhost withControls />
        <ListGhostBody />
      </div>
    );
  }

  if (variant === 'alerts') {
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-black">
        <PageHeaderGhost withControls />
        <AlertsGhostBody />
      </div>
    );
  }

  return (
    <div className="rejourney-api-page min-h-screen bg-[#f8fafd] font-sans text-black">
      <PageHeaderGhost withControls />
      <AnalyticsGhostBody kpiCount={4} />
    </div>
  );
};

export default DashboardGhostLoader;
