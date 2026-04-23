import React from 'react';
import { cn } from '~/shared/lib/cn';

export type DashboardGhostLoaderVariant =
  | 'overview'
  | 'analytics'
  | 'list'
  | 'map'
  | 'settings'
  | 'alerts';

interface DashboardGhostLoaderProps {
  variant?: DashboardGhostLoaderVariant;
}

const GhostBlock: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden="true" className={cn('dashboard-ghost-block rounded-none border-2 border-black', className)} />
);

const GhostSurface: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('rounded-none border-4 border-black bg-white p-5 shadow-neo-sm', className)}>
    {children}
  </div>
);

const DashboardHeaderGhost: React.FC<{ actionCount?: number }> = ({ actionCount = 2 }) => (
  <div className="sticky top-0 z-30 border-b-2 border-black bg-white">
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <GhostBlock className="h-12 w-12 rounded-none" />
        <div className="min-w-0 flex-1 space-y-2" style={{ minWidth: 'min(100%, 13rem)' }}>
          <GhostBlock className="h-6 w-40 max-w-[60vw]" />
          <GhostBlock className="h-3 w-64 max-w-[70vw]" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {Array.from({ length: actionCount }).map((_, index) => (
          <GhostBlock key={index} className="h-10 w-24 rounded-none" />
        ))}
      </div>
    </div>
  </div>
);

const SettingsHeaderGhost: React.FC = () => (
  <div className="sticky top-0 z-50 border-b-2 border-black bg-white/95 backdrop-blur-sm">
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 items-center gap-6">
        <GhostBlock className="h-8 w-40 rounded-none" />
        <div className="hidden h-8 w-0.5 bg-black md:block w-0.5" />
        <GhostBlock className="hidden h-3 w-52 rounded-none md:block" />
      </div>
      <GhostBlock className="h-9 w-28 rounded-none" />
    </div>
  </div>
);

const AnalyticsGhostBody: React.FC<{ kpiCount?: number }> = ({ kpiCount = 4 }) => (
  <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      {Array.from({ length: kpiCount }).map((_, index) => (
        <GhostSurface key={index} className="px-4 py-4">
          <GhostBlock className="h-3 w-24 rounded-none" />
          <GhostBlock className="mt-4 h-8 w-20 rounded-none" />
          <GhostBlock className="mt-3 h-3 w-28 rounded-none" />
        </GhostSurface>
      ))}
    </div>

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
  <div className="mx-auto w-full max-w-[1800px] space-y-4 px-6 py-6">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <GhostSurface key={index} className="p-4">
          <GhostBlock className="h-3 w-24 rounded-none" />
          <GhostBlock className="mt-3 h-8 w-16 rounded-none" />
        </GhostSurface>
      ))}
    </div>

    <GhostSurface className="overflow-hidden p-0">
      <div className="border-b-2 border-black bg-white px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <GhostBlock className="h-10 min-w-[240px] flex-1 rounded-none" />
          <GhostBlock className="h-10 w-36 rounded-none" />
          <GhostBlock className="h-10 w-28 rounded-none" />
        </div>
      </div>

      <div className="divide-y-2 divide-black">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-6 py-4">
            <GhostBlock className="h-8 w-8 rounded-none" />
            <div className="min-w-0 flex-1 space-y-2">
              <GhostBlock className="h-4 w-48 rounded-none" />
              <GhostBlock className="h-3 w-72 max-w-full rounded-none" />
            </div>
            <GhostBlock className="hidden h-8 w-20 rounded-none md:block" />
            <GhostBlock className="hidden h-8 w-16 rounded-none md:block" />
            <GhostBlock className="h-9 w-24 rounded-none" />
          </div>
        ))}
      </div>
    </GhostSurface>
  </div>
);

const MapGhostBody: React.FC = () => (
  <div className="relative flex-1 w-full bg-white">
    <div className="absolute left-6 right-6 top-6 z-10 flex flex-wrap gap-3">
      <GhostBlock className="h-16 w-44 rounded-none bg-white/90" />
      <GhostBlock className="h-16 w-44 rounded-none bg-white/90" />
      <GhostBlock className="h-16 w-36 rounded-none bg-white/90" />
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
      <div className="border-b-2 border-black px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <GhostBlock className="h-10 min-w-[220px] flex-1 rounded-none" />
          <GhostBlock className="h-10 w-32 rounded-none" />
        </div>
      </div>
      <div className="divide-y-2 divide-black">
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
        <DashboardHeaderGhost actionCount={1} />
        <MapGhostBody />
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className="min-h-screen bg-transparent font-sans text-black">
        <DashboardHeaderGhost />
        <ListGhostBody />
      </div>
    );
  }

  if (variant === 'alerts') {
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-black">
        <DashboardHeaderGhost actionCount={1} />
        <AlertsGhostBody />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent font-sans text-black">
      <DashboardHeaderGhost />
      <AnalyticsGhostBody kpiCount={variant === 'overview' ? 6 : 4} />
    </div>
  );
};

export default DashboardGhostLoader;
