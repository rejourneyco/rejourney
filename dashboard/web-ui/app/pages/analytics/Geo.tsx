import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { getGeoIssues, GeoIssuesSummary, GeoIssueLocation, GeoIssueCountry } from '../../services/api';
import { IssuesWorldMap } from '../../components/ui/IssuesWorldMap';
import { AlertOctagon, Terminal, Clock, MousePointer2, Activity, Globe, MapPin } from 'lucide-react';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoButton } from '../../components/ui/neo/NeoButton';

type IssueType = 'all' | 'crashes' | 'anrs' | 'errors' | 'rageTaps' | 'apiErrors';

const ISSUE_TYPE_OPTIONS: { value: IssueType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'all', label: 'All Issues', icon: <Activity className="w-4 h-4" />, color: 'text-slate-600' },
  { value: 'crashes', label: 'Crashes', icon: <AlertOctagon className="w-4 h-4" />, color: 'text-red-600' },
  { value: 'anrs', label: 'ANRs', icon: <Clock className="w-4 h-4" />, color: 'text-orange-600' },
  { value: 'errors', label: 'Errors', icon: <Terminal className="w-4 h-4" />, color: 'text-amber-600' },
  { value: 'rageTaps', label: 'Rage Taps', icon: <MousePointer2 className="w-4 h-4" />, color: 'text-purple-600' },
  { value: 'apiErrors', label: 'API Errors', icon: <Activity className="w-4 h-4" />, color: 'text-blue-600' },
];

function getIssueCountForType(item: GeoIssueCountry | GeoIssueLocation, type: IssueType): number {
  if (type === 'all') return 'totalIssues' in item ? item.totalIssues : item.issues.total;
  if ('issues' in item) return item.issues[type];
  return item[type] as number;
}

export const Geo: React.FC = () => {
  const { selectedProject } = useSessionData();
  const [data, setData] = useState<GeoIssuesSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType>('all');
  const [selectedLocation, setSelectedLocation] = useState<GeoIssueLocation | null>(null);

  useEffect(() => {
    if (!selectedProject?.id) return;
    let cancelled = false;
    setData(null); // Clear stale data from previous project
    setIsLoading(true);

    getGeoIssues(selectedProject.id, timeRange === 'all' ? undefined : (timeRange === '24h' ? '1d' : timeRange))
      .then(result => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [timeRange, selectedProject?.id]);

  // Get top countries by issue count
  const topCountries = useMemo(() => {
    if (!data?.countries) return [];
    return [...data.countries]
      .sort((a, b) => getIssueCountForType(b, selectedIssueType) - getIssueCountForType(a, selectedIssueType))
      .slice(0, 8);
  }, [data, selectedIssueType]);

  // Calculate summary stats for selected issue type
  const summaryStats = useMemo(() => {
    if (!data?.summary) return { total: 0, affectedLocations: 0 };
    const total = selectedIssueType === 'all'
      ? data.summary.totalIssues
      : data.summary.byType[selectedIssueType];
    const affectedLocations = data.locations.filter(l => getIssueCountForType(l, selectedIssueType) > 0).length;
    return { total, affectedLocations };
  }, [data, selectedIssueType]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] bg-white">
        <div className="relative">
          <div className="w-24 h-24 border-8 border-black border-t-indigo-500 rounded-full animate-spin shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Globe className="w-8 h-8 text-black animate-pulse" />
          </div>
        </div>
        <div className="mt-12 text-4xl font-black uppercase tracking-tighter text-black animate-bounce">
          Scanning Regions...
        </div>
        <div className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
          Correlating Global Failure Patterns
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white border-b-4 border-black">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-[1800px] mx-auto w-full">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                Geo Intelligence
              </h1>
              <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                <div className="h-3 w-1 bg-indigo-500"></div>
                {summaryStats.total.toLocaleString()} issues across {summaryStats.affectedLocations} locations
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
              <span className="text-[10px] font-black uppercase text-slate-400">Live Global Monitoring</span>
            </div>
            <TimeFilter value={timeRange} onChange={setTimeRange} />
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 md:p-12 space-y-12 max-w-[1800px] mx-auto w-full">

        {/* Issue Type Selector */}
        <div className="flex flex-wrap gap-3">
          {ISSUE_TYPE_OPTIONS.map(option => (
            <NeoButton
              key={option.value}
              size="sm"
              variant={selectedIssueType === option.value ? 'primary' : 'ghost'}
              onClick={() => setSelectedIssueType(option.value)}
              className={`border-2 border-black ${selectedIssueType === option.value ? 'shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : ''}`}
              leftIcon={option.icon}
            >
              <div className="flex items-center gap-2">
                <span className="uppercase">{option.label}</span>
                {data?.summary && (
                  <NeoBadge
                    variant={selectedIssueType === option.value ? 'neutral' : 'info'}
                    size="sm"
                    className={selectedIssueType === option.value ? 'bg-white text-black' : ''}
                  >
                    {option.value === 'all' ? data.summary.totalIssues : data.summary.byType[option.value]}
                  </NeoBadge>
                )}
              </div>
            </NeoButton>
          ))}
        </div>

        {/* Map Container */}
        < IssuesWorldMap
          locations={data?.locations || []}
          selectedIssueType={selectedIssueType}
          onLocationClick={setSelectedLocation}
        />

        {/* Bottom Section: Country List + Selected Location Details */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-12">

          {/* Top Affected Countries */}
          <div className="xl:col-span-2 space-y-6">
            <h2 className="text-2xl font-black text-black uppercase tracking-tighter flex items-center gap-3">
              <Globe className="w-8 h-8 text-black" /> Affected Regions
            </h2>

            <div className="bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b-4 border-black bg-slate-50 font-black uppercase text-black">
                      <th className="p-4 tracking-wider">#</th>
                      <th className="p-4 tracking-wider">Region</th>
                      <th className="p-4 tracking-wider text-right">Traffic</th>
                      <th className="p-4 tracking-wider text-right">Failure Map</th>
                      <th className="p-4 tracking-wider text-right">Intensity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-100">
                    {topCountries.map((country, i) => {
                      const issueRate = country.issueRate;
                      const rateColor = issueRate > 0.3 ? 'danger' : issueRate > 0.15 ? 'warning' : 'success';

                      return (
                        <tr key={country.country} className="hover:bg-indigo-50/30 transition-colors group">
                          <td className="p-4 font-black text-slate-300">#{i + 1}</td>
                          <td className="p-4 font-black text-black uppercase tracking-tight">{country.country}</td>
                          <td className="p-4 text-right font-black text-slate-400">{country.sessions.toLocaleString()} SESS</td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {country.crashes > 0 && <NeoBadge variant="danger" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{country.crashes} C</NeoBadge>}
                              {country.anrs > 0 && <NeoBadge variant="anr" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{country.anrs} A</NeoBadge>}
                              {country.errors > 0 && <NeoBadge variant="warning" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{country.errors} E</NeoBadge>}
                              {country.rageTaps > 0 && <NeoBadge variant="rage" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{country.rageTaps} R</NeoBadge>}
                            </div>
                          </td>
                          <td className="p-4 text-right font-black">
                            <NeoBadge variant={rateColor} size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                              {(issueRate * 100).toFixed(1)}% FAILURE
                            </NeoBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Issue Type Breakdown + Selection */}
          <div className="space-y-8">
            <NeoCard className="p-6 border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] bg-white">
              <h2 className="text-xl font-black uppercase tracking-tighter mb-6 flex items-center gap-2 border-b-2 border-black pb-2">
                <Activity className="w-5 h-5" /> Global Issue Mass
              </h2>
              <div className="space-y-6">
                {data?.summary && (
                  <>
                    <IssueBar label="CRASHES" count={data.summary.byType.crashes} total={data.summary.totalIssues} color="bg-red-500" icon={<AlertOctagon className="w-4 h-4 text-red-500" />} />
                    <IssueBar label="ANRs" count={data.summary.byType.anrs} total={data.summary.totalIssues} color="bg-orange-500" icon={<Clock className="w-4 h-4 text-orange-500" />} />
                    <IssueBar label="ERRORS" count={data.summary.byType.errors} total={data.summary.totalIssues} color="bg-amber-500" icon={<Terminal className="w-4 h-4 text-amber-500" />} />
                    <IssueBar label="RAGE" count={data.summary.byType.rageTaps} total={data.summary.totalIssues} color="bg-purple-500" icon={<MousePointer2 className="w-4 h-4 text-purple-500" />} />
                    <IssueBar label="API" count={data.summary.byType.apiErrors} total={data.summary.totalIssues} color="bg-blue-500" icon={<Activity className="w-4 h-4 text-blue-500" />} />
                  </>
                )}
              </div>
            </NeoCard>

            {/* Selected Location Details */}
            {selectedLocation && (
              <NeoCard className="p-6 border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] bg-slate-900 text-white">
                <h2 className="text-xl font-black uppercase tracking-tighter mb-6 flex items-center gap-2 border-b-2 border-white/20 pb-2">
                  <MapPin className="w-5 h-5 text-indigo-400" /> Focus Point
                </h2>
                <div>
                  <div className="font-black text-2xl uppercase tracking-tighter">{selectedLocation.city}</div>
                  <div className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-6">{selectedLocation.country}</div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center bg-white/5 p-3 border-2 border-white/10 rounded-xl">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-60 text-white">Sessions</span>
                      <span className="font-mono font-black text-white text-lg">{selectedLocation.sessions.toLocaleString()}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-6">
                      <div className="p-3 border-2 border-black bg-red-500/10 rounded-lg">
                        <span className="block text-[8px] font-black text-red-400 uppercase">Crashes</span>
                        <span className="text-xl font-black text-red-500">{selectedLocation.issues.crashes}</span>
                      </div>
                      <div className="p-3 border-2 border-black bg-orange-500/10 rounded-lg">
                        <span className="block text-[8px] font-black text-orange-400 uppercase">ANRs</span>
                        <span className="text-xl font-black text-orange-500">{selectedLocation.issues.anrs}</span>
                      </div>
                      <div className="p-3 border-2 border-black bg-amber-500/10 rounded-lg">
                        <span className="block text-[8px] font-black text-amber-400 uppercase">Errors</span>
                        <span className="text-xl font-black text-amber-500">{selectedLocation.issues.errors}</span>
                      </div>
                      <div className="p-3 border-2 border-black bg-purple-500/10 rounded-lg">
                        <span className="block text-[8px] font-black text-purple-400 uppercase">Rage</span>
                        <span className="text-xl font-black text-purple-500">{selectedLocation.issues.rageTaps}</span>
                      </div>
                    </div>

                    <div className="mt-8 p-4 bg-white text-black border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]">
                      <div className="flex justify-between items-center">
                        <span className="font-black uppercase tracking-tighter text-sm">Aggregated Issues</span>
                        <span className="font-mono font-black text-2xl">{selectedLocation.issues.total}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </NeoCard>
            ) || (
                <div className="h-64 flex flex-col items-center justify-center border-4 border-dashed border-slate-200 rounded-2xl bg-slate-50 transition-all hover:bg-slate-100 group">
                  <MapPin className="w-12 h-12 text-slate-200 group-hover:text-indigo-200 transition-colors mb-4" />
                  <span className="text-xs font-black text-slate-300 uppercase tracking-widest text-center px-8">
                    Select coordinate on map for focus analysis
                  </span>
                </div>
              )}
          </div>
        </div>
      </div>
    </div >
  );
};

// Helper component for issue distribution bars
const IssueBar: React.FC<{ label: string; count: number; total: number; color: string; icon: React.ReactNode }> = ({
  label, count, total, color, icon
}) => {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="group">
      <div className="flex justify-between items-end mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[10px] font-black uppercase tracking-widest text-black group-hover:text-indigo-500 transition-colors">{label}</span>
        </div>
        <span className="font-mono font-black text-black">{count.toLocaleString()}</span>
      </div>
      <div className="h-4 bg-slate-100 border-2 border-black p-0.5 overflow-hidden shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all">
        <div
          className={`h-full ${color} transition-all duration-700 ease-out border-r border-black`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-right text-[10px] font-black text-slate-400 mt-1 uppercase tracking-tighter">
        {percentage.toFixed(1)}% OF TOTAL
      </div>
    </div>
  );
};

export default Geo;
