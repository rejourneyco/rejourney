import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
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
import {
  addTeamMember,
  createTeam,
  recordSdkSetupOpened,
  sendProjectSetupEmail,
  updateTeam,
} from '~/shared/api/client';
import {
  buildProjectAIPromptById,
  getAIPromptDefinition,
  getAIPromptIdsForProject,
} from '~/shared/constants/aiPrompts';
import { cn } from '~/shared/lib/cn';
import { useAuth } from '~/shared/providers/AuthContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useTeam } from '~/shared/providers/TeamContext';
import {
  dashboardButtonClass,
  dashboardCardClass,
  dashboardChipClass,
  dashboardFieldClass,
  dashboardLabelClass,
} from '~/shared/ui/core/dashboardStyles';
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
  shouldRedirectFromSetup,
} from './setupUtils';

type CopyTarget = 'key' | 'prompt' | 'instructions' | 'contact' | null;
type TeamInviteRole = 'member' | 'admin';
type TeammateInviteRecipient = {
  email: string;
  role: TeamInviteRole;
};

const setupCardClass = `${dashboardCardClass} relative p-5 sm:p-6`;
const setupCardHeaderClass = 'mb-5 flex items-center gap-2 border-b border-[#e8eaed] pb-4';
const setupCardTitleClass = 'text-base font-medium text-[#202124]';
const setupCardIconClass = 'h-5 w-5 shrink-0 text-[#5f6368]';
const setupInsetClass = 'rounded-none border border-[#e8eaed] bg-[#f8fafd]';
const setupPrimaryButtonClass = dashboardButtonClass('primary', 'md');
const setupSecondaryButtonClass = dashboardButtonClass('secondary', 'md');
const setupStatusTextClass = (kind: 'success' | 'error' | null) => cn(
  'text-xs font-medium',
  kind === 'error' ? 'text-[#c5221f]' : 'text-[#137333]',
);
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

  useEffect(() => {
    if (!activeProject?.id) return;
    void recordSdkSetupOpened(activeProject.id).catch(() => {
      // Conversion measurement must never interrupt the setup workflow.
    });
  }, [activeProject?.id]);

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
    await refreshSessions({ silent: true });
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

  if (shouldRedirectFromSetup(activeProject)) {
    return <Navigate to={`${pathPrefix}/general`} replace />;
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
      <button
        key="workspace-next"
        type="button"
        onClick={workspaceNeedsConfirmation ? handleConfirmWorkspace : () => setManualStep(1)}
        disabled={isConfirmingWorkspace || (workspaceNeedsConfirmation && !workspaceNameDraft.trim())}
        className={setupPrimaryButtonClass}
      >
        {isConfirmingWorkspace ? 'Saving...' : workspaceNeedsConfirmation ? 'Save workspace' : 'Next'}
        <ArrowRight className="h-4 w-4" />
      </button>
    ) : (
      <button
        key="workspace-create"
        type="button"
        onClick={handleCreateTeam}
        disabled={isCreatingTeam || !newTeamName.trim()}
        className={setupPrimaryButtonClass}
      >
        {isCreatingTeam ? 'Creating...' : 'Create team'}
      </button>
    );
  } else if (activeStepIndex === 1) {
    actionBarSecondaryActions.push(
      <button
        key="project-back"
        type="button"
        onClick={() => setManualStep(0)}
        className={setupSecondaryButtonClass}
      >
        Back
      </button>
    );

    if (activeProject && !isEditingProject) {
      actionBarSecondaryActions.push(
        <button
          key="project-edit"
          type="button"
          onClick={() => setIsEditingProject(true)}
          className={setupSecondaryButtonClass}
        >
          Edit
        </button>
      );
      actionBarPrimaryAction = (
        <button
          key="project-next"
          type="button"
          onClick={() => setManualStep(2)}
          className={setupPrimaryButtonClass}
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </button>
      );
    } else {
      if (isEditingProject) {
        actionBarSecondaryActions.push(
          <button
            key="project-cancel"
            type="button"
            onClick={() => setIsEditingProject(false)}
            className={setupSecondaryButtonClass}
          >
            Cancel
          </button>
        );
      }
      actionBarPrimaryAction = (
        <button
          key="project-submit"
          type="submit"
          form={setupProjectFormId}
          className={setupPrimaryButtonClass}
        >
          {isEditingProject ? 'Save' : 'Create project'}
        </button>
      );
    }
  } else if (activeStepIndex === 2) {
    actionBarSecondaryActions.push(
      <button
        key="handoff-back"
        type="button"
        onClick={() => setManualStep(1)}
        className={setupSecondaryButtonClass}
      >
        Back
      </button>,
      <button
        key="handoff-email"
        type="button"
        onClick={openEmailModal}
        className={setupSecondaryButtonClass}
      >
        <Mail className="h-4 w-4" />
        Email
      </button>
    );
    actionBarPrimaryAction = (
      <button
        key="handoff-next"
        type="button"
        onClick={() => setManualStep(3)}
        className={setupPrimaryButtonClass}
      >
        Verify
        <ArrowRight className="h-4 w-4" />
      </button>
    );
  } else if (activeStepIndex === 3) {
    actionBarSecondaryActions.push(
      <button
        key="verify-back"
        type="button"
        onClick={() => setManualStep(2)}
        className={setupSecondaryButtonClass}
      >
        Back
      </button>
    );
    if (activeProject?.id) {
      actionBarPrimaryAction = (
        <Link
          key="verify-open"
          to={`${pathPrefix}/general`}
          className={setupPrimaryButtonClass}
        >
          {hasRecentData ? 'Open dashboard' : 'Finish & open'}
          <ArrowRight className="h-4 w-4" />
        </Link>
      );
    }
  }

  return (
    <div className="rejourney-setup-wizard relative min-h-full overflow-x-hidden bg-[#f8fafd] pb-12 text-[#3c4043]">
      <div className="relative">
        <main className="mx-auto w-full max-w-[900px] space-y-5 px-4 py-5 pb-8 sm:px-6 sm:py-7 sm:pb-10">
          {isJoinedTeam && currentTeam && (
            <section className="rounded-none border border-[#ceead6] bg-[#e6f4ea] px-5 py-4 text-[#137333]">
              <div className="flex items-start gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[#137333]">
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </div>
                <div>
                  <h2 className="text-sm font-medium">You joined {currentTeam.name || 'this team'}.</h2>
                  <p className="mt-1 text-xs leading-relaxed text-[#3c4043]">
                    Use this setup guide to connect a project, copy the AI prompt, or invite the person who will wire in the SDK.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Stepper tracker */}
          <section aria-label="Setup progress" className={cn(dashboardCardClass, 'p-2 sm:p-3')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {setupSteps.map((step, index) => {
                const isClickable = index <= highestAccessibleStepIndex;
                return (
                  <button
                    key={step.label}
                    type="button"
                    disabled={!isClickable}
                    aria-current={step.active ? 'step' : undefined}
                    onClick={() => setManualStep(index)}
                    className={cn(
                      "flex min-h-16 items-center gap-2.5 rounded-none border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-1",
                      step.active
                        ? "border-[#1a73e8] bg-[#e8f0fe]"
                        : "border-transparent bg-transparent",
                      isClickable
                        ? cn("cursor-pointer", !step.active && "hover:bg-[#f1f3f4]")
                        : "cursor-not-allowed opacity-50"
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                        step.active
                          ? 'border-[#1a73e8] bg-[#1a73e8] text-white'
                          : step.done
                            ? 'border-[#137333] bg-[#e6f4ea] text-[#137333]'
                            : 'border-[#dadce0] bg-white text-[#5f6368]',
                      )}
                    >
                      {step.done && !step.active ? <Check className="h-4 w-4" strokeWidth={2.5} /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cn(
                        'block text-xs font-medium',
                        step.active ? 'text-[#1967d2]' : 'text-[#5f6368]'
                      )}>
                        Step {index + 1}
                      </span>
                      <span className={cn(
                        'mt-0.5 block truncate text-sm font-medium',
                        step.active ? 'text-[#1967d2]' : 'text-[#202124]'
                      )}>
                        {step.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Wizard Steps */}
          <div className="space-y-6">
            {/* Step 1: Workspace Card */}
            {activeStepIndex === 0 && (
              <div className="space-y-6">
                {currentTeam ? (
                  <>
                    {/* Box 1: Select Workspace */}
                    <section id="setup-workspace-select" className={setupCardClass}>
                      <div className={setupCardHeaderClass}>
                        <Users className={setupCardIconClass} />
                        <h3 className={setupCardTitleClass}>1. Select workspace</h3>
                      </div>

                      <div className={cn("grid gap-6", teams.length > 1 ? "md:grid-cols-2" : "grid-cols-1")}>
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-none bg-[#e8f0fe] text-lg font-medium text-[#1967d2]">
                            {(currentTeam.name || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className={dashboardLabelClass}>Current workspace</div>
                            <div className="truncate text-lg font-medium text-[#202124]">{currentTeam.name || 'Untitled team'}</div>
                            <div className="text-xs text-[#5f6368]">{teamMembers.length} member{teamMembers.length === 1 ? '' : 's'}</div>
                          </div>
                        </div>

                        {/* Switch Workspace dropdown (inline) */}
                        {teams.length > 1 && (
                          <div className={cn(setupInsetClass, 'flex flex-col justify-between p-4')}>
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-[#202124]">Switch workspace</div>
                              <p className="text-xs leading-relaxed text-[#5f6368]">
                                Choose another workspace to configure its projects.
                              </p>
                            </div>
                            <div className="relative mt-3">
                              <select
                                value={currentTeam.id}
                                onChange={(event) => {
                                  const nextTeam = teams.find((team) => team.id === event.target.value);
                                  if (nextTeam) setCurrentTeam(nextTeam);
                                }}
                                className={cn(dashboardFieldClass, 'cursor-pointer appearance-none pr-10')}
                              >
                                {teams.map((team) => (
                                  <option key={team.id} value={team.id}>{team.name || team.id}</option>
                                ))}
                              </select>
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[#5f6368]">
                                <ChevronDown className="h-4 w-4" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Box 2: Rename Workspace */}
                    {canManageTeam && (
                      <section id="setup-workspace-rename" className={setupCardClass}>
                        <div className={setupCardHeaderClass}>
                          <Users className={setupCardIconClass} />
                          <h3 className={setupCardTitleClass}>2. Rename workspace</h3>
                        </div>

                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <label className="text-sm font-medium text-[#3c4043]">
                              {workspaceNeedsConfirmation ? 'Confirm starter workspace' : 'Workspace name'}
                            </label>
                            {workspaceNeedsConfirmation && (
                              <span className={cn(dashboardChipClass('warning'), 'shrink-0')}>
                                Needs review
                              </span>
                            )}
                          </div>
                          {workspaceNeedsConfirmation && (
                            <p className="text-xs leading-relaxed text-[#5f6368]">
                              We created this starter workspace automatically. Rename it now or keep it.
                            </p>
                          )}
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                            <Input
                              placeholder="Workspace name"
                              value={workspaceNameDraft}
                              onChange={(event) => {
                                setWorkspaceNameDraft(event.target.value);
                                setWorkspaceConfirmError(null);
                              }}
                              error={workspaceConfirmError ?? undefined}
                            />
                            <button
                              type="button"
                              onClick={handleConfirmWorkspace}
                              disabled={isConfirmingWorkspace || !workspaceNameDraft.trim()}
                              className={workspaceNeedsConfirmation ? setupPrimaryButtonClass : setupSecondaryButtonClass}
                            >
                              {isConfirmingWorkspace ? 'Saving...' : workspaceNeedsConfirmation ? 'Save & continue' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </section>
                    )}

                    {/* Box 3: Invite Teammates */}
                    {canManageTeam && (
                      <section id="setup-workspace-invite" className={setupCardClass}>
                        <div className={setupCardHeaderClass}>
                          <Users className={setupCardIconClass} />
                          <h3 className={setupCardTitleClass}>3. Invite teammates</h3>
                        </div>

                        <div className="space-y-4">
                          <p className="text-xs leading-relaxed text-[#5f6368]">
                            Add colleagues, assign roles, and invite them to collaborate in this workspace.
                          </p>
                          <div className="grid gap-3 pt-1 lg:grid-cols-[minmax(0,1fr)_170px_auto] lg:items-end">
                            <div className="min-w-0 space-y-1.5">
                              <label htmlFor="setup-teammate-invites" className={cn(dashboardLabelClass, 'block')}>
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
                                className={dashboardFieldClass}
                              />
                              {teammateInviteError && (
                                <p className="text-xs font-medium text-[#c5221f]">{teammateInviteError}</p>
                              )}
                            </div>
                            <label className="space-y-1.5">
                              <span className={cn(dashboardLabelClass, 'block')}>Role for new emails</span>
                              <select
                                value={teammateInviteRole}
                                onChange={(event) => setTeammateInviteRole(event.target.value as TeamInviteRole)}
                                className={cn(dashboardFieldClass, 'cursor-pointer')}
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={handleAddTeammateDraft}
                              disabled={!teammateInviteEmails.trim()}
                              className={cn(setupSecondaryButtonClass, 'w-full lg:w-auto')}
                            >
                              Add to list
                            </button>
                          </div>
                          {teammateInviteRecipients.length > 0 && (
                            <div className="mt-3 overflow-hidden rounded-none border border-[#dadce0] bg-white">
                              <div className="grid grid-cols-[minmax(0,1fr)_120px_40px] gap-2 border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-xs font-medium text-[#5f6368]">
                                <span>Email</span>
                                <span>Role</span>
                                <span className="sr-only">Remove</span>
                              </div>
                              {teammateInviteRecipients.map((recipient) => (
                                <div key={recipient.email} className="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-2 border-b border-[#e8eaed] px-3 py-2 last:border-b-0">
                                  <div className="min-w-0 truncate text-sm text-[#202124]" title={recipient.email}>
                                    {recipient.email}
                                  </div>
                                  <select
                                    value={recipient.role}
                                    onChange={(event) => updateTeammateInviteRole(recipient.email, event.target.value as TeamInviteRole)}
                                    className="h-8 cursor-pointer rounded-none border border-[#dadce0] bg-white px-2 text-xs text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20"
                                    aria-label={`Role for ${recipient.email}`}
                                  >
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => removeTeammateInviteRecipient(recipient.email)}
                                    className="flex h-8 w-8 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#c5221f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
                                    aria-label={`Remove ${recipient.email}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={handleInviteTeammates}
                            disabled={isInvitingTeammates || (!teammateInviteRecipients.length && !teammateInviteEmails.trim())}
                            className={cn(setupSecondaryButtonClass, 'mt-4 w-full')}
                          >
                            {isInvitingTeammates
                              ? 'Inviting...'
                              : teammateInviteRecipients.length
                                ? `Invite ${teammateInviteRecipients.length} teammate${teammateInviteRecipients.length === 1 ? '' : 's'}`
                                : 'Invite teammates'}
                          </button>
                          {teammateInviteState && (
                            <p className={cn('mt-3', setupStatusTextClass(teammateInviteStateKind))}>
                              {teammateInviteState}
                            </p>
                          )}
                        </div>
                      </section>
                    )}
                  </>
                ) : (
                  <section className={setupCardClass}>
                    <div className="space-y-4">
                      <p className="text-xs leading-relaxed text-[#5f6368]">
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
                      />
                      <button
                        type="button"
                        onClick={handleCreateTeam}
                        disabled={isCreatingTeam || !newTeamName.trim()}
                        className={cn(setupPrimaryButtonClass, 'w-full')}
                      >
                        {isCreatingTeam ? 'Creating...' : 'Create team'}
                      </button>
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* Step 2: Project Card */}
            {activeStepIndex === 1 && (
              <section id="setup-project" className={setupCardClass}>
                <div className="mb-5 flex flex-col gap-3 border-b border-[#e8eaed] pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Code2 className={setupCardIconClass} />
                      <span className={setupCardTitleClass}>Project settings</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[#5f6368]">
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
                        className={cn(dashboardFieldClass, 'cursor-pointer appearance-none pr-10')}
                      >
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[#5f6368]">
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                </div>

                {currentTeam ? (
                  activeProject && !isEditingProject ? (
                    <div className="space-y-4">
                      <div className={cn(setupInsetClass, 'grid gap-6 p-5 md:grid-cols-2')}>
                        {/* Project overview */}
                        <div className="flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-none bg-[#e8f0fe] text-lg font-medium text-[#1967d2]">
                            PR
                          </div>
                          <div className="min-w-0">
                            <div className={dashboardLabelClass}>Active project</div>
                            <div className="mt-0.5 truncate text-lg font-medium text-[#202124]">{activeProject.name}</div>
                            <div className="mt-1 text-xs text-[#5f6368]">{formatProjectPlatforms(activeProject)}</div>
                          </div>
                        </div>

                        {/* Identifiers */}
                        <div className="space-y-2">
                          <div className={dashboardLabelClass}>App identifiers</div>
                          <div className="space-y-2 font-mono text-xs text-[#3c4043]">
                            {activeProject.webAllowedDomains?.length ? (
                              <div className="flex items-center gap-2">
                                <span className={cn(dashboardChipClass('neutral'), 'font-sans')}>Web</span>
                                <span className="truncate">{activeProject.webAllowedDomains.join(', ')}</span>
                              </div>
                            ) : null}
                            {!activeProject.webAllowedDomains?.length && activeProject.webDomain ? (
                              <div className="flex items-center gap-2">
                                <span className={cn(dashboardChipClass('neutral'), 'font-sans')}>Web</span>
                                <span className="truncate">{activeProject.webDomain}</span>
                              </div>
                            ) : null}
                            {activeProject.bundleId ? (
                              <div className="flex items-center gap-2">
                                <span className={cn(dashboardChipClass('neutral'), 'font-sans')}>iOS</span>
                                <span className="truncate">{activeProject.bundleId}</span>
                              </div>
                            ) : null}
                            {activeProject.packageName ? (
                              <div className="flex items-center gap-2">
                                <span className={cn(dashboardChipClass('neutral'), 'font-sans')}>Android</span>
                                <span className="truncate">{activeProject.packageName}</span>
                              </div>
                            ) : null}
                            {!activeProject.webAllowedDomains?.length && !activeProject.webDomain && !activeProject.bundleId && !activeProject.packageName ? (
                              <div className="font-sans text-xs text-[#5f6368]">No identifiers configured.</div>
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
                        submitLabel={isEditingProject ? "Save changes" : "Create project and continue"}
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
                  <div className={cn(setupInsetClass, 'mt-2 p-4 text-center text-sm text-[#5f6368]')}>
                    Create or select a team to set up a project.
                  </div>
                )}
              </section>
            )}

            {/* Step 3: Developer Handoff Card */}
            {activeStepIndex === 2 && activeProject && (
              <div className="space-y-6">
                <section id="setup-handoff" className={setupCardClass}>
                  <div className={setupCardHeaderClass}>
                    <KeyRound className={setupCardIconClass} />
                    <h3 className={setupCardTitleClass}>Developer handoff</h3>
                  </div>
                  <p className="mb-5 text-xs leading-relaxed text-[#5f6368]">
                    Start by copying the AI setup instructions. They include the public key, platform choices, app identifiers, and install steps.
                  </p>

                  <div className="space-y-6">
                    {/* Project API Key and AI Agent Setup Prompt */}
                    <div className={cn(setupInsetClass, 'space-y-4 p-5')}>
                      <div>
                        <div className={dashboardLabelClass}>Project API key</div>
                        <div className="relative mt-2 flex items-center justify-between gap-3 break-all rounded-none border border-[#dadce0] bg-white px-3.5 py-2 font-mono text-xs leading-relaxed text-[#202124]">
                          <span className="truncate pr-12">{activeProject.publicKey}</span>
                          <button
                            type="button"
                            onClick={() => copyText(activeProject.publicKey, 'key')}
                            className="absolute right-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
                            title="Copy key"
                            aria-label="Copy key"
                          >
                            {copiedTarget === 'key' ? <Check className="h-4 w-4 text-[#137333]" strokeWidth={2.5} /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="pt-2">
                        <h4 className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#202124]">
                          <span>AI agent setup prompt</span>
                          <span className={dashboardChipClass('info')}>Recommended</span>
                        </h4>
                        <p className="mb-3 text-xs leading-relaxed text-[#5f6368]">
                          Paste the copied setup instructions into Cursor, Copilot, v0, or another AI assistant. It includes your exact project configuration.
                        </p>
                        <button
                          type="button"
                          onClick={() => copyText(aiPrompt, 'prompt')}
                          className={cn(setupPrimaryButtonClass, 'w-full')}
                        >
                          {copiedTarget === 'prompt' ? (
                            <>
                              <Check className="h-4 w-4" strokeWidth={2.5} />
                              Copied
                            </>
                          ) : (
                            <>
                              <Terminal className="h-4 w-4" />
                              Copy AI setup instructions
                            </>
                          )}
                        </button>

                        <div className="my-4 flex items-center gap-3" aria-hidden="true">
                          <span className="h-px flex-1 bg-[#e8eaed]" />
                          <span className="text-xs text-[#5f6368]">or</span>
                          <span className="h-px flex-1 bg-[#e8eaed]" />
                        </div>

                        <Link
                          to="/docs"
                          className={cn(setupSecondaryButtonClass, 'w-full')}
                        >
                          <Code2 className="h-4 w-4 text-[#5f6368]" />
                          Read the setup docs
                          <ExternalLink className="h-3.5 w-3.5 text-[#5f6368]" />
                        </Link>
                        <p className="mt-2 text-center text-xs text-[#5f6368]">
                          Prefer a manual setup? Browse the Web, React Native, Flutter, Unity, and Swift installation guides.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Box 2: Invite or Send Instructions */}
                <section id="setup-handoff-invite" className={setupCardClass}>
                  <div className={setupCardHeaderClass}>
                    <Send className={setupCardIconClass} />
                    <h3 className={setupCardTitleClass}>Invite or send instructions</h3>
                  </div>

                  {canManageTeam ? (
                    <div className="grid items-stretch gap-6 md:grid-cols-[1fr_auto_1fr]">
                      {/* Invite Developer */}
                      <div className="flex flex-col justify-between space-y-3.5">
                        <div className="space-y-3.5">
                          <label className="block text-sm font-medium text-[#202124]">Invite a developer to the team</label>
                          <Input
                            type="email"
                            placeholder="developer@company.com"
                            value={developerEmail}
                            onChange={(event) => {
                              setDeveloperEmail(event.target.value);
                              setInviteState(null);
                              setInviteStateKind(null);
                              setDeveloperEmailError(null);
                            }}
                            error={developerEmailError ?? undefined}
                          />
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-none border border-[#dadce0] bg-white p-3 text-xs text-[#3c4043] transition-colors hover:bg-[#f8fafd]">
                            <input
                              type="checkbox"
                              checked={developerCanManageSetup}
                              onChange={(event) => setDeveloperCanManageSetup(event.target.checked)}
                              className="mt-0.5 h-3.5 w-3.5 rounded-none accent-[#1a73e8]"
                            />
                            <div>
                              <div className="font-medium text-[#202124]">Grant admin access</div>
                              <div className="mt-0.5 leading-normal text-[#5f6368]">Allow the developer to manage setup and team settings.</div>
                            </div>
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={handleInviteDeveloper}
                          disabled={isInvitingDeveloper}
                          className={cn(setupSecondaryButtonClass, 'mt-4 w-full')}
                        >
                          {isInvitingDeveloper ? 'Sending invite...' : 'Invite developer'}
                        </button>
                        {inviteState && (
                          <p className={cn('mt-2', setupStatusTextClass(inviteStateKind))}>
                            {inviteState}
                          </p>
                        )}
                      </div>

                      {/* Divider */}
                      <div className="flex flex-row items-center justify-center gap-3 self-stretch py-2 md:flex-col md:py-0">
                        <div className="h-px w-full bg-[#e8eaed] md:w-px md:flex-1" />
                        <span className="shrink-0 text-xs text-[#5f6368]">
                          or
                        </span>
                        <div className="h-px w-full bg-[#e8eaed] md:w-px md:flex-1" />
                      </div>

                      {/* Email Instructions */}
                      <div className="flex flex-col justify-between space-y-3.5">
                        <div className="space-y-1.5">
                          <label className="block text-sm font-medium text-[#202124]">Quick email handoff</label>
                          <p className="text-xs leading-relaxed text-[#5f6368]">
                            Send setup details directly via email without adding them to your workspace.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={openEmailModal}
                          className={cn(setupSecondaryButtonClass, 'w-full')}
                        >
                          <Mail className="h-4 w-4" />
                          Email setup details
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-[#5f6368]">
                      Ask a team administrator to invite your developer if you need help integrating the SDK.
                    </p>
                  )}
                </section>

                {/* Stuck Help & Info flow at the bottom */}
                <div className={cn(dashboardCardClass, 'p-5')}>
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-[#f1f3f4] text-[#5f6368]">
                      <LifeBuoy className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-[#202124]">Stuck on integration?</h3>
                      <p className="mt-1 text-xs leading-relaxed text-[#5f6368]">
                        We can help you configure your domains, map bundle IDs, or walk you through the setup. Contact us at <strong className="font-medium text-[#202124]">contact@rejourney.co</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={() => copyText('contact@rejourney.co', 'contact')}
                        className={cn(dashboardButtonClass('secondary', 'sm'), 'mt-3')}
                        aria-label="Copy support email"
                      >
                        {copiedTarget === 'contact' ? <Check className="h-3.5 w-3.5 text-[#137333]" /> : <Mail className="h-3.5 w-3.5 text-[#5f6368]" />}
                        {copiedTarget === 'contact' ? 'Copied support email' : 'Copy support email'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Verification Checklist Card */}
            {activeStepIndex === 3 && (
              <div className="space-y-6">
                <section id="setup-verify" className={setupCardClass}>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eaed] pb-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className={setupCardIconClass} />
                      <span className={setupCardTitleClass}>Verification checklist</span>
                    </div>
                    {!hasRecentData && activeProject ? (
                      <div className="flex items-center gap-2 text-xs font-medium text-[#1967d2]">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1a73e8] opacity-75"></span>
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1a73e8]"></span>
                        </span>
                        <span>Waiting for first session…</span>
                      </div>
                    ) : activeProject ? (
                      <div className="flex items-center gap-2 text-xs font-medium text-[#137333]">
                        <span className="relative flex h-2 w-2">
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#137333]"></span>
                        </span>
                        <span>First session received</span>
                      </div>
                    ) : null}
                  </div>

                  <div className={cn(setupInsetClass, 'space-y-4 p-5 text-sm')}>
                    {[
                      {
                        text: activeProject?.publicKey ? 'Get project public key' : 'Create a project to obtain a key',
                        desc: activeProject?.publicKey ? `Active key: ${activeProject.publicKey.slice(0, 15)}...` : 'Required before initializing the SDK.',
                        done: Boolean(activeProject?.publicKey)
                      },
                      {
                        text: 'Install the Rejourney SDK',
                        desc: 'Install the Web, React Native, Flutter, Unity, or Swift package for this project.',
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
                          ? 'Connected. The dashboard is ready.'
                          : 'Open the app and trigger a session to finalize setup.',
                        done: hasRecentData
                      }
                    ].map((item, index) => (
                      <div key={item.text} className="flex items-start gap-3">
                        <span className={cn(
                          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                          item.done
                            ? 'border-[#137333] bg-[#e6f4ea] text-[#137333]'
                            : 'border-[#dadce0] bg-white text-[#5f6368]'
                        )}>
                          {item.done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : index + 1}
                        </span>
                        <div>
                          <div className={cn(
                            'text-sm font-medium',
                            item.done
                              ? 'text-[#5f6368] line-through decoration-[#bdc1c6]'
                              : 'text-[#202124]'
                          )}>
                            {item.text}
                          </div>
                          <div className="mt-0.5 text-xs text-[#5f6368]">
                            {item.desc}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Stuck Help & Info flow at the bottom */}
                <div className={cn(dashboardCardClass, 'p-5')}>
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-[#f1f3f4] text-[#5f6368]">
                      <LifeBuoy className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-[#202124]">Stuck on integration?</h3>
                      <p className="mt-1 text-xs leading-relaxed text-[#5f6368]">
                        We can help you configure your domains, map bundle IDs, or walk you through the setup. Contact us at <strong className="font-medium text-[#202124]">contact@rejourney.co</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={() => copyText('contact@rejourney.co', 'contact')}
                        className={cn(dashboardButtonClass('secondary', 'sm'), 'mt-3')}
                        aria-label="Copy support email"
                      >
                        {copiedTarget === 'contact' ? <Check className="h-3.5 w-3.5 text-[#137333]" /> : <Mail className="h-3.5 w-3.5 text-[#5f6368]" />}
                        {copiedTarget === 'contact' ? 'Copied support email' : 'Copy support email'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions for Wizard steps */}
            {!(activeStepIndex === 1 && (isEditingProject || !activeProject)) && (
              <div className="flex flex-col-reverse gap-2 border-t border-[#e8eaed] pt-5 sm:flex-row sm:justify-end">
                {actionBarSecondaryActions}
                {actionBarPrimaryAction}
              </div>
            )}
          </div>
        </main>

        {/* Email Developer Modal */}
        <Modal
          isOpen={isEmailModalOpen}
          onClose={() => setIsEmailModalOpen(false)}
          title="Email setup instructions"
          size="md"
          variant="modern"
          bodyClassName="p-5 sm:p-6"
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-[#3c4043]">
              Send simplified integration instructions directly to your developer. The email includes your project API key and the AI setup instructions.
            </p>

            <Input
              type="email"
              label="Developer email address"
              placeholder="developer@company.com"
              value={emailRecipient}
              onChange={(event) => {
                setEmailRecipient(event.target.value);
                setEmailRecipientError(null);
                setEmailSendState(null);
                setEmailSendStateKind(null);
              }}
              error={emailRecipientError ?? undefined}
            />

            <div className="space-y-1.5">
              <label className="text-sm font-medium leading-none text-[#3c4043]">
                Email preview
              </label>
              <div className="max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-none border border-[#dadce0] bg-[#f8fafd] p-4 font-mono text-[11px] leading-relaxed text-[#3c4043]">
                {simpleEmailBody}
              </div>
            </div>

            {emailSendState && (
              <p className={setupStatusTextClass(emailSendStateKind)}>
                {emailSendState}
              </p>
            )}

            <div className="mt-6 flex flex-col justify-end gap-2 border-t border-[#e8eaed] pt-4 sm:flex-row">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(simpleEmailBody);
                  setEmailCopied(true);
                  window.setTimeout(() => setEmailCopied(false), 2000);
                }}
                className={setupSecondaryButtonClass}
              >
                {emailCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {emailCopied ? 'Copied' : 'Copy email body'}
              </button>
              <button
                type="button"
                onClick={handleSendSetupEmail}
                disabled={isSendingSetupEmail || !activeProject}
                className={setupPrimaryButtonClass}
              >
                <Send className="h-4 w-4" />
                {isSendingSetupEmail ? 'Sending...' : 'Send email'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default SetupRoute;
