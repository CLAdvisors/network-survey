import React from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const roles = ['owner', 'admin', 'editor', 'analyst', 'viewer'];
const statuses = ['invited', 'active', 'disabled'];

const Settings = () => {
  const { user, memberships } = useAuth();
  const [membersByOrg, setMembersByOrg] = React.useState({});
  const [error, setError] = React.useState('');

  const managedMemberships = React.useMemo(
    () => (memberships || []).filter((m) => ['owner', 'admin'].includes(m.role) || user?.isPlatformAdmin),
    [memberships, user?.isPlatformAdmin]
  );

  const loadMembers = React.useCallback(async () => {
    setError('');
    const entries = await Promise.all(managedMemberships.map(async (membership) => {
      const response = await api.get(`/orgs/${membership.organizationId}/members`);
      return [membership.organizationId, response.data.members || []];
    }));
    setMembersByOrg(Object.fromEntries(entries));
  }, [managedMemberships]);

  React.useEffect(() => {
    if (managedMemberships.length > 0) {
      loadMembers().catch((err) => setError(err.response?.data?.message || 'Failed to load members.'));
    }
  }, [loadMembers, managedMemberships.length]);

  const updateMember = async (organizationId, memberId, patch) => {
    try {
      await api.patch(`/orgs/${organizationId}/members/${memberId}`, patch);
      await loadMembers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update member.');
    }
  };

  return (
    <Box sx={{ p: 4 }}>
      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Typography variant="h6">Account</Typography>
            <Typography>{user?.displayName || user?.username}</Typography>
            <Typography color="text.secondary">{user?.email || 'No email on file'}</Typography>
          </CardContent>
        </Card>

        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {(memberships || []).map((membership) => {
          const canManage = managedMemberships.some((m) => m.organizationId === membership.organizationId);
          const members = membersByOrg[membership.organizationId] || [];
          return (
            <Card key={membership.organizationId}>
              <CardContent>
                <Typography variant="h6">{membership.organizationName || membership.organizationId}</Typography>
                <Typography color="text.secondary">Your role: {membership.role}</Typography>
                {!canManage && <Typography sx={{ mt: 2 }}>Member management is available to owners and admins.</Typography>}
                {canManage && members.map((member) => (
                  <Stack key={member.id} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }} alignItems="center">
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography>{member.displayName || member.username}</Typography>
                      <Typography color="text.secondary" variant="body2">{member.email || member.username}</Typography>
                    </Box>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <InputLabel>Role</InputLabel>
                      <Select label="Role" value={member.role} onChange={(e) => updateMember(membership.organizationId, member.id, { role: e.target.value })}>
                        {roles.map((role) => <MenuItem key={role} value={role}>{role}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <InputLabel>Status</InputLabel>
                      <Select label="Status" value={member.status} onChange={(e) => updateMember(membership.organizationId, member.id, { status: e.target.value })}>
                        {statuses.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Stack>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
};

export default Settings;
