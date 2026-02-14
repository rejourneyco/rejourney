import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Project } from '../../types';
import { createProject, createTeam, ApiTeam } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { ProjectCreatedModal } from '../ui/ProjectCreatedModal';
import { getAndroidPackageError, getIosBundleIdError } from '../../utils/validation';
import {
  LayoutDashboard,
  LineChart,
  Activity,
  Smartphone,
  Globe,
  Map,
  Database,
  Settings,
  Users,
  User,
  Plus,
  ChevronDown,
  Check,
  Apple,
  Terminal,
  AlertOctagon,
  Clock,
  MessageSquareWarning,
  Mail,
  AlertTriangle,
  CreditCard,
} from 'lucide-react';

interface SidebarProps {
  currentProject: Project | null;
  onProjectChange: (project: Project) => void;
  projects: Project[];
  loading?: boolean;
  onProjectCreated?: () => void;
  teams?: ApiTeam[];
  currentTeam?: ApiTeam | null;
  onTeamChange?: (team: ApiTeam) => void;
  teamsLoading?: boolean;
  pathPrefix?: string; // Optional prefix for paths (e.g., '/demo' for demo mode)
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentProject,
  onProjectChange,
  projects,
  loading,
  onProjectCreated,
  teams = [],
  currentTeam,
  onTeamChange,
  teamsLoading = false,
  pathPrefix = '' // Default to no prefix for normal dashboard
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showAppSelector, setShowAppSelector] = useState(false);
  const [showTeamSelector, setShowTeamSelector] = useState(false);
  const [showAddAppModal, setShowAddAppModal] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newBundleId, setNewBundleId] = useState('');
  const [newPackageName, setNewPackageName] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);
  const [teamFeedback, setTeamFeedback] = useState<string | null>(null);

  // Project created modal state
  const [showProjectCreatedModal, setShowProjectCreatedModal] = useState(false);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);

  React.useEffect(() => {
    const handleOpenAddProjectModal = () => {
      setShowAddAppModal(true);
    };
    window.addEventListener('openAddProjectModal', handleOpenAddProjectModal);
    return () => {
      window.removeEventListener('openAddProjectModal', handleOpenAddProjectModal);
    };
  }, []);

  // Helper to prefix paths for demo mode
  const p = (path: string) => pathPrefix + path;

  const navSections = [
    {
      section: 'Monitor',
      items: [
        { path: p('/issues'), label: 'Issues', icon: MessageSquareWarning },
        { path: p('/sessions'), label: 'Replays', icon: Database },
      ],
    },
    {
      section: 'Analytics',
      items: [
        { path: p('/analytics/api'), label: 'API Insights', icon: Activity },
        { path: p('/analytics/growth'), label: 'Growth', icon: LineChart },
        { path: p('/analytics/journeys'), label: 'User Journeys', icon: Map },
        { path: p('/analytics/devices'), label: 'Devices', icon: Smartphone },
        { path: p('/analytics/geo'), label: 'Geographic', icon: Globe },
      ],
    },
    {
      section: 'Stability',
      items: [
        { path: p('/stability/crashes'), label: 'Crashes', icon: AlertOctagon },
        { path: p('/stability/anrs'), label: 'ANRs', icon: Clock },
        { path: p('/stability/errors'), label: 'Errors', icon: Terminal },
      ],
    },
    {
      section: 'Workspace',
      items: [
        ...(currentProject ? [{ path: p(`/settings/${currentProject.id}`), label: 'Project', icon: Settings }] : []),
        { path: p('/team'), label: 'Team', icon: Users },
        { path: p('/billing'), label: 'Plan & Billing', icon: CreditCard },
        { path: p('/alerts/emails'), label: 'Alerts', icon: Mail },
      ],
    },
    {
      section: 'You',
      items: [
        { path: p('/account'), label: 'Account', icon: User },
      ],
    },
  ];

  // isActive needs to check if path matches, accounting for demo prefix
  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="dashboard-sidebar w-[280px] h-screen flex flex-col">
      {/* Brand & Team Switcher */}
      <div className="p-4 border-b border-slate-700/80 bg-transparent">
        <div className="relative mb-3">
          <button
            onClick={() => {
              setShowTeamSelector(!showTeamSelector);
              setShowAppSelector(false);
            }}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/80 border border-slate-700 hover:bg-slate-700 transition-colors rounded-md text-sm font-medium text-slate-100 shadow-sm"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-5 h-5 bg-sky-500/20 rounded-sm flex items-center justify-center text-sky-200 font-semibold text-xs shrink-0 border border-sky-400/30">
                {currentTeam?.name?.[0] || 'R'}
              </div>
              <span className="truncate">
                {currentTeam?.name || 'Select Team'}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-300 shrink-0" />
          </button>

          {showTeamSelector && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 shadow-lg rounded-md z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 text-xs font-semibold text-slate-300 border-b border-slate-700">
                Switch Team
              </div>
              <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => {
                      if (onTeamChange) onTeamChange(team);
                      setShowTeamSelector(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-slate-700/70 flex items-center justify-between group border-b border-slate-700 last:border-0 ${currentTeam?.id === team.id ? 'bg-sky-600/20 text-sky-100' : 'text-slate-200'}`}
                  >
                    <span className="truncate">
                      {team.name || `Team ${team.id.slice(0, 8)}...`}
                    </span>
                    {currentTeam?.id === team.id && <Check className="w-4 h-4 text-sky-300" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-slate-700 p-2 bg-slate-800/90 rounded-b-md">
                <button
                  onClick={() => {
                    setShowTeamSelector(false);
                    setShowCreateTeamModal(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-sky-200 hover:text-sky-100 font-medium flex items-center gap-2"
                >
                  <Plus className="w-3 h-3" /> Create Team
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Project Selector */}
        <div className="relative">
          <button
            onClick={() => {
              setShowAppSelector(!showAppSelector);
              setShowTeamSelector(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 border border-slate-700 hover:border-slate-500 transition-colors bg-slate-800/80 rounded-md text-sm shadow-sm ${showAppSelector ? 'border-sky-400/60' : ''}`}
          >
            <span className="font-medium text-slate-100 truncate">
              {currentProject?.name || 'Select Project'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-300" />
          </button>

          {showAppSelector && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 shadow-lg rounded-md z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 text-xs font-semibold text-slate-300 border-b border-slate-700">
                Projects
              </div>
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      onProjectChange(project);
                      setShowAppSelector(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium flex items-center justify-between border-b border-slate-700 last:border-0 ${currentProject?.id === project.id ? 'bg-sky-600/20 text-sky-100' : 'text-slate-200 hover:bg-slate-700/70'
                      }`}
                  >
                    <span className="truncate">{project.name}</span>
                    {currentProject?.id === project.id && <Check className="w-4 h-4 text-sky-300" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-slate-700 p-2 bg-slate-800/90 rounded-b-md">
                <button
                  onClick={() => {
                    setShowAppSelector(false);
                    setShowAddAppModal(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:text-slate-100 font-medium flex items-center gap-2"
                >
                  <Plus className="w-3 h-3" /> New Project
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-7 custom-scrollbar">
        {navSections.map((section) => (
          section.items.length > 0 && (
            <div key={section.section} className="space-y-2">
              <div className="px-2 text-[11px] font-semibold text-slate-400 tracking-[0.08em] uppercase">
                {section.section}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`
                      flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors rounded-md border relative
                      ${isActive(item.path)
                        ? 'bg-slate-700/80 text-white border-slate-600 shadow-sm'
                        : 'bg-transparent text-slate-300 border-transparent hover:border-slate-600/70 hover:bg-slate-700/50 hover:text-slate-100'
                      }
                    `}
                  >
                    {isActive(item.path) && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded bg-sky-400" />}
                    <item.icon className={`w-4 h-4 ${isActive(item.path) ? 'text-sky-300' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          )
        ))}
      </div>


      {/* Add Project Modal */}
      <Modal
        isOpen={showAddAppModal}
        onClose={() => {
          setShowAddAppModal(false);
          setNewAppName('');
          setNewBundleId('');
          setNewPackageName('');
          setSelectedPlatforms([]);
        }}
        title="Create New Project"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowAddAppModal(false);
                setNewAppName('');
                setNewBundleId('');
                setNewPackageName('');
                setSelectedPlatforms([]);
                setCreateError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                // ... same logic ...
                if (!newAppName || selectedPlatforms.length === 0) return;
                // Simplified logic call for brevity
                if (selectedPlatforms.includes('ios') && !newBundleId) return;
                if (selectedPlatforms.includes('android') && !newPackageName) return;

                try {
                  setIsCreating(true);
                  setCreateError(null);

                  const newProject = await createProject({
                    name: newAppName,
                    bundleId: newBundleId || undefined,
                    packageName: newPackageName || undefined,
                    teamId: currentTeam?.id,
                    platforms: selectedPlatforms,
                  });

                  // Mock minimal project object that satisfies types for now
                  const createdProjectData: Project = { ...newProject } as any;

                  setShowAddAppModal(false);
                  setNewAppName('');
                  setNewBundleId('');
                  setNewPackageName('');
                  setSelectedPlatforms([]);

                  // Show success modal with project details
                  setCreatedProject(createdProjectData);
                  setShowProjectCreatedModal(true);

                  onProjectChange(createdProjectData);
                  if (onProjectCreated) onProjectCreated();
                  window.dispatchEvent(new CustomEvent('projectCreated', { detail: newProject }));
                  navigate(p('/issues'));
                } catch (error) {
                  setCreateError(error instanceof Error ? error.message : 'Failed to create project');
                } finally {
                  setIsCreating(false);
                }
              }}
              disabled={
                isCreating ||
                !newAppName ||
                selectedPlatforms.length === 0 ||
                (selectedPlatforms.includes('ios') && !newBundleId) ||
                (selectedPlatforms.includes('android') && !newPackageName) ||
                (selectedPlatforms.includes('ios') && !!getIosBundleIdError(newBundleId)) ||
                (selectedPlatforms.includes('android') && !!getAndroidPackageError(newPackageName))
              }
            >
              {isCreating ? 'Creating...' : 'Create Project'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 pt-2">
          {createError && (
            <div className="bg-red-50 border-2 border-red-200 p-3 text-sm text-red-600 font-mono font-bold">
              {createError}
            </div>
          )}
          <Input
            label="Project Name"
            placeholder="e.g. Consumer iOS App"
            value={newAppName}
            onChange={(e) => setNewAppName(e.target.value)}
          />

          <div className="space-y-2">
            <label className="text-sm font-bold font-mono uppercase text-slate-700">Platforms</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'ios', label: 'iOS App', icon: Apple },
                { id: 'android', label: 'Android App', icon: Smartphone }
              ].map(platform => (
                <div
                  key={platform.id}
                  onClick={() => {
                    if (selectedPlatforms.includes(platform.id)) {
                      setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform.id));
                    } else {
                      setSelectedPlatforms([...selectedPlatforms, platform.id]);
                    }
                  }}
                  className={`
                      cursor-pointer border-2 rounded p-3 flex flex-col items-center gap-2 transition-all shadow-sm
                      ${selectedPlatforms.includes(platform.id)
                      ? 'border-slate-900 bg-slate-900 text-white shadow-[4px_4px_0_0_#94a3b8]'
                      : 'border-slate-200 hover:border-slate-900 hover:shadow-[2px_2px_0_0_#94a3b8]'
                    }
                   `}
                >
                  <platform.icon className={`w-6 h-6 ${selectedPlatforms.includes(platform.id) ? 'text-white' : 'text-slate-400'}`} />
                  <span className={`text-sm font-bold font-mono uppercase ${selectedPlatforms.includes(platform.id) ? 'text-white' : 'text-slate-600'}`}>{platform.label}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedPlatforms.includes('ios') && (
            <div className="space-y-3 p-4 bg-slate-50 border-2 border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Apple className="w-4 h-4 text-slate-900" />
                <h4 className="text-sm font-bold text-slate-900 font-mono uppercase">iOS Configuration</h4>
              </div>
              <Input
                label="Bundle Identifier"
                placeholder="com.example.app"
                value={newBundleId}
                onChange={(e) => setNewBundleId(e.target.value)}
              />
              {getIosBundleIdError(newBundleId) && (
                <p className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {getIosBundleIdError(newBundleId)}
                </p>
              )}
              <div className="bg-amber-50 text-amber-800 text-[10px] font-bold p-2 border border-amber-200 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>Bundle ID cannot be changed after project creation. Ensure it matches your Xcode project.</span>
              </div>
            </div>
          )}

          {selectedPlatforms.includes('android') && (
            <div className="space-y-3 p-4 bg-slate-50 border-2 border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-slate-900" />
                <h4 className="text-sm font-bold text-slate-900 font-mono uppercase">Android Configuration</h4>
              </div>
              <Input
                label="Package Name"
                placeholder="com.example.app"
                value={newPackageName}
                onChange={(e) => setNewPackageName(e.target.value)}
              />
              {getAndroidPackageError(newPackageName) && (
                <p className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {getAndroidPackageError(newPackageName)}
                </p>
              )}
              <div className="bg-amber-50 text-amber-800 text-[10px] font-bold p-2 border border-amber-200 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>Package name cannot be changed after project creation. Ensure it matches your build.gradle.</span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Create Team Modal */}
      <Modal
        isOpen={showCreateTeamModal}
        onClose={() => setShowCreateTeamModal(false)}
        title="Create Team"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreateTeamModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={async () => {
              try {
                setIsCreatingTeam(true);
                const newTeam = await createTeam(newTeamName);
                if (onTeamChange) onTeamChange(newTeam);
                setShowCreateTeamModal(false);
              } catch (e) {
                // handle error
              } finally {
                setIsCreatingTeam(false);
              }
            }}>Create Team</Button>
          </>
        }
      >
        <div className="space-y-4 pt-2">
          <Input
            label="Team Name"
            placeholder="e.g. Engineering"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
        </div>
      </Modal>

      {/* Project Created Success Modal */}
      <ProjectCreatedModal
        isOpen={showProjectCreatedModal}
        onClose={() => {
          setShowProjectCreatedModal(false);
          setCreatedProject(null);
        }}
        project={createdProject}
      />
    </div>
  );
};
