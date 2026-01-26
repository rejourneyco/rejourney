import React, { useState, useMemo } from 'react';
import {
  AlertOctagon,
  Clock,
  Zap,
  Gauge,
  Activity,
  Compass,
  Wifi,
  Sparkles,
  ArrowDown,
  Info,
  X,
  CheckCircle2,
  AlertTriangle,
  Monitor,
  MousePointer2,
  Cpu,
  Layers,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PromotionStep {
  icon: React.ReactNode;
  label: string;
  category: 'critical' | 'signal' | 'baseline';
  description: string;
}

export const PromotionLogicGraphic: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  const steps: PromotionStep[] = useMemo(() => [
    { icon: <AlertOctagon className="w-5 h-5" />, label: 'Crashes', category: 'critical', description: 'App termination' },
    { icon: <Clock className="w-5 h-5" />, label: 'ANRs', category: 'critical', description: 'App Not Responding' },
    { icon: <AlertTriangle className="w-5 h-5" />, label: 'Errors', category: 'critical', description: 'Exceptions & failures' },
    { icon: <Gauge className="w-5 h-5" />, label: 'Slow API', category: 'signal', description: 'Requests > 3s' },
    { icon: <Activity className="w-5 h-5" />, label: 'Slow Startup', category: 'signal', description: 'Cold start > 2s' },
    { icon: <Zap className="w-5 h-5" />, label: 'Rage Taps', category: 'signal', description: 'Frustrated interaction' },
    { icon: <Compass className="w-5 h-5" />, label: 'Low Exploration', category: 'signal', description: 'User got lost' },
    { icon: <Wifi className="w-5 h-5" />, label: 'Network Issues', category: 'signal', description: 'Connection drops' },
    { icon: <Sparkles className="w-5 h-5" />, label: 'High Engagement', category: 'signal', description: 'Long session' },
  ], []);

  return (
    <div className="relative inline-block isolate z-20">
      {/* Compact Info Button - Neo Brutalist */}
      <button
        onClick={() => setIsExpanded(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all rounded-none group active:bg-yellow-300"
      >
        <Info className="w-4 h-4 text-black group-hover:rotate-12 transition-transform" />
        <span className="text-[11px] font-black uppercase tracking-tight text-black">
          What we capture
        </span>
      </button>

      {/* Expanded Modal */}
      <AnimatePresence>
        {isExpanded && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExpanded(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90]"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="w-full max-w-4xl max-h-[90vh] bg-white border-[6px] border-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col pointer-events-auto overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b-[4px] border-black bg-yellow-300">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-black flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(255,255,255,1)]">
                      <Monitor className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-tighter text-black leading-none">
                        Capture Logic
                      </h3>
                      <p className="text-[10px] font-bold text-black uppercase tracking-wide mt-0.5">
                        Intelligence Engine v2.0
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="w-8 h-8 flex items-center justify-center bg-white border-[3px] border-black hover:bg-black hover:text-white transition-colors shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
                  <div className="max-w-2xl mx-auto space-y-4">

                    {/* Stage 1: Ingestion */}
                    <div className="relative pl-8 md:pl-0">
                      {/* Connecting Line for mobile */}
                      <div className="absolute left-[19px] top-8 bottom-[-20px] w-[4px] bg-black md:hidden"></div>

                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        {/* Number Badge */}
                        <div className="hidden md:flex flex-col items-center gap-1 min-w-[60px]">
                          <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center text-lg font-black border-[3px] border-black">1</div>
                        </div>

                        <div className="flex-1 bg-white border-[3px] border-black p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] relative">
                          <div className="absolute -left-2 -top-2 bg-blue-500 text-white px-2 py-0.5 border-[2px] border-black text-[10px] font-black uppercase transform -rotate-1">
                            Start
                          </div>
                          <div className="flex items-start gap-3">
                            <div className="p-2 bg-blue-100 border-[2px] border-black flex-shrink-0">
                              <Layers className="w-5 h-5 text-black" />
                            </div>
                            <div>
                              <h4 className="text-base font-black uppercase text-black">Session Ingested</h4>
                              <p className="text-xs font-bold text-slate-600 mt-0.5">
                                SDK buffers the session in memory. Real-time analysis begins immediately.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Arrow Down */}
                    <div className="hidden md:flex justify-center py-1 pl-[60px]">
                      <ArrowDown className="w-6 h-6 text-black" />
                    </div>

                    {/* Stage 2: Evaluation */}
                    <div className="relative pl-8 md:pl-0">
                      <div className="absolute left-[19px] top-0 bottom-[-20px] w-[4px] bg-black md:hidden"></div>

                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="hidden md:flex flex-col items-center gap-1 min-w-[60px]">
                          <div className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center text-lg font-black border-[3px] border-black">2</div>
                        </div>

                        <div className="flex-1 bg-white border-[3px] border-black p-0 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                          <div className="bg-black text-white p-2 border-b-[3px] border-black flex justify-between items-center">
                            <span className="font-black uppercase tracking-wider text-[11px] flex items-center gap-2">
                              <Cpu className="w-3.5 h-3.5" /> Evaluation Layer
                            </span>
                            <span className="text-[9px] font-mono bg-white text-black px-1">AUTO-SCORING</span>
                          </div>

                          <div className="p-4 space-y-4">
                            {/* Critical Section */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-2.5 h-2.5 bg-red-500 border-2 border-black"></div>
                                <h5 className="font-black uppercase text-[11px]">Critical Hits</h5>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                {steps.filter(s => s.category === 'critical').map((step, i) => (
                                  <div key={i} className="flex items-center p-1.5 border-[2px] border-black bg-red-50 hover:bg-red-100 transition-colors gap-2">
                                    <div className="text-red-600 scale-90">{step.icon}</div>
                                    <div>
                                      <div className="text-[10px] font-black uppercase">{step.label}</div>
                                      <div className="text-[8px] font-bold text-slate-500 uppercase">{step.description}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Signals Section */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-2.5 h-2.5 bg-indigo-500 border-2 border-black"></div>
                                <h5 className="font-black uppercase text-[11px]">Smart Signals</h5>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                {steps.filter(s => s.category === 'signal').map((step, i) => (
                                  <div key={i} className="flex flex-col p-1.5 border-[2px] border-black bg-indigo-50/50 hover:bg-indigo-100 transition-colors">
                                    <div className="flex items-center gap-2">
                                      <div className="text-indigo-600 scale-75 origin-left flex-shrink-0">{step.icon}</div>
                                      <span className="text-[9px] font-black uppercase truncate">{step.label}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Random Sample Section */}
                            <div className="bg-slate-100 border-[2px] border-black p-2 flex items-center justify-between border-dashed">
                              <div className="flex items-center gap-2">
                                <Database className="w-4 h-4 text-slate-500" />
                                <div>
                                  <div className="text-[10px] font-black uppercase">Or Random Sample</div>
                                  <div className="text-[8px] text-slate-500 font-bold uppercase">For healthy baselines</div>
                                </div>
                              </div>
                              <div className="bg-black text-white text-[9px] font-bold px-1.5 py-0.5 border-2 border-slate-800">
                                ~2% KEPT
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Arrow Down */}
                    <div className="hidden md:flex justify-center py-1 pl-[60px]">
                      <ArrowDown className="w-6 h-6 text-black" />
                    </div>

                    {/* Stage 3: Decision */}
                    <div className="relative pl-8 md:pl-0">
                      {/* End of line for mobile */}
                      <div className="absolute left-[19px] top-0 h-6 w-[4px] bg-black md:hidden"></div>

                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="hidden md:flex flex-col items-center gap-1 min-w-[60px]">
                          <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center text-lg font-black border-[3px] border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,0.2)]">3</div>
                        </div>

                        <div className="flex-1 bg-green-400 border-[3px] border-black p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-black border-[2px] border-black flex-shrink-0">
                              <CheckCircle2 className="w-5 h-5 text-green-400" />
                            </div>
                            <div>
                              <h4 className="text-base font-black uppercase text-black">Session Promoted</h4>
                              <p className="text-xs font-bold text-black/80 mt-0.5">
                                Full replay & events are persisted to storage.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Footer */}
                <div className="p-3 border-t-[3px] border-black bg-slate-50 text-[9px] font-bold text-slate-500 uppercase text-center tracking-widest">
                  Privacy First • Intelligence Driven • Cost Optimized
                </div>

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

