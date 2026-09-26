import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTeam } from '~/shared/providers/TeamContext';
import { useAuth } from '~/shared/providers/AuthContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { SettingsLayout } from '~/shell/components/layout/SettingsLayout';
import { Input } from '~/shared/ui/core/Input';
import { Modal } from '~/shared/ui/core/Modal';
import {
  Users,
  Mail,
  Trash2,
  Edit2,
  Check,
  Plus,
  Building,
  Save,
  Building2,
  CreditCard,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import {
  addTeamMember,
  removeTeamMember,
  updateTeamMember,
  updateTeam,
  requestTeamDeletionOtp,
  deleteTeam,
  getTeamPlan,
  TeamPlanInfo,
  getTeamInvitations,
  cancelInvitation,
  resendInvitation,
  ApiTeamInvitation,
} from '~/shared/api/client';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import {
  dashboardCardClass,
  dashboardLabelClass,
  dashboardSectionTitleClass,
} from '~/shared/ui/core/dashboardStyles';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  billing_admin: 'Billing admin',
};

// Roles arrive as enum values such as "billing_admin"; show them in sentence case.
const formatRoleLabel = (role: string): string => {
  const known = ROLE_LABELS[role.toLowerCase()];
  if (known) return known;
  const words = role.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const dangerTextButtonClass = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-none border border-transparent bg-transparent px-3 text-xs font-medium text-[#c5221f] transition-colors hover:bg-[#fce8e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:opacity-50';

const roleOptionClass = (selected: boolean) => `w-full rounded-none border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 ${selected ? 'border-[#1a73e8] bg-[#e8f0fe]' : 'border-[#dadce0] bg-white hover:bg-[#f8fafd]'}`;

export const TeamSettings: React.FC = () => {
  const { user } = useAuth();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
  const { currentTeam, teamMembers, refreshMembers, refreshTeams, isLoading: teamsLoading } = useTeam();
  const pathPrefix = usePathPrefix();
  const navigate = useNavigate();

  // Member management
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'member' | 'admin' | 'billing_admin'>('member');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);

  // Pending invitations
  const [invitations, setInvitations] = useState<ApiTeamInvitation[]>([]);
  const [isLoadingInvitations, setIsLoadingInvitations] = useState(false);

  // Team Renaming
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Team deletion
  const [showDeleteTeamModal, setShowDeleteTeamModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteOtpCode, setDeleteOtpCode] = useState('');
  const [isSendingDeleteOtp, setIsSendingDeleteOtp] = useState(false);
  const [deleteOtpSent, setDeleteOtpSent] = useState(false);
  const [deleteOtpMessage, setDeleteOtpMessage] = useState<string | null>(null);
  const [acknowledgeBillingDowngrade, setAcknowledgeBillingDowngrade] = useState(false);
  const [isDeletingTeam, setIsDeletingTeam] = useState(false);
  const [deleteTeamError, setDeleteTeamError] = useState<string | null>(null);

  // Billing plan context for delete safeguards
  const [teamPlan, setTeamPlan] = useState<TeamPlanInfo | null>(null);
  const [isLoadingTeamPlan, setIsLoadingTeamPlan] = useState(false);

  const isOwner = currentTeam?.ownerUserId === user?.id;
  const currentMember = teamMembers.find(m => m.userId === user?.id);
  const isAdmin = isOwner || currentMember?.role === 'admin';
  const teamDeleteConfirmTarget =
    currentTeam?.name && currentTeam.name.trim().length > 0 ? currentTeam.name : (currentTeam?.id || '');
  const subscriptionStatus = teamPlan?.subscriptionStatus?.toLowerCase();
  const hasActiveSubscription =
    Boolean(teamPlan?.subscriptionId) &&
    subscriptionStatus !== 'canceled' &&
    subscriptionStatus !== 'incomplete_expired';

  // Sync edit name state
  useEffect(() => {
    if (currentTeam) {
      setEditNameValue(currentTeam.name || '');
    }
  }, [currentTeam]);

  // Load pending invitations
  const loadInvitations = useCallback(async () => {
    if (!currentTeam || !isAdmin) {
      setInvitations([]);
      return;
    }
    try {
      setIsLoadingInvitations(true);
      const invites = await getTeamInvitations(currentTeam.id);
      setInvitations(invites);
    } catch (err) {
      console.error('Failed to load invitations:', err);
    } finally {
      setIsLoadingInvitations(false);
    }
  }, [currentTeam?.id, isAdmin, manualRefreshVersion]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  useEffect(() => {
    const loadTeamPlan = async () => {
      if (!currentTeam || !isOwner) {
        setTeamPlan(null);
        return;
      }
      try {
        setIsLoadingTeamPlan(true);
        const plan = await getTeamPlan(currentTeam.id);
        setTeamPlan(plan);
      } catch (err) {
        console.error('Failed to load team plan:', err);
        setTeamPlan(null);
      } finally {
        setIsLoadingTeamPlan(false);
      }
    };

    loadTeamPlan();
  }, [currentTeam?.id, isOwner, manualRefreshVersion]);

  const handleUpdateName = async () => {
    if (!currentTeam || !editNameValue.trim()) return;
    try {
      setIsSavingName(true);
      await updateTeam(currentTeam.id, { name: editNameValue.trim() });
      await refreshTeams();
      setIsEditingName(false);
    } catch (err) {
      console.error('Failed to update team name:', err);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleAddMember = async () => {
    if (!currentTeam || !newMemberEmail) return;
    try {
      setIsAddingMember(true);
      setMemberError(null);
      setMemberSuccess(null);
      const result = await addTeamMember(currentTeam.id, newMemberEmail, newMemberRole);
      if (result.invitation) {
        setMemberSuccess(result.message || 'Invitation sent. The user will receive an email.');
        await Promise.all([loadInvitations(), refreshMembers()]);
      } else if (result.member) {
        await refreshMembers();
        setMemberSuccess('Member added.');
      }
      setShowAddMember(false);
      setNewMemberEmail('');
      setNewMemberRole('member');
      setTimeout(() => setMemberSuccess(null), 5000);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentTeam) return;
    if (!window.confirm('Are you sure you want to remove this member?')) return;
    try {
      await removeTeamMember(currentTeam.id, userId);
      await refreshMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!currentTeam) return;
    try {
      await updateTeamMember(currentTeam.id, userId, newRole);
      await refreshMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!currentTeam) return;
    if (!window.confirm('Are you sure you want to cancel this invitation?')) return;
    try {
      await cancelInvitation(currentTeam.id, invitationId);
      await loadInvitations();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to cancel invitation');
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!currentTeam) return;
    try {
      await resendInvitation(currentTeam.id, invitationId);
      await loadInvitations();
      setMemberSuccess('Invitation resent.');
      setTimeout(() => setMemberSuccess(null), 3000);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to resend invitation');
    }
  };

  const handleDeleteTeam = async () => {
    if (!currentTeam) return;

    if (deleteConfirmText !== teamDeleteConfirmTarget) {
      setDeleteTeamError(`Type "${teamDeleteConfirmTarget}" exactly to confirm deletion.`);
      return;
    }

    if (hasActiveSubscription && !acknowledgeBillingDowngrade) {
      setDeleteTeamError('You must acknowledge immediate downgrade to free tier before deleting.');
      return;
    }

    if (!deleteOtpCode.trim()) {
      setDeleteTeamError('OTP code is required');
      return;
    }

    try {
      setIsDeletingTeam(true);
      setDeleteTeamError(null);

      await deleteTeam(currentTeam.id, {
        confirmText: deleteConfirmText,
        otpCode: deleteOtpCode.trim().toUpperCase(),
        acknowledgeBillingDowngrade: acknowledgeBillingDowngrade || undefined,
      });

      setShowDeleteTeamModal(false);
      setDeleteConfirmText('');
      setDeleteOtpCode('');
      setDeleteOtpSent(false);
      setDeleteOtpMessage(null);
      setAcknowledgeBillingDowngrade(false);

      await refreshTeams();
      navigate(`${pathPrefix}/general`);
    } catch (err) {
      setDeleteTeamError(err instanceof Error ? err.message : 'Failed to delete team');
    } finally {
      setIsDeletingTeam(false);
    }
  };

  const handleSendDeleteOtp = async () => {
    if (!currentTeam) return;

    if (deleteConfirmText !== teamDeleteConfirmTarget) {
      setDeleteTeamError(`Type "${teamDeleteConfirmTarget}" exactly before requesting OTP.`);
      return;
    }

    if (hasActiveSubscription && !acknowledgeBillingDowngrade) {
      setDeleteTeamError('Acknowledge immediate downgrade before requesting OTP.');
      return;
    }

    try {
      setIsSendingDeleteOtp(true);
      setDeleteTeamError(null);
      setDeleteOtpMessage(null);

      const result = await requestTeamDeletionOtp(currentTeam.id, {
        confirmText: deleteConfirmText,
        acknowledgeBillingDowngrade: acknowledgeBillingDowngrade || undefined,
      });

      setDeleteOtpSent(true);
      setDeleteOtpMessage(result.devCode
        ? `OTP sent. Dev code: ${result.devCode}`
        : 'OTP sent to your email.');
    } catch (err) {
      setDeleteTeamError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsSendingDeleteOtp(false);
    }
  };

  if (teamsLoading) {
    return <DashboardGhostLoader variant="settings" />;
  }

  if (!currentTeam) {
    return (
      <SettingsLayout className="rejourney-settings-page rejourney-team-settings-page" title="Team" description="Select a team to manage" {...dashboardPageHeaderProps('team')}>
        <div className={`${dashboardCardClass} p-12 text-center`}>
          <Building className="mx-auto mb-3 h-10 w-10 text-[#bdc1c6]" />
          <h2 className={`mb-1 ${dashboardSectionTitleClass}`}>No team selected</h2>
          <p className="text-sm text-[#5f6368]">Please select or create a team from the sidebar.</p>
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout
      className="rejourney-settings-page rejourney-team-settings-page"
      title="Team"
      description={`Manage members for ${currentTeam.name}`}
      {...dashboardPageHeaderProps('team')}
    >
      {/* Team Information */}
      <section className="space-y-3">
        <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
          <Building2 className="h-4 w-4 text-[#5f6368]" /> Team profile
        </h2>
        <NeoCard className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={`mb-2 block ${dashboardLabelClass}`}>Team name</label>
              {isEditingName ? (
                <div className="flex gap-2">
                  <Input
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    aria-label="Team name"
                  />
                  <NeoButton
                    onClick={handleUpdateName}
                    disabled={isSavingName}
                    variant="primary"
                    leftIcon={<Save className="h-3.5 w-3.5" />}
                  >
                    Save
                  </NeoButton>
                  <NeoButton
                    variant="secondary"
                    onClick={() => { setIsEditingName(false); setEditNameValue(currentTeam.name || ''); }}
                  >
                    Cancel
                  </NeoButton>
                </div>
              ) : (
                <div className="group flex items-center gap-2">
                  <div className="min-w-0 break-words text-xl font-normal text-[#202124]">{currentTeam.name}</div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setIsEditingName(true)}
                      className="rounded-none p-1.5 text-[#5f6368] opacity-0 transition-opacity hover:bg-[#f1f3f4] hover:text-[#202124] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 group-hover:opacity-100"
                      aria-label="Edit team name"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] pb-2">
                <span className={dashboardLabelClass}>Team ID</span>
                <span className="min-w-0 break-all bg-[#f1f3f4] px-2 py-0.5 text-right font-mono text-xs text-[#3c4043]">{currentTeam.id}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] pb-2">
                <span className={dashboardLabelClass}>Created on</span>
                <span className="text-sm tabular-nums text-[#202124]">{new Date(currentTeam.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={dashboardLabelClass}>Members</span>
                <span className="text-sm tabular-nums text-[#202124]">{teamMembers.length}</span>
              </div>
            </div>
          </div>
        </NeoCard>
      </section>

      {/* Billing Quick Link */}
      <section>
        <Link
          to={`${pathPrefix}/billing`}
          className={`flex items-center justify-between gap-4 ${dashboardCardClass} p-4 transition-colors hover:bg-[#f8fafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#f1f3f4] text-[#5f6368]">
              <CreditCard className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-[#202124]">Billing & plans</h3>
              <p className="text-xs text-[#5f6368]">Manage your subscription, usage, and payment methods</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-[#5f6368]" />
        </Link>
      </section>

      {/* Pending Invitations */}
      {isAdmin && invitations.length > 0 && (
        <section className="space-y-3">
          <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
            <Mail className="h-4 w-4 text-[#5f6368]" /> Pending invitations
          </h2>
          <NeoCard disablePadding className="overflow-hidden">
            <div className="divide-y divide-[#e8eaed]">
              {invitations.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-[#f8fafd]">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#f1f3f4] text-[#5f6368]">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#202124]">{invite.email}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5f6368]">
                        <span>Role: {formatRoleLabel(invite.role)}</span>
                        <span aria-hidden="true">•</span>
                        <span className="tabular-nums">Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
                        {invite.expired && <NeoBadge variant="warning" size="sm">Expired</NeoBadge>}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <NeoButton
                      variant="secondary"
                      size="sm"
                      onClick={() => handleResendInvitation(invite.id)}
                    >
                      Resend
                    </NeoButton>
                    <button
                      type="button"
                      className={dangerTextButtonClass}
                      onClick={() => handleCancelInvitation(invite.id)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </NeoCard>
        </section>
      )}

      {/* Team Members */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
            <Users className="h-4 w-4 text-[#5f6368]" /> Team members
          </h2>
          {isAdmin && (
            <NeoButton
              size="sm"
              variant="primary"
              onClick={() => setShowAddMember(true)}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Add member
            </NeoButton>
          )}
        </div>
        <NeoCard disablePadding className="overflow-hidden">
          {memberError && (
            <div className="border-b border-[#f6aea9] bg-[#fce8e6] p-3 text-sm text-[#a50e0e]">
              {memberError}
            </div>
          )}
          {memberSuccess && (
            <div className="flex items-center gap-2 border-b border-[#ceead6] bg-[#e6f4ea] p-3 text-sm text-[#137333]">
              <Check className="h-4 w-4 shrink-0" /> {memberSuccess}
            </div>
          )}

          <div className="divide-y divide-[#e8eaed]">
            {teamMembers.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-[#f8fafd]">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#e8f0fe] text-sm font-medium text-[#1967d2]">
                    {member.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[#202124]">{member.email}</div>
                    {member.displayName && <div className="truncate text-xs text-[#5f6368]">{member.displayName}</div>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {isAdmin && member.userId !== currentTeam.ownerUserId ? (
                    <select
                      className="h-8 cursor-pointer rounded-none border border-[#dadce0] bg-white px-2 text-xs font-medium text-[#3c4043] transition-colors hover:border-[#bdc1c6] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20"
                      value={member.role}
                      onChange={(e) => handleChangeRole(member.userId, e.target.value)}
                      aria-label={`Role for ${member.email}`}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="billing_admin">Billing admin</option>
                    </select>
                  ) : (
                    <NeoBadge variant="neutral" size="sm">
                      {formatRoleLabel(member.role)}
                    </NeoBadge>
                  )}

                  {isAdmin && member.userId !== currentTeam.ownerUserId && (
                    <button
                      type="button"
                      className="rounded-none p-2 text-[#5f6368] transition-colors hover:bg-[#fce8e6] hover:text-[#c5221f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
                      onClick={() => handleRemoveMember(member.userId)}
                      aria-label={`Remove ${member.email}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </NeoCard>
      </section>

      {/* Role Explainer */}
      <section>
        <NeoCard className="p-6">
          <h3 className={`mb-4 ${dashboardSectionTitleClass}`}>Role permissions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2">
              <div className="text-sm font-medium text-[#202124]">Member</div>
              <ul className="space-y-1 text-xs text-[#5f6368]">
                <li>• View sessions & analytics</li>
                <li>• Access crash reports</li>
                <li>• View project settings</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-[#202124]">Admin</div>
              <ul className="space-y-1 text-xs text-[#5f6368]">
                <li>• All member permissions</li>
                <li>• Manage team members</li>
                <li>• Edit project settings</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-[#202124]">Billing admin</div>
              <ul className="space-y-1 text-xs text-[#5f6368]">
                <li>• All member permissions</li>
                <li>• Manage billing & plans</li>
                <li>• Add payment methods</li>
              </ul>
            </div>
          </div>
        </NeoCard>
      </section>

      {/* Danger Zone */}
      {isOwner && (
        <section className="space-y-3">
          <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
            <AlertTriangle className="h-4 w-4 text-[#d93025]" /> Danger zone
          </h2>
          <NeoCard className="p-6">
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[#202124]">Delete team</h3>
              <p className="text-sm text-[#3c4043]">
                Owner-only action. Deleting this team permanently removes all nested projects, S3 artifacts, and Postgres data.
              </p>
              {isLoadingTeamPlan ? (
                <p className="text-xs text-[#5f6368]">
                  Checking billing status...
                </p>
              ) : hasActiveSubscription ? (
                <div className="border border-[#feefc3] bg-[#fef7e0] p-3 text-xs text-[#b06000]">
                  Active subscription detected. Deletion will immediately downgrade this team to free tier and cancel the subscription to prevent next-cycle auto charges.
                </div>
              ) : null}
            </div>
            <NeoButton
              variant="danger"
              className="mt-4"
              onClick={() => {
                setShowDeleteTeamModal(true);
                setDeleteConfirmText('');
                setDeleteOtpCode('');
                setDeleteOtpSent(false);
                setDeleteOtpMessage(null);
                setAcknowledgeBillingDowngrade(false);
                setDeleteTeamError(null);
              }}
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              Delete team permanently
            </NeoButton>
          </NeoCard>
        </section>
      )}

      {/* Add Member Modal */}
      <Modal
        isOpen={showAddMember}
        onClose={() => { setShowAddMember(false); setNewMemberEmail(''); setMemberError(null); }}
        title="Invite team member"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <NeoButton variant="secondary" onClick={() => setShowAddMember(false)}>Cancel</NeoButton>
            <NeoButton
              variant="primary"
              onClick={handleAddMember}
              disabled={isAddingMember || !newMemberEmail}
            >
              {isAddingMember ? 'Sending...' : 'Send invite'}
            </NeoButton>
          </div>
        }
      >
        <div className="space-y-5">
          <Input
            label="Email address"
            type="email"
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            placeholder="colleague@company.com"
          />
          <div className="space-y-2">
            <label className={`block ${dashboardLabelClass}`}>Select role</label>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setNewMemberRole('member')}
                aria-pressed={newMemberRole === 'member'}
                className={roleOptionClass(newMemberRole === 'member')}
              >
                <div className={`text-sm font-medium ${newMemberRole === 'member' ? 'text-[#1967d2]' : 'text-[#202124]'}`}>Member</div>
                <div className="text-xs text-[#5f6368]">Standard access to projects and sessions.</div>
              </button>
              <button
                type="button"
                onClick={() => setNewMemberRole('admin')}
                aria-pressed={newMemberRole === 'admin'}
                className={roleOptionClass(newMemberRole === 'admin')}
              >
                <div className={`text-sm font-medium ${newMemberRole === 'admin' ? 'text-[#1967d2]' : 'text-[#202124]'}`}>Admin</div>
                <div className="text-xs text-[#5f6368]">Full control over settings and members.</div>
              </button>
              <button
                type="button"
                onClick={() => setNewMemberRole('billing_admin')}
                aria-pressed={newMemberRole === 'billing_admin'}
                className={roleOptionClass(newMemberRole === 'billing_admin')}
              >
                <div className={`text-sm font-medium ${newMemberRole === 'billing_admin' ? 'text-[#1967d2]' : 'text-[#202124]'}`}>Billing admin</div>
                <div className="text-xs text-[#5f6368]">Manage payment methods and subscriptions.</div>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteTeamModal}
        onClose={() => {
          setShowDeleteTeamModal(false);
          setDeleteConfirmText('');
          setDeleteOtpCode('');
          setDeleteOtpSent(false);
          setDeleteOtpMessage(null);
          setAcknowledgeBillingDowngrade(false);
          setDeleteTeamError(null);
        }}
        title="Delete team"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <NeoButton
              variant="secondary"
              onClick={() => {
                setShowDeleteTeamModal(false);
                setDeleteConfirmText('');
                setDeleteOtpCode('');
                setDeleteOtpSent(false);
                setDeleteOtpMessage(null);
                setAcknowledgeBillingDowngrade(false);
                setDeleteTeamError(null);
              }}
            >
              Cancel
            </NeoButton>
            <NeoButton
              variant="danger"
              onClick={handleDeleteTeam}
              disabled={
                isDeletingTeam ||
                !deleteOtpSent ||
                !deleteOtpCode.trim() ||
                deleteConfirmText !== teamDeleteConfirmTarget ||
                (hasActiveSubscription && !acknowledgeBillingDowngrade)
              }
            >
              {isDeletingTeam ? 'Deleting...' : 'Permanently delete team'}
            </NeoButton>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="border border-[#f6aea9] bg-[#fce8e6] p-4 text-[#a50e0e]">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-[#d93025]" /> Final confirmation
            </div>
            <p className="text-sm">
              This action permanently deletes <strong className="font-medium">{currentTeam.name || currentTeam.id}</strong>, all sub-projects, and associated S3/Postgres data. This cannot be undone.
            </p>
          </div>

          {hasActiveSubscription && (
            <label className="flex cursor-pointer items-start gap-3 border border-[#feefc3] bg-[#fef7e0] p-3">
              <input
                type="checkbox"
                checked={acknowledgeBillingDowngrade}
                onChange={(e) => {
                  setAcknowledgeBillingDowngrade(e.target.checked);
                  setDeleteTeamError(null);
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#1a73e8]"
              />
              <span className="text-sm text-[#b06000]">
                I understand this team has an active subscription and deleting it will trigger an immediate downgrade to free tier to prevent next billing-cycle charges.
              </span>
            </label>
          )}

          <div className="space-y-2">
            <label className="text-sm text-[#3c4043]">
              Type <strong className="font-medium text-[#202124]">{teamDeleteConfirmTarget}</strong> to confirm:
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => {
                setDeleteConfirmText(e.target.value);
                setDeleteTeamError(null);
              }}
              placeholder={teamDeleteConfirmTarget}
            />
          </div>

          <div className="space-y-2">
            <NeoButton
              variant="secondary"
              onClick={handleSendDeleteOtp}
              disabled={
                isSendingDeleteOtp ||
                deleteConfirmText !== teamDeleteConfirmTarget ||
                (hasActiveSubscription && !acknowledgeBillingDowngrade)
              }
            >
              {isSendingDeleteOtp ? 'Sending OTP...' : 'Send OTP'}
            </NeoButton>
            {deleteOtpMessage && (
              <div className="border border-[#ceead6] bg-[#e6f4ea] p-2 text-sm text-[#137333]">
                {deleteOtpMessage}
              </div>
            )}
          </div>

          {deleteOtpSent && (
            <div className="space-y-2">
              <label className="text-sm text-[#3c4043]">
                Enter OTP code
              </label>
              <Input
                value={deleteOtpCode}
                onChange={(e) => {
                  setDeleteOtpCode(e.target.value.toUpperCase());
                  setDeleteTeamError(null);
                }}
                placeholder="XXXXXXXXXX"
                maxLength={10}
              />
            </div>
          )}

          {deleteTeamError && (
            <div className="border border-[#f6aea9] bg-[#fce8e6] p-2 text-sm text-[#a50e0e]">
              {deleteTeamError}
            </div>
          )}
        </div>
      </Modal>
    </SettingsLayout>
  );
};

export default TeamSettings;
