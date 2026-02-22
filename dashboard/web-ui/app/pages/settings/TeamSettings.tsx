import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTeam } from '../../context/TeamContext';
import { useAuth } from '../../context/AuthContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { SettingsLayout } from '../../components/layout/SettingsLayout';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
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
} from '../../services/api';

export const TeamSettings: React.FC = () => {
  const { user } = useAuth();
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
  }, [currentTeam?.id, isAdmin]);

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
  }, [currentTeam?.id, isOwner]);

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
        setMemberSuccess(result.message || 'Invitation sent! The user will receive an email.');
        await loadInvitations();
      } else if (result.member) {
        await refreshMembers();
        setMemberSuccess('Member added successfully!');
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
      setMemberSuccess('Invitation resent!');
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
    return (
      <SettingsLayout title="Team" description="Loading...">
        <div className="h-32 bg-slate-100 border-2 border-slate-200 animate-pulse"></div>
      </SettingsLayout>
    );
  }

  if (!currentTeam) {
    return (
      <SettingsLayout title="Team" description="Select a team to manage">
        <div className="p-12 text-center border-2 border-dashed border-slate-300 bg-slate-50">
          <Building className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900 mb-1">No Team Selected</h2>
          <p className="text-sm text-slate-500">Please select or create a team from the sidebar.</p>
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout
      title="Team"
      description={`Manage members for ${currentTeam.name}`}
    >
      {/* Team Information */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold uppercase tracking-tight flex items-center gap-2">
          <Building2 className="w-5 h-5" /> Team Profile
        </h2>
        <NeoCard className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-[10px] font-semibold uppercase text-slate-400 mb-2 block tracking-widest">Team Name</label>
              {isEditingName ? (
                <div className="flex gap-2">
                  <Input
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    className="font-bold font-mono"
                  />
                  <NeoButton
                    onClick={handleUpdateName}
                    disabled={isSavingName}
                    size="sm"
                    variant="primary"
                    leftIcon={<Save className="w-3 h-3" />}
                  >
                    Save
                  </NeoButton>
                  <NeoButton
                    variant="secondary"
                    onClick={() => { setIsEditingName(false); setEditNameValue(currentTeam.name || ''); }}
                    size="sm"
                  >
                    Cancel
                  </NeoButton>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <div className="text-2xl font-semibold text-slate-900 uppercase tracking-tight">{currentTeam.name}</div>
                  {isAdmin && (
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="opacity-0 group-hover:opacity-100 transition-all p-1.5 hover:bg-slate-100 rounded active:scale-95"
                    >
                      <Edit2 className="w-4 h-4 text-slate-400 hover:text-slate-900" />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold uppercase text-slate-500 tracking-wide">Team ID</span>
                <span className="text-sm font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{currentTeam.id}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold uppercase text-slate-500 tracking-wide">Created On</span>
                <span className="text-sm font-bold text-slate-900">{new Date(currentTeam.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs font-bold uppercase text-slate-500 tracking-wide">Members</span>
                <span className="text-sm font-bold text-slate-900">{teamMembers.length}</span>
              </div>
            </div>
          </div>
        </NeoCard>
      </section>

      {/* Billing Quick Link */}
      <section>
        <Link to={`${pathPrefix}/billing`}>
          <NeoCard className="p-4 border-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-600 flex items-center justify-center border-2 border-slate-900 shadow-[2px_2px_0_0_#000]">
                  <CreditCard className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-tight">Billing & Plans</h3>
                  <p className="text-xs font-bold text-blue-700">Manage your subscription, usage, and payment methods</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-blue-600 group-hover:translate-x-1 transition-transform" />
            </div>
          </NeoCard>
        </Link>
      </section>

      {/* Pending Invitations */}
      {isAdmin && invitations.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold uppercase tracking-tight flex items-center gap-2">
            <Mail className="w-5 h-5" /> Pending Invitations
          </h2>
          <NeoCard className="p-0 overflow-hidden">
            <div className="divide-y divide-slate-100">
              {invitations.map((invite) => (
                <div key={invite.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Mail className="w-5 h-5 text-slate-400" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{invite.email}</div>
                      <div className="text-[10px] font-bold text-slate-500 flex gap-2 uppercase tracking-wide">
                        <span>Role: {invite.role}</span>
                        <span>•</span>
                        <span>Expires: {new Date(invite.expiresAt).toLocaleDateString()}</span>
                        {invite.expired && <span className="text-red-500">EXPIRED</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <NeoButton
                      variant="secondary"
                      size="sm"
                      onClick={() => handleResendInvitation(invite.id)}
                    >
                      Resend
                    </NeoButton>
                    <NeoButton
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleCancelInvitation(invite.id)}
                    >
                      Cancel
                    </NeoButton>
                  </div>
                </div>
              ))}
            </div>
          </NeoCard>
        </section>
      )}

      {/* Team Members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold uppercase tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5" /> Team Members
          </h2>
          {isAdmin && (
            <NeoButton
              size="sm"
              variant="primary"
              onClick={() => setShowAddMember(true)}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Add Member
            </NeoButton>
          )}
        </div>
        <NeoCard className="p-0 overflow-hidden">
          {memberError && (
            <div className="p-3 bg-red-50 border-b border-red-100 text-red-700 text-sm font-bold tracking-tight">
              {memberError}
            </div>
          )}
          {memberSuccess && (
            <div className="p-3 bg-emerald-50 border-b border-emerald-100 text-emerald-700 text-sm flex items-center gap-2 font-bold tracking-tight">
              <Check className="w-4 h-4" /> {memberSuccess}
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {teamMembers.map((member) => (
              <div key={member.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-900 text-white flex items-center justify-center font-semibold border border-slate-900 shadow-sm">
                    {member.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">{member.email}</div>
                    {member.displayName && <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{member.displayName}</div>}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {isAdmin && member.userId !== currentTeam.ownerUserId ? (
                    <select
                      className="border-2 border-slate-900 px-2 py-1 text-xs font-semibold uppercase tracking-wide bg-white cursor-pointer hover:bg-slate-50"
                      value={member.role}
                      onChange={(e) => handleChangeRole(member.userId, e.target.value)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="billing_admin">Billing Admin</option>
                    </select>
                  ) : (
                    <NeoBadge variant={member.role === 'owner' ? 'success' : 'neutral'}>
                      {member.role === 'owner' ? 'OWNER' : member.role.toUpperCase()}
                    </NeoBadge>
                  )}

                  {isAdmin && member.userId !== currentTeam.ownerUserId && (
                    <button
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all rounded"
                      onClick={() => handleRemoveMember(member.userId)}
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
        <NeoCard className="p-6 bg-slate-50">
          <h3 className="text-sm font-semibold uppercase tracking-tight mb-4">Role Permissions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2">
              <div className="font-semibold uppercase text-slate-900">Member</div>
              <ul className="text-xs font-bold text-slate-600 space-y-1">
                <li>• View sessions & analytics</li>
                <li>• Access crash reports</li>
                <li>• View project settings</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="font-semibold uppercase text-slate-900">Admin</div>
              <ul className="text-xs font-bold text-slate-600 space-y-1">
                <li>• All member permissions</li>
                <li>• Manage team members</li>
                <li>• Edit project settings</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="font-semibold uppercase text-slate-900">Billing Admin</div>
              <ul className="text-xs font-bold text-slate-600 space-y-1">
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
        <section className="space-y-4">
          <h2 className="text-xl font-semibold uppercase tracking-tight text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> Danger Zone
          </h2>
          <NeoCard className="p-6 border-rose-600 bg-rose-50">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-rose-900 uppercase tracking-tight">Delete Team</h3>
              <p className="text-sm font-bold text-rose-700">
                Owner-only action. Deleting this team permanently removes all nested projects, S3 artifacts, and Postgres data.
              </p>
              {isLoadingTeamPlan ? (
                <p className="text-xs font-bold uppercase tracking-wide text-rose-600">
                  Checking billing status...
                </p>
              ) : hasActiveSubscription ? (
                <div className="p-3 border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold">
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
              Delete Team Permanently
            </NeoButton>
          </NeoCard>
        </section>
      )}

      {/* Add Member Modal */}
      <Modal
        isOpen={showAddMember}
        onClose={() => { setShowAddMember(false); setNewMemberEmail(''); setMemberError(null); }}
        title="Invite Team Member"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <NeoButton variant="secondary" onClick={() => setShowAddMember(false)}>Cancel</NeoButton>
            <NeoButton
              variant="primary"
              onClick={handleAddMember}
              disabled={isAddingMember || !newMemberEmail}
            >
              {isAddingMember ? 'Sending...' : 'Send Invite'}
            </NeoButton>
          </div>
        }
      >
        <div className="space-y-6">
          <Input
            label="Email Address"
            type="email"
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="font-mono font-bold"
          />
          <div className="bg-slate-50 p-4 border border-slate-200 space-y-3">
            <label className="text-[10px] font-semibold uppercase text-slate-400 tracking-widest">Select Role</label>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => setNewMemberRole('member')}
                className={`p-3 text-left border-2 transition-all ${newMemberRole === 'member' ? 'border-slate-900 bg-white shadow-[2px_2px_0_0_#000]' : 'border-transparent bg-slate-100 hover:bg-white'}`}
              >
                <div className="text-sm font-semibold uppercase">Member</div>
                <div className="text-[10px] font-bold text-slate-500">Standard access to projects and sessions.</div>
              </button>
              <button
                onClick={() => setNewMemberRole('admin')}
                className={`p-3 text-left border-2 transition-all ${newMemberRole === 'admin' ? 'border-slate-900 bg-white shadow-[2px_2px_0_0_#000]' : 'border-transparent bg-slate-100 hover:bg-white'}`}
              >
                <div className="text-sm font-semibold uppercase">Admin</div>
                <div className="text-[10px] font-bold text-slate-500">Full control over settings and members.</div>
              </button>
              <button
                onClick={() => setNewMemberRole('billing_admin')}
                className={`p-3 text-left border-2 transition-all ${newMemberRole === 'billing_admin' ? 'border-slate-900 bg-white shadow-[2px_2px_0_0_#000]' : 'border-transparent bg-slate-100 hover:bg-white'}`}
              >
                <div className="text-sm font-semibold uppercase">Billing Admin</div>
                <div className="text-[10px] font-bold text-slate-500">Manage payment methods and subscriptions.</div>
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
        title="Delete Team"
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
              {isDeletingTeam ? 'Deleting...' : 'Permanently Delete Team'}
            </NeoButton>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex gap-2 text-red-800 font-semibold mb-2 items-center">
              <AlertTriangle className="w-5 h-5" /> Final Confirmation
            </div>
            <p className="text-red-700 text-sm">
              This action permanently deletes <strong>{currentTeam.name || currentTeam.id}</strong>, all sub-projects, and associated S3/Postgres data. This cannot be undone.
            </p>
          </div>

          {hasActiveSubscription && (
            <label className="flex items-start gap-3 p-3 border border-amber-300 bg-amber-50 rounded-md cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledgeBillingDowngrade}
                onChange={(e) => {
                  setAcknowledgeBillingDowngrade(e.target.checked);
                  setDeleteTeamError(null);
                }}
                className="mt-1"
              />
              <span className="text-sm font-bold text-amber-900">
                I understand this team has an active subscription and deleting it will trigger an immediate downgrade to free tier to prevent next billing-cycle charges.
              </span>
            </label>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              Type <strong className="font-mono">{teamDeleteConfirmTarget}</strong> to confirm:
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
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 p-2 rounded">
                {deleteOtpMessage}
              </div>
            )}
          </div>

          {deleteOtpSent && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
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
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 p-2 rounded">
              {deleteTeamError}
            </div>
          )}
        </div>
      </Modal>
    </SettingsLayout>
  );
};

export default TeamSettings;
