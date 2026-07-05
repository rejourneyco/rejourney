import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Code2,
  Copy,
  ExternalLink,
  KeyRound,
  LifeBuoy,
  Mail,
  Send,
  Terminal,
  X,
  Users,
} from 'lucide-react';
import { addTeamMember, createTeam, sendProjectSetupEmail, updateTeam } from '~/shared/api/client';
import {
  buildProjectAIPromptById,
  getAIPromptDefinition,
  getAIPromptIdsForProject,
} from '~/shared/constants/aiPrompts';
import { cn } from '~/shared/lib/cn';
import { useAuth } from '~/shared/providers/AuthContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { Button } from '~/shared/ui/core/Button';
import { Modal } from '~/shared/ui/core/Modal';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { Input } from '~/shared/ui/core/Input';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import type { Project } from '~/shared/types';
import { CreateProjectForm } from './CreateProjectForm';
import {
  buildDeveloperSetupEmail,
  formatProjectPlatforms,
  projectHasRecentData,
} from './setupUtils';

type CopyTarget = 'key' | 'prompt' | 'instructions' | 'contact' | null;
type TeamInviteRole = 'member' | 'admin';
type TeammateInviteRecipient = {
  email: string;
  role: TeamInviteRole;
};

const setupCardClass = "relative overflow-hidden border border-white/45 dark:border-slate-900/40 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-6 rounded-2xl shadow-xl shadow-slate-100/30 dark:shadow-none hover:shadow-2xl hover:border-indigo-500/30 transition-all duration-300 z-10";
const setupActionButtonClass = "!text-xs !font-bold uppercase tracking-normal";
const setupProjectFormId = 'setup-project-form';

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseInviteEmails(value: string): { emails: string[]; invalidEmails: string[] } {
  const tokens = value
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  const emails: string[] = [];
  const invalidEmails: string[] = [];
  const seen = new Set<string>();

  tokens.forEach((email) => {
    if (seen.has(email)) return;
    seen.add(email);
    if (isValidEmailAddress(email)) {
      emails.push(email);
    } else {
      invalidEmails.push(email);
    }
  });

  return { emails, invalidEmails };
}

export const SetupRoute: React.FC = () => {
  const { user } = useAuth();
  const {
    teams,
    currentTeam,
    teamMembers,
    setCurrentTeam,
    refreshTeams,
    refreshMembers,
    isLoading: teamsLoading,
  } = useTeam();
  const {
    projects,
    selectedProject,
    setSelectedProject,
    refreshSessions,
    projectsLoading,
  } = useSessionData();
  const [searchParams] = useSearchParams();
  const pathPrefix = usePathPrefix();

  const [newTeamName, setNewTeamName] = useState('');
  const [teamError, setTeamError] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspaceConfirmError, setWorkspaceConfirmError] = useState<string | null>(null);
  const [isConfirmingWorkspace, setIsConfirmingWorkspace] = useState(false);
  const [teammateInviteEmails, setTeammateInviteEmails] = useState('');
  const [teammateInviteRole, setTeammateInviteRole] = useState<TeamInviteRole>('member');
  const [teammateInviteRecipients, setTeammateInviteRecipients] = useState<TeammateInviteRecipient[]>([]);
  const [teammateInviteError, setTeammateInviteError] = useState<string | null>(null);
  const [teammateInviteState, setTeammateInviteState] = useState<string | null>(null);
  const [teammateInviteStateKind, setTeammateInviteStateKind] = useState<'success' | 'error' | null>(null);
  const [isInvitingTeammates, setIsInvitingTeammates] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);
  const [developerEmail, setDeveloperEmail] = useState('');
  const [developerEmailError, setDeveloperEmailError] = useState<string | null>(null);
  const [developerCanManageSetup, setDeveloperCanManageSetup] = useState(false);
  const [inviteState, setInviteState] = useState<string | null>(null);
  const [inviteStateKind, setInviteStateKind] = useState<'success' | 'error' | null>(null);
  const [isInvitingDeveloper, setIsInvitingDeveloper] = useState(false);

  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailRecipientError, setEmailRecipientError] = useState<string | null>(null);
  const [emailSendState, setEmailSendState] = useState<string | null>(null);
  const [emailSendStateKind, setEmailSendStateKind] = useState<'success' | 'error' | null>(null);
  const [isSendingSetupEmail, setIsSendingSetupEmail] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  const [isEditingProject, setIsEditingProject] = useState(false);
  const [manualStep, setManualStep] = useState<number | null>(null);

  const isJoinedTeam = searchParams.get('joinedTeam') === '1';
  const currentMember = teamMembers.find((member) => member.userId === user?.id);
  const isOwner = currentTeam?.ownerUserId === user?.id;
  const canManageTeam = Boolean(isOwner || currentMember?.role === 'admin');
  const activeProject = selectedProject ?? projects[0] ?? null;
  const hasRecentData = projectHasRecentData(activeProject);
  const defaultWorkspaceName = user?.email ? `${user.email.split('@')[0]}'s Team` : null;
  const isAutoCreatedWorkspace = Boolean(currentTeam?.name && defaultWorkspaceName && currentTeam.name === defaultWorkspaceName);
  const hasMeaningfulSetup = Boolean(projects.length > 0 || activeProject || hasRecentData);
  const workspaceNeedsConfirmation = Boolean(
    currentTeam
    && isAutoCreatedWorkspace
    && !isJoinedTeam
    && !currentTeam.workspaceConfirmedAt
    && !hasMeaningfulSetup,
  );
  const workspaceDone = Boolean(currentTeam && !workspaceNeedsConfirmation);
  const projectDone = Boolean(activeProject);
  const verifyDone = hasRecentData;

  const suggestedStepIndex = !workspaceDone
    ? 0
    : !projectDone
      ? 1
      : !verifyDone
        ? 2
        : 3;
  const highestAccessibleStepIndex = !workspaceDone
    ? 0
    : !projectDone
      ? 1
      : 3;

  const activeStepIndex = manualStep !== null
    ? Math.min(manualStep, highestAccessibleStepIndex)
    : suggestedStepIndex;

  useEffect(() => {
    setManualStep(null);
    setIsEditingProject(false);
  }, [suggestedStepIndex]);

  useEffect(() => {
    setWorkspaceNameDraft(currentTeam?.name ?? '');
    setWorkspaceConfirmError(null);
  }, [currentTeam?.id, currentTeam?.name]);

  const promptProjectContext = useMemo(() => ({
    ...(activeProject ?? {}),
    teamName: currentTeam?.name ?? undefined,
  }), [activeProject, currentTeam?.name]);
  const aiSetupInstructionPrompts = useMemo(() => {
    return getAIPromptIdsForProject(promptProjectContext).map((promptId) => {
      const definition = getAIPromptDefinition(promptId);
      return {
        id: promptId,
        label: definition.label,
        promptText: buildProjectAIPromptById(promptId, promptProjectContext),
      };
    });
  }, [promptProjectContext]);
  const aiPrompt = useMemo(() => {
    if (aiSetupInstructionPrompts.length === 1) return aiSetupInstructionPrompts[0].promptText;

    return [
      'Use the matching Rejourney AI setup instructions for this project.',
      'Choose the section that matches the app you are editing and follow it exactly.',
      '',
      ...aiSetupInstructionPrompts.flatMap((prompt) => [
        '==========================================================',
        `AI SETUP INSTRUCTIONS: ${prompt.label}`,
        '==========================================================',
        '',
        prompt.promptText,
        '',
      ]),
    ].join('\n').trim();
  }, [aiSetupInstructionPrompts]);

  const simpleEmailBody = useMemo(() => {
    if (!activeProject) return '';
    return buildDeveloperSetupEmail({
      project: activeProject,
      teamName: currentTeam?.name,
      aiPrompt,
    });
  }, [activeProject, aiPrompt, currentTeam?.name]);

  const copyText = useCallback(async (text: string, target: Exclude<CopyTarget, null>) => {
    await navigator.clipboard.writeText(text);
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget((current) => current === target ? null : current), 1800);
  }, []);

  const openEmailModal = useCallback(() => {
    setEmailRecipientError(null);
    setEmailSendState(null);
    setEmailSendStateKind(null);
    setIsEmailModalOpen(true);
  }, []);

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) {
      setTeamError('Add a team name first.');
      return;
    }
    try {
      setIsCreatingTeam(true);
      setTeamError(null);
      const team = await createTeam(name);
      setCurrentTeam(team);
      await refreshTeams(team.id);
      window.dispatchEvent(new CustomEvent('teamCreated', { detail: { teamId: team.id } }));
      setNewTeamName('');
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Failed to create team');
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleConfirmWorkspace = async () => {
    if (!currentTeam) return;
    const name = workspaceNameDraft.trim();
    if (!name) {
      setWorkspaceConfirmError('Add a workspace name before continuing.');
      return;
    }

    try {
      setIsConfirmingWorkspace(true);
      setWorkspaceConfirmError(null);
      const teamToUse = await updateTeam(currentTeam.id, {
        ...(name !== (currentTeam.name ?? '') ? { name } : {}),
        workspaceConfirmed: true,
      });
      setCurrentTeam(teamToUse);
      await refreshTeams(teamToUse.id);
      setManualStep(1);
    } catch (error) {
      setWorkspaceConfirmError(error instanceof Error ? error.message : 'Failed to save workspace.');
    } finally {
      setIsConfirmingWorkspace(false);
    }
  };

  const handleAddTeammateDraft = () => {
    const { emails, invalidEmails } = parseInviteEmails(teammateInviteEmails);
    if (!emails.length) {
      setTeammateInviteError('Enter one or more teammate emails.');
      return;
    }
    if (invalidEmails.length) {
      setTeammateInviteError(`Check ${invalidEmails.slice(0, 3).join(', ')}${invalidEmails.length > 3 ? '...' : ''}`);
      return;
    }

    setTeammateInviteRecipients((current) => {
      const next = [...current];
      emails.forEach((email) => {
        const existingIndex = next.findIndex((recipient) => recipient.email === email);
        if (existingIndex >= 0) {
          next[existingIndex] = { ...next[existingIndex], role: teammateInviteRole };
        } else {
          next.push({ email, role: teammateInviteRole });
        }
      });
      return next;
    });
    setTeammateInviteEmails('');
    setTeammateInviteError(null);
    setTeammateInviteState(null);
    setTeammateInviteStateKind(null);
  };

  const updateTeammateInviteRole = (email: string, role: TeamInviteRole) => {
    setTeammateInviteRecipients((current) => current.map((recipient) => (
      recipient.email === email ? { ...recipient, role } : recipient
    )));
  };

  const removeTeammateInviteRecipient = (email: string) => {
    setTeammateInviteRecipients((current) => current.filter((recipient) => recipient.email !== email));
  };

  const handleProjectCreated = async (project: Project) => {
    setSelectedProject(project);
    window.dispatchEvent(new CustomEvent('projectCreated', { detail: project }));
    await refreshSessions();
  };

  const handleOpenDashboard = () => {
    if (activeProject) {
      document.cookie = `bypass_setup_${activeProject.id}=true; path=/; max-age=31536000`;
    }
  };

  const handleInviteTeammates = async () => {
    if (isInvitingTeammates) return;
    if (!currentTeam?.id) {
      setTeammateInviteState('Create or select a workspace before inviting teammates.');
      setTeammateInviteStateKind('error');
      return;
    }

    let recipients = teammateInviteRecipients;
    if (teammateInviteEmails.trim()) {
      const { emails, invalidEmails } = parseInviteEmails(teammateInviteEmails);
      if (invalidEmails.length) {
        setTeammateInviteError(`Check ${invalidEmails.slice(0, 3).join(', ')}${invalidEmails.length > 3 ? '...' : ''}`);
        setTeammateInviteState(null);
        setTeammateInviteStateKind(null);
        return;
      }
      const merged = [...teammateInviteRecipients];
      emails.forEach((email) => {
        const existingIndex = merged.findIndex((recipient) => recipient.email === email);
        if (existingIndex >= 0) {
          merged[existingIndex] = { ...merged[existingIndex], role: teammateInviteRole };
        } else {
          merged.push({ email, role: teammateInviteRole });
        }
      });
      recipients = merged;
      setTeammateInviteRecipients(merged);
      setTeammateInviteEmails('');
    }

    if (!recipients.length) {
      setTeammateInviteError('Add at least one teammate before inviting.');
      setTeammateInviteState(null);
      setTeammateInviteStateKind(null);
      return;
    }

    try {
      setIsInvitingTeammates(true);
      setTeammateInviteError(null);
      setTeammateInviteState(null);
      setTeammateInviteStateKind(null);

      let addedCount = 0;
      let invitedCount = 0;
      const failures: string[] = [];

      for (const recipient of recipients) {
        try {
          const result = await addTeamMember(currentTeam.id, recipient.email, recipient.role);
          if (result.member) {
            addedCount += 1;
          } else {
            invitedCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invite failed';
          failures.push(`${recipient.email}: ${message}`);
        }
      }

      const successCount = addedCount + invitedCount;
      if (successCount > 0) {
        await Promise.all([refreshTeams(currentTeam.id), refreshMembers()]);
      }

      const successParts = [
        invitedCount ? `${invitedCount} invite${invitedCount === 1 ? '' : 's'} sent` : null,
        addedCount ? `${addedCount} teammate${addedCount === 1 ? '' : 's'} added` : null,
      ].filter(Boolean);

      if (successCount > 0 && failures.length === 0) {
        setTeammateInviteState(`${successParts.join(' and ')}.`);
        setTeammateInviteStateKind('success');
        setTeammateInviteEmails('');
        setTeammateInviteRecipients([]);
      } else if (successCount > 0) {
        setTeammateInviteState(`${successParts.join(' and ')}. ${failures.length} failed: ${failures.slice(0, 2).join('; ')}${failures.length > 2 ? '...' : ''}`);
        setTeammateInviteStateKind('success');
        setTeammateInviteRecipients((current) => current.filter((recipient) => (
          failures.some((failure) => failure.startsWith(`${recipient.email}:`))
        )));
      } else {
        setTeammateInviteState(failures.slice(0, 2).join('; ') || 'Failed to invite teammates.');
        setTeammateInviteStateKind('error');
      }
    } catch (error) {
      setTeammateInviteState(error instanceof Error ? error.message : 'Failed to invite teammates.');
      setTeammateInviteStateKind('error');
    } finally {
      setIsInvitingTeammates(false);
    }
  };

  const handleInviteDeveloper = async () => {
    const normalizedEmail = developerEmail.trim();
    if (!currentTeam?.id) {
      setInviteState('Create or select a team before inviting a developer.');
      setInviteStateKind('error');
      return;
    }
    if (!normalizedEmail) {
      setDeveloperEmailError('Enter a developer email first.');
      setInviteState(null);
      setInviteStateKind(null);
      return;
    }
    if (!isValidEmailAddress(normalizedEmail)) {
      setDeveloperEmailError('Enter a valid email address.');
      setInviteState(null);
      setInviteStateKind(null);
      return;
    }
    try {
      setIsInvitingDeveloper(true);
      setInviteState(null);
      setInviteStateKind(null);
      setDeveloperEmailError(null);
      const role = developerCanManageSetup ? 'admin' : 'member';
      const result = await addTeamMember(currentTeam.id, normalizedEmail, role);
      setInviteState(result.invitation
        ? 'Invitation sent. They will get an email with a join link.'
        : 'Developer added to the team.');
      setInviteStateKind('success');
      setDeveloperEmail('');
      await Promise.all([refreshTeams(currentTeam.id), refreshMembers()]);
    } catch (error) {
      setInviteState(error instanceof Error ? error.message : 'Failed to invite developer');
      setInviteStateKind('error');
    } finally {
      setIsInvitingDeveloper(false);
    }
  };

  const handleSendSetupEmail = async () => {
    const normalizedEmail = emailRecipient.trim();
    if (!activeProject?.id) {
      setEmailSendState('Create a project before sending setup instructions.');
      setEmailSendStateKind('error');
      return;
    }
    if (!normalizedEmail) {
      setEmailRecipientError('Enter a developer email first.');
      setEmailSendState(null);
      setEmailSendStateKind(null);
      return;
    }
    if (!isValidEmailAddress(normalizedEmail)) {
      setEmailRecipientError('Enter a valid email address.');
      setEmailSendState(null);
      setEmailSendStateKind(null);
      return;
    }

    try {
      setIsSendingSetupEmail(true);
      setEmailRecipientError(null);
      setEmailSendState(null);
      setEmailSendStateKind(null);
      await sendProjectSetupEmail(activeProject.id, {
        email: normalizedEmail,
        aiPrompt,
      });
      setEmailSendState(`Setup instructions sent to ${normalizedEmail}.`);
      setEmailSendStateKind('success');
    } catch (error) {
      setEmailSendState(error instanceof Error ? error.message : 'Failed to send setup instructions.');
      setEmailSendStateKind('error');
    } finally {
      setIsSendingSetupEmail(false);
    }
  };

  if (teamsLoading || projectsLoading) {
    return <DashboardGhostLoader variant="settings" />;
  }

  const setupSteps = [
    { label: 'Workspace', done: workspaceDone, active: activeStepIndex === 0 },
    { label: 'Project', done: projectDone, active: activeStepIndex === 1 },
    { label: 'Handoff', done: projectDone && (activeStepIndex > 2 || verifyDone), active: activeStepIndex === 2 },
    { label: 'Verify', done: verifyDone, active: activeStepIndex === 3 },
  ];

  const actionBarTitle = setupSteps[activeStepIndex]?.label ?? 'Setup';
  const actionBarHint = activeStepIndex === 0
    ? currentTeam ? workspaceNeedsConfirmation ? 'Confirm this starter workspace' : 'Workspace ready' : 'Create a workspace to continue'
    : activeStepIndex === 1
      ? activeProject && !isEditingProject ? 'Project selected' : isEditingProject ? 'Editing project' : 'Create a project to continue'
      : activeStepIndex === 2
        ? 'Send or copy setup details'
        : hasRecentData ? 'Connection verified' : 'Waiting for first session';

  const actionBarSecondaryActions: React.ReactNode[] = [];
  let actionBarPrimaryAction: React.ReactNode = null;

  if (activeStepIndex === 0) {
    actionBarPrimaryAction = currentTeam ? (
      <Button
        key="workspace-next"
        type="button"
        size="sm"
        variant="primary"
        onClick={workspaceNeedsConfirmation ? handleConfirmWorkspace : () => setManualStep(1)}
        disabled={isConfirmingWorkspace || (workspaceNeedsConfirmation && !workspaceNameDraft.trim())}
        rightIcon={<ArrowRight />}
        className={cn(setupActionButtonClass, "!rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        {isConfirmingWorkspace ? 'Saving...' : workspaceNeedsConfirmation ? 'Save Workspace' : 'Next'}
      </Button>
    ) : (
      <Button
        key="workspace-create"
        type="button"
        size="sm"
        variant="primary"
        onClick={handleCreateTeam}
        disabled={isCreatingTeam || !newTeamName.trim()}
        className={cn(setupActionButtonClass, "!rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        {isCreatingTeam ? 'Creating...' : 'Create Team'}
      </Button>
    );
  } else if (activeStepIndex === 1) {
    actionBarSecondaryActions.push(
      <Button
        key="project-back"
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setManualStep(0)}
        className={cn(setupActionButtonClass, "!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        Back
      </Button>
    );

    if (activeProject && !isEditingProject) {
      actionBarSecondaryActions.push(
        <Button
          key="project-edit"
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setIsEditingProject(true)}
          className={cn(setupActionButtonClass, "!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
        >
          Edit
        </Button>
      );
      actionBarPrimaryAction = (
        <Button
          key="project-next"
          type="button"
          size="sm"
          variant="primary"
          onClick={() => setManualStep(2)}
          rightIcon={<ArrowRight />}
          className={cn(setupActionButtonClass, "!rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
        >
          Next
        </Button>
      );
    } else {
      if (isEditingProject) {
        actionBarSecondaryActions.push(
          <Button
            key="project-cancel"
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setIsEditingProject(false)}
            className={cn(setupActionButtonClass, "!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
          >
            Cancel
          </Button>
        );
      }
      actionBarPrimaryAction = (
        <Button
          key="project-submit"
          type="submit"
          size="sm"
          variant="primary"
          form={setupProjectFormId}
          className={cn(setupActionButtonClass, "!rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
        >
          {isEditingProject ? 'Save' : 'Create Project'}
        </Button>
      );
    }
  } else if (activeStepIndex === 2) {
    actionBarSecondaryActions.push(
      <Button
        key="handoff-back"
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setManualStep(1)}
        className={cn(setupActionButtonClass, "!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        Back
      </Button>,
      <Button
        key="handoff-email"
        type="button"
        size="sm"
        variant="secondary"
        onClick={openEmailModal}
        leftIcon={<Mail />}
        className={cn(setupActionButtonClass, "!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        Email
      </Button>
    );
    actionBarPrimaryAction = (
      <Button
        key="handoff-next"
        type="button"
        size="sm"
        variant="primary"
        onClick={() => setManualStep(3)}
        rightIcon={<ArrowRight />}
        className={cn(setupActionButtonClass, "!rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        Verify
      </Button>
    );
  } else if (activeStepIndex === 3) {
    actionBarSecondaryActions.push(
      <Button
        key="verify-back"
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setManualStep(2)}
        className={cn(setupActionButtonClass, "!rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide")}
      >
        Back
      </Button>
    );
    if (activeProject?.id) {
      actionBarPrimaryAction = (
        <Link
          key="verify-open"
          to={`${pathPrefix}/leaks`}
          onClick={handleOpenDashboard}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 text-xs font-bold uppercase text-white shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 tracking-wide"
        >
          {hasRecentData ? 'Open Dashboard' : 'Finish & Open'}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      );
    }
  }

  return (
    <div className="relative min-h-full bg-[var(--dashboard-canvas)] pb-12 text-slate-700 dark:text-slate-350 overflow-x-hidden">
      <div className="relative z-10">
        <main className="mx-auto w-full max-w-[800px] space-y-6 px-4 py-5 pb-8 sm:px-6 sm:py-6 sm:pb-10">
          {isJoinedTeam && currentTeam && (
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 text-emerald-800 dark:text-emerald-300 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </div>
                <div>
                  <h2 className="text-sm font-bold">You joined {currentTeam.name || 'this team'}.</h2>
                  <p className="mt-1 text-xs font-medium leading-relaxed opacity-90">
                    Use this setup guide to connect a project, copy the AI prompt, or invite the person who will wire in the SDK.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Stepper tracker */}
          <section className="bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl border border-white/45 dark:border-slate-900/40 rounded-2xl p-6 shadow-xl shadow-slate-100/10 dark:shadow-none">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center lg:gap-2">
              {setupSteps.map((step, index) => {
                const isLast = index === setupSteps.length - 1;
                const isClickable = index <= highestAccessibleStepIndex;
                return (
                  <React.Fragment key={step.label}>
                    <button
                      type="button"
                      disabled={!isClickable}
                      onClick={() => setManualStep(index)}
                      className={cn(
                        "flex items-center gap-3 text-left focus:outline-none flex-1 transition-all",
                        isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-45"
                      )}
                    >
                      {/* Circle Indicator */}
                      <div
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-300',
                          step.done
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : step.active
                              ? 'border-indigo-600 bg-indigo-600 text-white shadow-md ring-4 ring-indigo-500/20 scale-105'
                              : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900',
                        )}
                      >
                        {step.done ? (
                          <Check className="h-5 w-5" strokeWidth={3} />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                      </div>

                      {/* Step Info */}
                      <div className="min-w-0">
                        <div className={cn(
                          'text-[10px] font-extrabold uppercase tracking-wider',
                          step.active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'
                        )}>
                          Step {index + 1}
                        </div>
                        <div className={cn(
                          'text-sm font-bold',
                          step.active
                            ? 'text-slate-900 dark:text-white'
                            : step.done
                              ? 'text-slate-700 dark:text-slate-300'
                              : 'text-slate-400'
                        )}>
                          {step.label}
                        </div>
                      </div>
                    </button>

                    {/* Connecting Line (Only on Desktop) */}
                    {!isLast && (
                      <div className={cn(
                        'hidden h-0.5 flex-1 rounded-full transition-all duration-500 lg:mx-4 lg:block',
                        step.done
                          ? 'bg-emerald-500'
                          : 'bg-slate-100 dark:bg-slate-800'
                      )} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </section>

          <div className="sticky top-2 z-30 rounded-2xl border border-white/55 bg-white/90 p-3 shadow-lg shadow-slate-900/10 backdrop-blur-xl dark:border-slate-900/60 dark:bg-slate-950/90 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Step {activeStepIndex + 1}
                </div>
                <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{actionBarTitle}</div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{actionBarHint}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center sm:justify-end">
                {actionBarSecondaryActions}
                {actionBarPrimaryAction}
              </div>
            </div>
          </div>

          {/* Wizard Steps */}
          <div className="space-y-6">
            {/* Step 1: Workspace Card */}
            {activeStepIndex === 0 && (
              <section id="setup-workspace" className={setupCardClass}>
                <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
                  <Users className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Workspace Configuration</h3>
                </div>
                {currentTeam ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-lg shadow-sm">
                        {(currentTeam.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Current Workspace</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white truncate">{currentTeam.name || 'Untitled team'}</div>
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{teamMembers.length} member{teamMembers.length === 1 ? '' : 's'}</div>
                      </div>
                    </div>
                    {canManageTeam && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/30 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-900 dark:text-white">
                              {workspaceNeedsConfirmation ? 'Confirm starter workspace' : 'Workspace name'}
                            </div>
                            <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
                              {workspaceNeedsConfirmation
                                ? 'We created this workspace automatically so you have somewhere to start. Rename it now or keep it before creating a project.'
                                : 'Use a name your teammates will recognize in invites, setup instructions, and billing.'}
                            </p>
                          </div>
                          {workspaceNeedsConfirmation && (
                            <span className="inline-flex shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-700">
                              Needs review
                            </span>
                          )}
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <Input
                            label="Workspace name"
                            placeholder="Mobile team, Growth, Engineering"
                            value={workspaceNameDraft}
                            onChange={(event) => {
                              setWorkspaceNameDraft(event.target.value);
                              setWorkspaceConfirmError(null);
                            }}
                            error={workspaceConfirmError ?? undefined}
                            className="h-11 bg-card font-medium"
                          />
                          <Button
                            type="button"
                            variant={workspaceNeedsConfirmation ? 'primary' : 'secondary'}
                            onClick={handleConfirmWorkspace}
                            disabled={isConfirmingWorkspace || !workspaceNameDraft.trim()}
                            className={cn(
                              'h-11 whitespace-nowrap font-semibold',
                              workspaceNeedsConfirmation
                                ? '!bg-indigo-600 !text-white hover:!bg-indigo-700'
                                : ''
                            )}
                          >
                            {isConfirmingWorkspace ? 'Saving...' : workspaceNeedsConfirmation ? 'Save and continue' : 'Save name'}
                          </Button>
                        </div>
                      </div>
                    )}
                    {canManageTeam && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                          <Users className="h-4 w-4 text-slate-400" />
                          <span>Invite teammates</span>
                        </div>
                        <p className="mt-2 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
                          Add multiple people, choose the right role for each, then send. Existing Rejourney users are added immediately; new users receive an email invite.
                        </p>
                        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_auto] lg:items-end">
                          <div className="min-w-0 space-y-1.5">
                            <label htmlFor="setup-teammate-invites" className="text-xs font-bold uppercase tracking-wider text-slate-400">
                              Emails to add
                            </label>
                            <input
                              id="setup-teammate-invites"
                              type="text"
                              value={teammateInviteEmails}
                              onChange={(event) => {
                                setTeammateInviteEmails(event.target.value);
                                setTeammateInviteError(null);
                                setTeammateInviteState(null);
                                setTeammateInviteStateKind(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleAddTeammateDraft();
                                }
                              }}
                              placeholder="alex@company.com"
                              className="h-11 w-full rounded-xl border border-white/40 dark:border-slate-900/40 bg-white/60 dark:bg-slate-950/60 px-4 text-sm font-semibold text-slate-900 dark:text-white shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-slate-350 dark:hover:border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                            />
                            {teammateInviteError && (
                              <p className="text-xs font-bold text-red-500">{teammateInviteError}</p>
                            )}
                          </div>
                          <label className="space-y-1.5">
                            <span className="block text-xs font-bold uppercase tracking-wider text-slate-400">Role for new emails</span>
                            <select
                              value={teammateInviteRole}
                              onChange={(event) => setTeammateInviteRole(event.target.value as TeamInviteRole)}
                              className="h-11 w-full rounded-xl border border-white/40 dark:border-slate-900/40 bg-white/60 dark:bg-slate-950/60 px-3 text-sm font-bold text-slate-900 dark:text-white shadow-sm outline-none transition-all hover:border-slate-350 dark:hover:border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleAddTeammateDraft}
                            disabled={!teammateInviteEmails.trim()}
                            className="!h-11 w-full !rounded-xl !px-5 !text-xs !font-bold uppercase lg:w-auto"
                          >
                            Add to list
                          </Button>
                        </div>
                        {teammateInviteRecipients.length > 0 && (
                          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white/75 dark:border-slate-800 dark:bg-slate-950/30">
                            <div className="grid grid-cols-[minmax(0,1fr)_132px_40px] gap-2 border-b border-slate-200 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                              <span>Email</span>
                              <span>Role</span>
                              <span className="sr-only">Remove</span>
                            </div>
                            {teammateInviteRecipients.map((recipient) => (
                              <div key={recipient.email} className="grid grid-cols-[minmax(0,1fr)_132px_40px] items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-slate-850">
                                <div className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white" title={recipient.email}>
                                  {recipient.email}
                                </div>
                                <select
                                  value={recipient.role}
                                  onChange={(event) => updateTeammateInviteRole(recipient.email, event.target.value as TeamInviteRole)}
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                                  aria-label={`Role for ${recipient.email}`}
                                >
                                  <option value="member">Member</option>
                                  <option value="admin">Admin</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => removeTeammateInviteRecipient(recipient.email)}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-900"
                                  aria-label={`Remove ${recipient.email}`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={handleInviteTeammates}
                          disabled={isInvitingTeammates || (!teammateInviteRecipients.length && !teammateInviteEmails.trim())}
                          className="mt-4 !h-11 w-full !rounded-xl !bg-indigo-600 !px-5 !text-xs !font-bold uppercase !text-white shadow-sm hover:!bg-indigo-700"
                        >
                          {isInvitingTeammates
                            ? 'Inviting...'
                            : teammateInviteRecipients.length
                              ? `Invite ${teammateInviteRecipients.length} teammate${teammateInviteRecipients.length === 1 ? '' : 's'}`
                              : 'Invite teammates'}
                        </Button>
                        {teammateInviteState && (
                          <p className={cn(
                            'mt-3 text-xs font-bold',
                            teammateInviteStateKind === 'error'
                              ? 'text-red-500'
                              : 'text-emerald-550'
                          )}>
                            {teammateInviteState}
                          </p>
                        )}
                      </div>
                    )}
                    {teams.length > 1 && (
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Switch Workspace</label>
                        <div className="relative">
                          <select
                            value={currentTeam.id}
                            onChange={(event) => {
                              const nextTeam = teams.find((team) => team.id === event.target.value);
                              if (nextTeam) setCurrentTeam(nextTeam);
                            }}
                            className="h-11 w-full appearance-none rounded-full border border-white/40 dark:border-slate-900/40 bg-white/50 dark:bg-slate-950/50 backdrop-blur-md px-4 pr-10 text-sm font-semibold text-slate-900 dark:text-white shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all cursor-pointer hover:border-slate-355 dark:hover:border-slate-800"
                          >
                            {teams.map((team) => (
                              <option key={team.id} value={team.id} className="dark:bg-slate-900">{team.name || team.id}</option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                            <ChevronDown className="h-4 w-4" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                      Create a team first. Teams hold projects, members, and billing.
                    </p>
                    <Input
                      label="Team name"
                      placeholder="Engineering, Growth, Mobile Team"
                      value={newTeamName}
                      onChange={(event) => {
                        setNewTeamName(event.target.value);
                        setTeamError(null);
                      }}
                      error={teamError ?? undefined}
                      className="h-11 bg-white/45 dark:bg-slate-950/45 border-white/35 dark:border-slate-900/30 backdrop-blur-md font-medium rounded-full hover:border-slate-350 dark:hover:border-slate-800 focus-visible:ring-indigo-500/10 focus-visible:border-indigo-500"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleCreateTeam}
                      disabled={isCreatingTeam || !newTeamName.trim()}
                      className="w-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-sm font-semibold transition-all"
                    >
                      {isCreatingTeam ? 'Creating...' : 'Create team'}
                    </Button>
                  </div>
                )}
              </section>
            )}

            {/* Step 2: Project Card */}
            {activeStepIndex === 1 && (
              <section id="setup-project" className={setupCardClass}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <Code2 className="h-4 w-4 text-slate-400" />
                      <span>Project Settings</span>
                    </div>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-slate-400">
                      Select the app you want to connect or create a new project.
                    </p>
                  </div>
                  {activeProject && projects.length > 1 && !isEditingProject && (
                    <div className="relative min-w-[220px]">
                      <select
                        value={activeProject.id}
                        onChange={(event) => {
                          const nextProject = projects.find((project) => project.id === event.target.value);
                          if (nextProject) setSelectedProject(nextProject);
                        }}
                        className="h-10 w-full appearance-none rounded-xl border border-white/40 dark:border-slate-900/40 bg-white/50 dark:bg-slate-950/50 backdrop-blur-md px-3 pr-10 text-xs font-bold text-slate-900 dark:text-white shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all cursor-pointer hover:border-slate-355 dark:hover:border-slate-800 hover:bg-white/70 dark:hover:bg-slate-900/70"
                      >
                        {projects.map((project) => (
                          <option key={project.id} value={project.id} className="dark:bg-slate-900">{project.name}</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  )}
                </div>

                {currentTeam ? (
                  activeProject && !isEditingProject ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 lg:grid-cols-2">
                        {/* Project overview */}
                        <div className="rounded-2xl border border-white/35 dark:border-slate-900/35 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md p-4 flex gap-3 items-start">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-550/10 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                            PR
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Active Project</div>
                            <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5 truncate">{activeProject.name}</div>
                            <div className="text-xs font-medium text-slate-550 dark:text-slate-405 mt-0.5">{formatProjectPlatforms(activeProject)}</div>
                          </div>
                        </div>

                        {/* Identifiers */}
                        <div className="rounded-2xl border border-white/35 dark:border-slate-900/35 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md p-4">
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">App Identifiers</div>
                          <div className="space-y-1.5 font-mono text-xs text-slate-605 dark:text-slate-350">
                            {activeProject.webAllowedDomains?.length ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">Web</span>
                                <span className="truncate">{activeProject.webAllowedDomains.join(', ')}</span>
                              </div>
                            ) : null}
                            {!activeProject.webAllowedDomains?.length && activeProject.webDomain ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">Web</span>
                                <span className="truncate">{activeProject.webDomain}</span>
                              </div>
                            ) : null}
                            {activeProject.bundleId ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-500">iOS</span>
                                <span className="truncate">{activeProject.bundleId}</span>
                              </div>
                            ) : null}
                            {activeProject.packageName ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">Android</span>
                                <span className="truncate">{activeProject.packageName}</span>
                              </div>
                            ) : null}
                            {!activeProject.webAllowedDomains?.length && !activeProject.webDomain && !activeProject.bundleId && !activeProject.packageName ? (
                              <div className="text-slate-400 italic">No identifiers configured.</div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="mt-2">
                      <CreateProjectForm
                        currentTeam={currentTeam}
                        formId={setupProjectFormId}
                        projectToEdit={isEditingProject ? activeProject : null}
                        submitLabel={isEditingProject ? "Save Changes" : "Create project and continue"}
                        onCreated={async (project) => {
                          await handleProjectCreated(project);
                          setManualStep(2);
                        }}
                        onUpdated={async (updatedProj) => {
                          setIsEditingProject(false);
                          await handleProjectCreated(updatedProj);
                          setManualStep(2);
                        }}
                        onCancel={isEditingProject ? () => setIsEditingProject(false) : undefined}
                      />
                    </div>
                  )
                ) : (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/50 dark:bg-slate-900/30 p-4 text-center text-sm font-medium text-slate-500 dark:text-slate-400">
                    Please create or select a team to unlock project configuration.
                  </div>
                )}
              </section>
            )}

            {/* Step 3: Developer Handoff Card */}
            {activeStepIndex === 2 && activeProject && (
              <div className="space-y-6">
                <section id="setup-handoff" className={setupCardClass}>
                  <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Developer Handoff</h3>
                  </div>
                  <p className="text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                    Start by copying the AI setup instructions. They include the public key, platform choices, app identifiers, and install steps.
                  </p>

                  {/* Public key container */}
                  <div className="mt-4">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Project API Key</div>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 break-all relative group">
                      <span className="truncate pr-12">{activeProject.publicKey}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => copyText(activeProject.publicKey, 'key')}
                        className="h-8 w-8 p-0 shrink-0 absolute right-2 hover:bg-slate-200 dark:hover:bg-slate-800"
                        title="Copy Key"
                      >
                        {copiedTarget === 'key' ? <Check className="h-4 w-4 text-emerald-500" strokeWidth={3} /> : <Copy className="h-4 w-4 text-slate-400" />}
                      </Button>
                    </div>
                  </div>

                  {/* AI Agent Setup Prompt Callout */}
                  <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/55 dark:bg-slate-900/30 p-5">
                    <div className="flex gap-3 items-start">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        <Terminal className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>AI Agent Setup Prompt</span>
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase tracking-wider">Recommended</span>
                        </h4>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                          Paste the copied setup instructions into Cursor, v0, Copilot, or another AI coding assistant. They include the exact setup steps with your configuration filled in.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => copyText(aiPrompt, 'prompt')}
                        className="w-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-sm font-semibold transition-all"
                      >
                        {copiedTarget === 'prompt' ? (
                          <>
                            <Check className="mr-2 h-4.5 w-4.5" strokeWidth={3} />
                            Copied to Clipboard!
                          </>
                        ) : (
                          <>
                            <Terminal className="mr-2 h-4.5 w-4.5" />
                            Copy AI Setup Instructions
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={openEmailModal}
                      leftIcon={<Mail />}
                    >
                      Email Instructions
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => copyText(activeProject.publicKey, 'key')}
                      leftIcon={copiedTarget === 'key' ? <Check /> : <Copy />}
                    >
                      {copiedTarget === 'key' ? 'Copied!' : 'Copy API Key'}
                    </Button>
                  </div>

                  {/* Invite Developer Panel */}
                  <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-5">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <Send className="h-4 w-4 text-slate-400" />
                      <span>Invite Developer to Team</span>
                    </div>
                    {canManageTeam ? (
                      <div className="mt-4 space-y-4">
                        <Input
                          type="email"
                          label="Developer Email"
                          placeholder="developer@company.com"
                          value={developerEmail}
                          onChange={(event) => {
                            setDeveloperEmail(event.target.value);
                            setInviteState(null);
                            setInviteStateKind(null);
                            setDeveloperEmailError(null);
                          }}
                          error={developerEmailError ?? undefined}
                          className="h-10 bg-card font-medium"
                        />
                        <label className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-850 bg-card p-3 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                          <input
                            type="checkbox"
                            checked={developerCanManageSetup}
                            onChange={(event) => setDeveloperCanManageSetup(event.target.checked)}
                            className="mt-0.5 rounded border-slate-350 text-indigo-600 focus:ring-indigo-500/20 h-4 w-4"
                          />
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">Grant Admin Access</div>
                            <div className="mt-0.5 font-medium text-slate-500">Allow developer to manage setups and team settings.</div>
                          </div>
                        </label>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={handleInviteDeveloper}
                          disabled={isInvitingDeveloper}
                          className="w-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-sm font-semibold transition-all"
                        >
                          {isInvitingDeveloper ? 'Sending Invite...' : 'Invite Developer'}
                        </Button>
                        {inviteState && (
                          <p className={cn(
                            'text-xs font-bold mt-2',
                            inviteStateKind === 'error'
                              ? 'text-red-500'
                              : 'text-emerald-550'
                          )}>
                            {inviteState}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                        Ask a team administrator to invite your developer if you need help integrating the SDK.
                      </p>
                    )}
                  </div>
                </section>

              </div>
            )}

            {/* Step 4: Verification Checklist Card */}
            {activeStepIndex === 3 && (
              <div className="space-y-6">
                <section id="setup-verify" className={setupCardClass}>
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <ClipboardCheck className="h-4 w-4 text-indigo-655 dark:text-indigo-400" />
                      <span>Verification Checklist</span>
                    </div>
                    {!hasRecentData && activeProject ? (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 animate-pulse">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
                        </span>
                        <span>Listening for signals...</span>
                      </div>
                    ) : activeProject ? (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <span className="relative flex h-2 w-2">
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 animate-pulse"></span>
                        </span>
                        <span>Signals received! Connected.</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4 text-sm">
                    {[
                      {
                        text: activeProject?.publicKey ? 'Get project public key' : 'Create a project to obtain a key',
                        desc: activeProject?.publicKey ? `Active Key: ${activeProject.publicKey.slice(0, 15)}...` : 'Required before initializing the SDK.',
                        done: Boolean(activeProject?.publicKey)
                      },
                      {
                        text: 'Install the Rejourney SDK',
                        desc: 'Run npm install or install Swift/Android packages.',
                        done: Boolean(activeProject?.publicKey)
                      },
                      {
                        text: 'Initialize & start recording',
                        desc: 'Initialize the SDK with your key and make a recording.',
                        done: hasRecentData
                      },
                      {
                        text: 'Receive first test session',
                        desc: hasRecentData
                          ? 'Successfully connected! Dashboard is ready.'
                          : 'Open the app and trigger a session to finalize setup.',
                        done: hasRecentData
                      }
                    ].map((item, index) => (
                      <div key={item.text} className="flex items-start gap-3">
                        <span className={cn(
                          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-extrabold transition-colors',
                          item.done
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20'
                            : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                        )}>
                          {item.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                        </span>
                        <div>
                          <div className={cn(
                            'font-bold text-sm',
                            item.done
                              ? 'text-slate-800 dark:text-slate-350 line-through decoration-slate-400/50'
                              : 'text-slate-900 dark:text-white'
                          )}>
                            {item.text}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {item.desc}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Stuck Help Section */}
                <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-5 shadow-sm hover:shadow-md transition-all duration-300 z-10">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 gap-3.5 items-start">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-550">
                        <LifeBuoy className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Stuck on integration?</h3>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                          We can help you configure your domains, map bundle IDs, or walk you through the setup. Contact us at <strong className="font-semibold text-slate-700 dark:text-slate-355">contact@rejourney.co</strong>.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => copyText('contact@rejourney.co', 'contact')}
                      leftIcon={copiedTarget === 'contact' ? <Check /> : <Mail />}
                      className="w-full shrink-0 whitespace-nowrap !h-10 !rounded-full !px-4 !text-xs !font-bold uppercase tracking-normal sm:w-auto"
                      aria-label="Copy support email"
                    >
                      {copiedTarget === 'contact' ? 'Copied' : 'Copy Email'}
                    </Button>
                  </div>
                </section>

                {/* After Setup Section */}
                {activeProject?.id && (
                  <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-5 shadow-sm hover:shadow-md transition-all duration-300 z-10">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex gap-3.5 items-start">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                          <Check className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">After first test session connects</h3>
                          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                            Your general dashboards, stability metrics, session replays, and network charts will start populating automatically.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 shrink-0">
                        <Link
                          to={`${pathPrefix}/leaks`}
                          onClick={handleOpenDashboard}
                          className="inline-flex h-9 items-center justify-center gap-2 bg-indigo-600 px-4 text-xs font-semibold uppercase text-white shadow-sm hover:bg-indigo-700 transition-all duration-200 rounded-lg"
                        >
                          {hasRecentData ? 'Open Dashboard' : 'Finish Setup & Open'}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                        <a
                          href="/docs"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-2 border border-slate-200 bg-white px-4 text-xs font-semibold uppercase text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 rounded-lg dark:bg-slate-900 dark:text-white dark:border-slate-800"
                        >
                          View Documentation
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </section>
                )}

              </div>
            )}
          </div>
        </main>

        {/* Email Developer Modal */}
        <Modal
          isOpen={isEmailModalOpen}
          onClose={() => setIsEmailModalOpen(false)}
          title="Email Setup Instructions"
          size="md"
          variant="modern"
          bodyClassName="p-6"
        >
          <div className="space-y-4">
            <p className="text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
              Send simplified integration instructions directly to your developer. The email includes our project API key and the AI setup instructions.
            </p>

            <Input
              type="email"
              label="Developer Email Address"
              placeholder="developer@company.com"
              value={emailRecipient}
              onChange={(event) => {
                setEmailRecipient(event.target.value);
                setEmailRecipientError(null);
                setEmailSendState(null);
                setEmailSendStateKind(null);
              }}
              error={emailRecipientError ?? undefined}
              className="h-10 bg-card font-medium"
            />

            <div className="space-y-1.5">
              <label className="text-sm font-medium leading-none text-slate-700 dark:text-slate-350">
                Email Content Preview
              </label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-950 p-4 font-mono text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                {simpleEmailBody}
              </div>
            </div>

            {emailSendState && (
              <p className={cn(
                'text-xs font-bold',
                emailSendStateKind === 'error'
                  ? 'text-red-500'
                  : 'text-emerald-550'
              )}>
                {emailSendState}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-end border-t border-slate-200 dark:border-slate-850 pt-4 mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(simpleEmailBody);
                  setEmailCopied(true);
                  window.setTimeout(() => setEmailCopied(false), 2000);
                }}
                leftIcon={emailCopied ? <Check /> : <Copy />}
              >
                {emailCopied ? 'Copied Body!' : 'Copy Email Body'}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSendSetupEmail}
                disabled={isSendingSetupEmail || !activeProject}
                className="!bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-sm font-semibold transition-all"
                leftIcon={<Send />}
              >
                {isSendingSetupEmail ? 'Sending Email...' : 'Send Email'}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default SetupRoute;
