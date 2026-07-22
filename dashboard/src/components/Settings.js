import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const roles = ['owner', 'admin', 'editor', 'analyst', 'viewer'];
const statuses = ['invited', 'active', 'disabled'];

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  analyst: 'Analyst',
  viewer: 'Viewer',
  platform_admin: 'Platform admin',
};

const statusLabels = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
};

const roleHelp = {
  owner: 'Full organization administration, including owner assignment.',
  admin: 'Manage surveys and non-owner members.',
  editor: 'Create and edit surveys.',
  analyst: 'View results and respondent data.',
  viewer: 'View survey metadata and question text.',
};

const formatRole = (role) => roleLabels[role] || role || 'Unknown';
const formatStatus = (status) => statusLabels[status] || status || 'Unknown';

const Settings = () => {
  const { user, memberships } = useAuth();
  const [platformOrganizations, setPlatformOrganizations] = React.useState([]);
  const [selectedPlatformOrgId, setSelectedPlatformOrgId] = React.useState('');
  const [membersByOrg, setMembersByOrg] = React.useState({});
  const [actorRolesByOrg, setActorRolesByOrg] = React.useState({});
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [updatingMemberId, setUpdatingMemberId] = React.useState(null);
  const [snackbar, setSnackbar] = React.useState(null);
  const [inviteForms, setInviteForms] = React.useState({});
  const [inviteResults, setInviteResults] = React.useState({});
  const [resetResults, setResetResults] = React.useState({});
  const [creatingInviteOrgId, setCreatingInviteOrgId] = React.useState(null);
  const [requestingResetMemberId, setRequestingResetMemberId] = React.useState(null);

  const notify = React.useCallback((severity, message) => setSnackbar({ severity, message }), []);

  const manageableOrganizations = React.useMemo(() => {
    if (user?.isPlatformAdmin) {
      return platformOrganizations.map((org) => ({
        organizationId: org.id,
        organizationName: org.name || org.slug || org.id,
        organizationSlug: org.slug,
        memberCount: org.memberCount,
        role: 'platform_admin',
        platformManaged: true,
      }));
    }

    return (memberships || []).map((membership) => ({ ...membership, platformManaged: false }));
  }, [memberships, platformOrganizations, user?.isPlatformAdmin]);

  const selectedOrganizations = React.useMemo(() => {
    if (!user?.isPlatformAdmin) return manageableOrganizations;
    if (!selectedPlatformOrgId) return [];
    return manageableOrganizations.filter((org) => org.organizationId === selectedPlatformOrgId);
  }, [manageableOrganizations, selectedPlatformOrgId, user?.isPlatformAdmin]);

  const managedMemberships = React.useMemo(
    () => selectedOrganizations.filter((m) => ['owner', 'admin', 'platform_admin'].includes(m.role) || user?.isPlatformAdmin),
    [selectedOrganizations, user?.isPlatformAdmin]
  );

  React.useEffect(() => {
    if (!user?.isPlatformAdmin) {
      setPlatformOrganizations([]);
      setSelectedPlatformOrgId('');
      return;
    }

    let cancelled = false;
    api.get('/orgs')
      .then((response) => {
        if (cancelled) return;
        const organizations = response.data.organizations || [];
        setPlatformOrganizations(organizations);
        setSelectedPlatformOrgId((current) => current || organizations[0]?.id || '');
      })
      .catch((err) => {
        if (!cancelled) notify('error', err.response?.data?.message || 'Failed to load platform organizations.');
      });

    return () => { cancelled = true; };
  }, [notify, user?.isPlatformAdmin]);

  const loadMembers = React.useCallback(async () => {
    if (managedMemberships.length === 0) {
      setMembersByOrg({});
      setActorRolesByOrg({});
      return;
    }

    setLoadingMembers(true);
    try {
      const entries = await Promise.all(managedMemberships.map(async (membership) => {
        const response = await api.get(`/orgs/${membership.organizationId}/members`);
        return [membership.organizationId, response.data];
      }));
      setMembersByOrg(Object.fromEntries(entries.map(([orgId, data]) => [orgId, data.members || []])));
      setActorRolesByOrg(Object.fromEntries(entries.map(([orgId, data]) => [orgId, data.actorRole])));
    } catch (err) {
      notify('error', err.response?.data?.message || 'Failed to load organization members.');
    } finally {
      setLoadingMembers(false);
    }
  }, [managedMemberships, notify]);

  React.useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const updateMember = async (organizationId, memberId, patch) => {
    setUpdatingMemberId(`${organizationId}:${memberId}`);
    try {
      await api.patch(`/orgs/${organizationId}/members/${memberId}`, patch);
      await loadMembers();
      notify('success', 'Member updated.');
    } catch (err) {
      notify('error', err.response?.data?.message || 'Failed to update member.');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const updateInviteForm = (organizationId, patch) => {
    setInviteForms((current) => ({
      ...current,
      [organizationId]: {
        email: '',
        role: 'viewer',
        deliverEmail: false,
        ...(current[organizationId] || {}),
        ...patch,
      },
    }));
    setInviteResults((current) => ({ ...current, [organizationId]: null }));
  };

  const createInvite = async (organizationId) => {
    const form = { email: '', role: 'viewer', deliverEmail: false, ...(inviteForms[organizationId] || {}) };
    if (!form.email.trim()) {
      notify('error', 'Enter an email address before creating an invite.');
      return;
    }

    setCreatingInviteOrgId(organizationId);
    try {
      const response = await api.post(`/orgs/${organizationId}/invites`, {
        email: form.email.trim(),
        role: form.role,
        deliverEmail: Boolean(form.deliverEmail),
      });
      setInviteResults((current) => ({ ...current, [organizationId]: response.data }));
      setInviteForms((current) => ({ ...current, [organizationId]: { email: '', role: 'viewer', deliverEmail: false } }));
      const delivered = response.data.emailDelivery?.sent;
      notify('success', delivered ? 'Invite created and email delivery was attempted.' : 'Invite created. Deliver the link manually to the intended recipient.');
    } catch (err) {
      notify('error', err.response?.data?.message || 'Failed to create invite.');
    } finally {
      setCreatingInviteOrgId(null);
    }
  };

  const requestPasswordReset = async (organizationId, member) => {
    const identifier = member.email || member.username;
    if (!identifier) {
      notify('error', 'This member has no email or username for password reset.');
      return;
    }

    setRequestingResetMemberId(`${organizationId}:${member.id}`);
    try {
      const response = await api.post('/password-reset/request', member.email ? { email: member.email } : { username: member.username });
      setResetResults((current) => ({ ...current, [`${organizationId}:${member.id}`]: { ...response.data, member } }));
      notify('success', response.data.resetUrl || response.data.token ? 'Password reset token created. Deliver it manually.' : 'Password reset requested. No raw token was returned by this environment.');
    } catch (err) {
      notify('error', err.response?.data?.message || err.response?.data?.error || 'Failed to request password reset.');
    } finally {
      setRequestingResetMemberId(null);
    }
  };

  return (
    <Box sx={{ p: 4 }}>
      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h6">Account</Typography>
              <Typography>{user?.displayName || user?.username}</Typography>
              <Typography color="text.secondary">{user?.email || 'No email on file'}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={user?.isPlatformAdmin ? 'Platform admin' : 'Standard user'} color={user?.isPlatformAdmin ? 'secondary' : 'default'} />
                <Chip size="small" label={`${(memberships || []).length} membership${(memberships || []).length === 1 ? '' : 's'}`} />
                {user?.isPlatformAdmin && <Chip size="small" label={`${platformOrganizations.length} manageable org${platformOrganizations.length === 1 ? '' : 's'}`} />}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {user?.isPlatformAdmin && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Platform-admin organization picker</Typography>
                <Typography color="text.secondary" variant="body2">
                  Platform admins can manage member APIs without organization membership. Select an organization to inspect and manage its members.
                </Typography>
                <FormControl size="small" sx={{ maxWidth: 420 }} disabled={platformOrganizations.length === 0}>
                  <InputLabel>Organization</InputLabel>
                  <Select label="Organization" value={selectedPlatformOrgId} onChange={(e) => setSelectedPlatformOrgId(e.target.value)}>
                    {platformOrganizations.map((org) => (
                      <MenuItem key={org.id} value={org.id}>{org.name || org.slug || org.id} ({org.memberCount || 0} members)</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {platformOrganizations.length === 0 && <Alert severity="info">No organizations are available from the platform-admin organization list.</Alert>}
              </Stack>
            </CardContent>
          </Card>
        )}

        {!user?.isPlatformAdmin && (memberships || []).length === 0 && (
          <Alert severity="info">No organization memberships are currently associated with your account.</Alert>
        )}

        {selectedOrganizations.map((membership) => {
          const canManage = managedMemberships.some((m) => m.organizationId === membership.organizationId);
          const actorRole = actorRolesByOrg[membership.organizationId] || membership.role;
          const canManageOwners = user?.isPlatformAdmin || actorRole === 'owner';
          const members = membersByOrg[membership.organizationId] || [];
          const inviteForm = { email: '', role: 'viewer', deliverEmail: false, ...(inviteForms[membership.organizationId] || {}) };
          const inviteResult = inviteResults[membership.organizationId];
          const inviteRoles = canManageOwners ? roles : roles.filter((role) => role !== 'owner');

          return (
            <Card key={membership.organizationId}>
              <CardContent>
                <Stack spacing={2}>
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="h6">{membership.organizationName || membership.organizationId}</Typography>
                      <Chip size="small" label={membership.platformManaged ? 'Managed as platform admin' : `Your role: ${formatRole(membership.role)}`} color={membership.platformManaged || ['owner', 'admin'].includes(membership.role) ? 'primary' : 'default'} />
                      {user?.isPlatformAdmin && <Chip size="small" label="Platform admin override" color="secondary" />}
                      {membership.memberCount !== undefined && <Chip size="small" label={`${membership.memberCount} members`} />}
                    </Stack>
                    <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                      Organization ID: {membership.organizationId}{membership.organizationSlug ? ` · Slug: ${membership.organizationSlug}` : ''}
                    </Typography>
                  </Box>

                  {!canManage && (
                    <Alert severity="info">Member management is available to organization owners and admins. Your current role is read-only for this page.</Alert>
                  )}

                  {canManage && (
                    <>
                      <Alert severity="info">
                        Backend policy is the source of truth. Admins can manage non-owner members; only owners and platform admins can assign or modify owners. Invites can be emailed when delivery is configured, but returned raw links/tokens still require one-time handling care.
                      </Alert>

                      <Box>
                        <Typography variant="subtitle1" gutterBottom>Create invite</Typography>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
                          <TextField
                            size="small"
                            label="Recipient email"
                            value={inviteForm.email}
                            onChange={(e) => updateInviteForm(membership.organizationId, { email: e.target.value })}
                            sx={{ minWidth: 260 }}
                          />
                          <FormControl size="small" sx={{ minWidth: 150 }}>
                            <InputLabel>Invite role</InputLabel>
                            <Select
                              label="Invite role"
                              value={inviteForm.role}
                              onChange={(e) => updateInviteForm(membership.organizationId, { role: e.target.value })}
                            >
                              {inviteRoles.map((role) => <MenuItem key={role} value={role}>{formatRole(role)}</MenuItem>)}
                            </Select>
                          </FormControl>
                          <FormControlLabel
                            control={<Checkbox checked={Boolean(inviteForm.deliverEmail)} onChange={(e) => updateInviteForm(membership.organizationId, { deliverEmail: e.target.checked })} />}
                            label="Email invite if configured"
                          />
                          <Button
                            variant="contained"
                            onClick={() => createInvite(membership.organizationId)}
                            disabled={creatingInviteOrgId === membership.organizationId}
                          >
                            {creatingInviteOrgId === membership.organizationId ? 'Creating…' : 'Create invite'}
                          </Button>
                        </Stack>
                        {!canManageOwners && (
                          <Typography color="text.secondary" variant="caption">Owner invites are hidden because only owners can invite owners.</Typography>
                        )}
                        {inviteResult && (
                          <Alert severity="warning" sx={{ mt: 2 }}>
                            <Typography variant="body2" fontWeight={600}>One-time invite link/token</Typography>
                            <Typography variant="body2">
                              {inviteResult.emailDelivery?.sent ? 'Email delivery was attempted. Keep this returned link as a fallback and share it only with the intended recipient.' : (inviteResult.emailDelivery?.message || 'Email was not sent. Deliver this link manually only to the intended recipient.')}
                            </Typography>
                            {inviteResult.acceptUrl && <Typography variant="body2" sx={{ mt: 1, wordBreak: 'break-all' }}>Invite link: {inviteResult.acceptUrl}</Typography>}
                            {inviteResult.token && <Typography variant="body2" sx={{ mt: 1, wordBreak: 'break-all' }}>Token: {inviteResult.token}</Typography>}
                          </Alert>
                        )}
                      </Box>

                      <Divider />

                      <Box>
                        <Typography variant="subtitle1">Members</Typography>
                        {loadingMembers && members.length === 0 && <Typography color="text.secondary" sx={{ mt: 1 }}>Loading members…</Typography>}
                        {!loadingMembers && members.length === 0 && <Typography color="text.secondary" sx={{ mt: 1 }}>No members found.</Typography>}
                        {members.map((member) => {
                          const isUpdating = updatingMemberId === `${membership.organizationId}:${member.id}`;
                          const isResetting = requestingResetMemberId === `${membership.organizationId}:${member.id}`;
                          const targetIsOwner = member.role === 'owner';
                          const isSelf = Number(member.id) === Number(user?.id);
                          const canModifyMember = canManageOwners || !targetIsOwner;
                          const selectableRoles = canManageOwners ? roles : roles.filter((role) => role !== 'owner');
                          const disabledReason = !canModifyMember
                            ? 'Only organization owners can modify owner accounts.'
                            : isUpdating
                              ? 'Saving changes…'
                              : '';
                          const statusDisabledReason = isSelf
                            ? 'You cannot disable your own account.'
                            : disabledReason;
                          const resetResult = resetResults[`${membership.organizationId}:${member.id}`];

                          return (
                            <Box key={member.id} sx={{ mt: 2 }}>
                              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
                                <Box sx={{ flexGrow: 1, minWidth: 220 }}>
                                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                    <Typography>{member.displayName || member.username}</Typography>
                                    {isSelf && <Chip size="small" label="You" />}
                                    <Chip size="small" label={formatStatus(member.status)} color={member.status === 'active' ? 'success' : member.status === 'disabled' ? 'default' : 'warning'} />
                                  </Stack>
                                  <Typography color="text.secondary" variant="body2">{member.email || member.username}</Typography>
                                </Box>
                                {!canModifyMember ? (
                                  <Tooltip title={disabledReason}>
                                    <Box sx={{ minWidth: 300 }}>
                                      <Typography variant="body2">Role: {formatRole(member.role)}</Typography>
                                      <Typography color="text.secondary" variant="body2">Status: {formatStatus(member.status)}</Typography>
                                    </Box>
                                  </Tooltip>
                                ) : (
                                  <>
                                    <Tooltip title={disabledReason || roleHelp[member.role] || ''}>
                                      <span>
                                        <FormControl size="small" sx={{ minWidth: 150 }} disabled={isUpdating}>
                                          <InputLabel>Role</InputLabel>
                                          <Select label="Role" value={member.role} onChange={(e) => updateMember(membership.organizationId, member.id, { role: e.target.value })}>
                                            {selectableRoles.map((role) => <MenuItem key={role} value={role}>{formatRole(role)}</MenuItem>)}
                                          </Select>
                                        </FormControl>
                                      </span>
                                    </Tooltip>
                                    <Tooltip title={statusDisabledReason || ''}>
                                      <span>
                                        <FormControl size="small" sx={{ minWidth: 150 }} disabled={isUpdating}>
                                          <InputLabel>Status</InputLabel>
                                          <Select label="Status" value={member.status} onChange={(e) => updateMember(membership.organizationId, member.id, { status: e.target.value })}>
                                            {statuses.map((status) => (
                                              <MenuItem key={status} value={status} disabled={isSelf && status === 'disabled'}>{formatStatus(status)}</MenuItem>
                                            ))}
                                          </Select>
                                        </FormControl>
                                      </span>
                                    </Tooltip>
                                  </>
                                )}
                                <Button size="small" variant="outlined" onClick={() => requestPasswordReset(membership.organizationId, member)} disabled={isResetting || (!member.email && !member.username)}>
                                  {isResetting ? 'Requesting…' : 'Request reset'}
                                </Button>
                              </Stack>
                              {resetResult && (resetResult.resetUrl || resetResult.token) && (
                                <Alert severity="warning" sx={{ mt: 1 }}>
                                  <Typography variant="body2" fontWeight={600}>One-time password reset token</Typography>
                                  <Typography variant="body2">This environment returned a raw reset token/link. Deliver it only to {member.email || member.username}.</Typography>
                                  {resetResult.resetUrl && <Typography variant="body2" sx={{ mt: 1, wordBreak: 'break-all' }}>Reset link: {resetResult.resetUrl}</Typography>}
                                  {resetResult.token && <Typography variant="body2" sx={{ mt: 1, wordBreak: 'break-all' }}>Token: {resetResult.token}</Typography>}
                                </Alert>
                              )}
                              {resetResult && !resetResult.resetUrl && !resetResult.token && (
                                <Alert severity="info" sx={{ mt: 1 }}>Password reset was requested. This environment did not return a raw token; use configured delivery or operator reset procedures.</Alert>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    </>
                  )}
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      <Snackbar open={Boolean(snackbar)} autoHideDuration={6000} onClose={() => setSnackbar(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snackbar && <Alert severity={snackbar.severity} onClose={() => setSnackbar(null)}>{snackbar.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default Settings;
