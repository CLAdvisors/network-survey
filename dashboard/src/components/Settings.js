import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
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
  const [membersByOrg, setMembersByOrg] = React.useState({});
  const [actorRolesByOrg, setActorRolesByOrg] = React.useState({});
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [updatingMemberId, setUpdatingMemberId] = React.useState(null);
  const [snackbar, setSnackbar] = React.useState(null);
  const [inviteForms, setInviteForms] = React.useState({});
  const [inviteResults, setInviteResults] = React.useState({});
  const [creatingInviteOrgId, setCreatingInviteOrgId] = React.useState(null);

  const managedMemberships = React.useMemo(
    () => (memberships || []).filter((m) => ['owner', 'admin'].includes(m.role) || user?.isPlatformAdmin),
    [memberships, user?.isPlatformAdmin]
  );

  const notify = React.useCallback((severity, message) => setSnackbar({ severity, message }), []);

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
        ...(current[organizationId] || {}),
        ...patch,
      },
    }));
    setInviteResults((current) => ({ ...current, [organizationId]: null }));
  };

  const createInvite = async (organizationId) => {
    const form = { email: '', role: 'viewer', ...(inviteForms[organizationId] || {}) };
    if (!form.email.trim()) {
      notify('error', 'Enter an email address before creating an invite.');
      return;
    }

    setCreatingInviteOrgId(organizationId);
    try {
      const response = await api.post(`/orgs/${organizationId}/invites`, {
        email: form.email.trim(),
        role: form.role,
      });
      setInviteResults((current) => ({ ...current, [organizationId]: response.data }));
      setInviteForms((current) => ({ ...current, [organizationId]: { email: '', role: 'viewer' } }));
      notify('success', 'Invite created. Deliver the link manually to the intended recipient.');
    } catch (err) {
      notify('error', err.response?.data?.message || 'Failed to create invite.');
    } finally {
      setCreatingInviteOrgId(null);
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
                <Chip size="small" label={`${(memberships || []).length} organization${(memberships || []).length === 1 ? '' : 's'}`} />
              </Stack>
              {user?.isPlatformAdmin && managedMemberships.length === 0 && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Platform admins can use the member-management APIs without organization membership, but this page only lists organizations returned in your session memberships. Add a platform-admin organization picker/list as a follow-up.
                </Alert>
              )}
            </Stack>
          </CardContent>
        </Card>

        {(memberships || []).length === 0 && (
          <Alert severity="info">No organization memberships are currently associated with your account.</Alert>
        )}

        {(memberships || []).map((membership) => {
          const canManage = managedMemberships.some((m) => m.organizationId === membership.organizationId);
          const actorRole = actorRolesByOrg[membership.organizationId] || membership.role;
          const canManageOwners = user?.isPlatformAdmin || actorRole === 'owner';
          const members = membersByOrg[membership.organizationId] || [];
          const inviteForm = { email: '', role: 'viewer', ...(inviteForms[membership.organizationId] || {}) };
          const inviteResult = inviteResults[membership.organizationId];
          const inviteRoles = canManageOwners ? roles : roles.filter((role) => role !== 'owner');

          return (
            <Card key={membership.organizationId}>
              <CardContent>
                <Stack spacing={2}>
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="h6">{membership.organizationName || membership.organizationId}</Typography>
                      <Chip size="small" label={`Your role: ${formatRole(membership.role)}`} color={['owner', 'admin'].includes(membership.role) ? 'primary' : 'default'} />
                      {user?.isPlatformAdmin && <Chip size="small" label="Platform admin override" color="secondary" />}
                    </Stack>
                    <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                      Organization ID: {membership.organizationId}
                    </Typography>
                  </Box>

                  {!canManage && (
                    <Alert severity="info">Member management is available to organization owners and admins. Your current role is read-only for this page.</Alert>
                  )}

                  {canManage && (
                    <>
                      <Alert severity="info">
                        Backend policy is the source of truth. Admins can manage non-owner members; only owners can assign or modify owners. Invites are manual-delivery until email integration is available.
                      </Alert>

                      <Box>
                        <Typography variant="subtitle1" gutterBottom>Create manual invite</Typography>
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
                            <Typography variant="body2" fontWeight={600}>Manual delivery required</Typography>
                            <Typography variant="body2">Send this invite only to {inviteResult.invite?.email}. The raw token/link is shown once by the API and is not emailed automatically.</Typography>
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

                          return (
                            <Stack key={member.id} direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }} alignItems={{ xs: 'stretch', md: 'center' }}>
                              <Box sx={{ flexGrow: 1, minWidth: 220 }}>
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                  <Typography>{member.displayName || member.username}</Typography>
                                  {isSelf && <Chip size="small" label="You" />}
                                  <Chip size="small" label={formatStatus(member.status)} color={member.status === 'active' ? 'success' : member.status === 'disabled' ? 'default' : 'warning'} />
                                </Stack>
                                <Typography color="text.secondary" variant="body2">{member.email || member.username}</Typography>
                              </Box>
                              <Tooltip title={disabledReason || roleHelp[member.role] || ''}>
                                <span>
                                  <FormControl size="small" sx={{ minWidth: 150 }} disabled={!canModifyMember || isUpdating}>
                                    <InputLabel>Role</InputLabel>
                                    <Select label="Role" value={member.role} onChange={(e) => updateMember(membership.organizationId, member.id, { role: e.target.value })}>
                                      {selectableRoles.map((role) => <MenuItem key={role} value={role}>{formatRole(role)}</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                </span>
                              </Tooltip>
                              <Tooltip title={statusDisabledReason || ''}>
                                <span>
                                  <FormControl size="small" sx={{ minWidth: 150 }} disabled={!canModifyMember || isUpdating}>
                                    <InputLabel>Status</InputLabel>
                                    <Select label="Status" value={member.status} onChange={(e) => updateMember(membership.organizationId, member.id, { status: e.target.value })}>
                                      {statuses.map((status) => (
                                        <MenuItem key={status} value={status} disabled={isSelf && status === 'disabled'}>{formatStatus(status)}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </span>
                              </Tooltip>
                            </Stack>
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
