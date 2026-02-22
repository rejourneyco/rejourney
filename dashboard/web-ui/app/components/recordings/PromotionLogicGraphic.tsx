import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Gauge,
  Info,
  Layers,
  Sparkles,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface PromotionStep {
  icon: React.ReactNode;
  label: string;
  category: 'critical' | 'signal';
  description: string;
}

interface PromotionLogicGraphicProps {
  mode?: 'button' | 'inline';
  className?: string;
}

export const PromotionLogicGraphic: React.FC<PromotionLogicGraphicProps> = ({
  mode = 'button',
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const steps: PromotionStep[] = useMemo(
    () => [
      {
        icon: <AlertOctagon className="h-4 w-4" />,
        label: 'Crashes',
        category: 'critical',
        description: 'App termination',
      },
      {
        icon: <Clock className="h-4 w-4" />,
        label: 'ANRs',
        category: 'critical',
        description: 'App not responding',
      },
      {
        icon: <AlertTriangle className="h-4 w-4" />,
        label: 'Errors',
        category: 'critical',
        description: 'Exceptions and failures',
      },
      {
        icon: <Gauge className="h-4 w-4" />,
        label: 'Slow API',
        category: 'signal',
        description: 'Average API latency > 1s',
      },
      {
        icon: <Activity className="h-4 w-4" />,
        label: 'Slow Startup',
        category: 'signal',
        description: 'Cold start > 3s',
      },
      {
        icon: <Zap className="h-4 w-4" />,
        label: 'Rage Taps',
        category: 'signal',
        description: 'Frustrated rapid taps',
      },
      {
        icon: <Compass className="h-4 w-4" />,
        label: 'Low Exploration',
        category: 'signal',
        description: 'User did not find a successful path',
      },
      {
        icon: <Wifi className="h-4 w-4" />,
        label: 'Network Issues',
        category: 'signal',
        description: 'Connectivity instability',
      },
      {
        icon: <Sparkles className="h-4 w-4" />,
        label: 'High Engagement',
        category: 'signal',
        description: 'Long session depth',
      },
    ],
    []
  );

  const criticalSteps = steps.filter((step) => step.category === 'critical');
  const signalSteps = steps.filter((step) => step.category === 'signal');

  const panel = (
    <div
      className={`w-full ${
        mode === 'inline' ? 'max-w-5xl' : 'max-w-4xl max-h-[90vh]'
      } overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_45px_rgba(15,23,42,0.18)]`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
            Replay Promotion
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">What We Capture</h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-500 sm:text-sm">
            Every session stores telemetry and metadata. Promotion only decides whether replay frame archives are
            persisted for playback.
          </p>
        </div>

        {mode === 'button' && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close capture details"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className={`${mode === 'button' ? 'max-h-[calc(90vh-106px)] overflow-y-auto' : ''} bg-slate-50/60 p-4 sm:p-6`}>
        <div className="space-y-4">
          <section className="dashboard-card-surface p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 sm:text-base">1. Session Ingested</h4>
                <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                  The SDK buffers runtime signals, events, and replay intent while the user interacts with the app.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600">
                Telemetry events
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600">
                Device and network context
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600">
                Replay frame stream
              </div>
            </div>
          </section>

          <section className="dashboard-card-surface p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 sm:text-base">2. Evaluation Layer</h4>
                <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                  Sessions are promoted immediately on critical incidents or scored on behavioral and performance
                  signals.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-rose-700">Critical Triggers</p>
                <div className="mt-2 space-y-2">
                  {criticalSteps.map((step) => (
                    <div key={step.label} className="flex items-center gap-2 rounded-lg border border-rose-200/80 bg-white px-2.5 py-2">
                      <span className="text-rose-600">{step.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900">{step.label}</p>
                        <p className="text-[11px] text-slate-500">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-indigo-700">Smart Signals</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {signalSteps.map((step) => (
                    <div key={step.label} className="rounded-lg border border-indigo-200/80 bg-white px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-600">{step.icon}</span>
                        <p className="text-xs font-semibold text-slate-900">{step.label}</p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{step.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Healthy sessions can still be sampled to preserve baseline replay coverage.
              </div>
              <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                ~2% Baseline Sample
              </span>
            </div>
          </section>

          <section className="dashboard-card-surface p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 sm:text-base">3. Storage Outcome</h4>
                <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                  All sessions keep core observability data. Promotion only changes whether replay artifacts are
                  retained.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Session Promoted</h5>
                </div>
                <p className="mt-2 text-xs text-emerald-900/80 sm:text-sm">
                  Replay frames plus full telemetry are retained for archive playback and deep debugging.
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-500 text-white">
                    <Database className="h-4 w-4" />
                  </span>
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Not Promoted</h5>
                </div>
                <p className="mt-2 text-xs text-amber-900/80 sm:text-sm">
                  Metadata, observability signals, and events stay available. Only replay persistence is skipped.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  if (mode === 'inline') {
    return (
      <section
        className={`w-full border-t border-slate-200 bg-gradient-to-b from-white to-slate-50/70 px-4 py-24 sm:px-6 sm:py-28 lg:px-8 ${className}`}
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">Replay Promotion</p>
            <h2 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
              How Capture Decisions Work
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              Every session contributes events and runtime context. Promotion only determines whether replay artifacts
              are persisted for playback.
            </p>
          </div>
          <div className="flex justify-center">{panel}</div>
        </div>
      </section>
    );
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        aria-expanded={isExpanded}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <Info className="h-4 w-4" />
        <span>What we capture</span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExpanded(false)}
              className="fixed inset-0 z-[90] bg-slate-900/50 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="pointer-events-auto w-full max-w-4xl">{panel}</div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
