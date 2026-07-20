import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

jest.mock('../api/axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
}));
jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));

const baseUser = { id: 1, username: 'admin-user', email: 'admin@example.com', displayName: 'Admin User', isPlatformAdmin: false };
const adminMembership = { organizationId: 'org-1', organizationName: 'Acme Org', role: 'admin' };
const ownerMembership = { ...adminMembership, role: 'owner' };
const defaultMembers = [
  { id: 1, username: 'admin-user', email: 'admin@example.com', displayName: 'Admin User', role: 'admin', status: 'active' },
  { id: 2, username: 'owner-user', email: 'owner@example.com', displayName: 'Owner User', role: 'owner', status: 'active' },
];

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { actorRole: 'admin', members: defaultMembers } });
});

test('non-owner admins do not see owner invite assignment controls', async () => {
  useAuth.mockReturnValue({ user: baseUser, memberships: [adminMembership] });

  render(<Settings />);

  expect(await screen.findByText('Acme Org')).toBeInTheDocument();
  expect(screen.getByText(/Owner invites are hidden/i)).toBeInTheDocument();

  await userEvent.click(screen.getByText('Viewer'));
  expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
});

test('owners can create invites with optional email delivery and see the returned one-time link', async () => {
  useAuth.mockReturnValue({ user: baseUser, memberships: [ownerMembership] });
  api.get.mockResolvedValueOnce({ data: { actorRole: 'owner', members: [] } });
  api.post.mockResolvedValueOnce({
    data: {
      invite: { email: 'new@example.com', role: 'viewer' },
      token: 'raw-invite-token',
      acceptUrl: 'https://dashboard.example/accept-invite?token=raw-invite-token',
      emailDelivery: { sent: true },
    },
  });

  render(<Settings />);

  await screen.findByText('Acme Org');
  await userEvent.type(screen.getByLabelText('Recipient email'), 'new@example.com');
  await userEvent.click(screen.getByLabelText('Email invite if configured'));
  await userEvent.click(screen.getByRole('button', { name: 'Create invite' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/org-1/invites', { email: 'new@example.com', role: 'viewer', deliverEmail: true }));
  expect(await screen.findByText(/One-time invite link\/token/i)).toBeInTheDocument();
  expect(screen.getAllByText(/raw-invite-token/).length).toBeGreaterThan(0);
});

test('platform admins can select and manage organizations without memberships', async () => {
  useAuth.mockReturnValue({ user: { ...baseUser, isPlatformAdmin: true }, memberships: [] });
  api.get.mockImplementation(async (url) => {
    if (url === '/orgs') {
      return { data: { organizations: [{ id: 'org-2', name: 'Platform Org', slug: 'platform-org', memberCount: 1 }] } };
    }
    if (url === '/orgs/org-2/members') {
      return { data: { actorRole: 'owner', members: [{ id: 3, username: 'member', email: 'member@example.com', role: 'viewer', status: 'active' }] } };
    }
    return { data: { actorRole: 'owner', members: [] } };
  });

  render(<Settings />);

  expect(await screen.findByText('Platform-admin organization picker')).toBeInTheDocument();
  expect(await screen.findByText('Platform Org')).toBeInTheDocument();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/orgs/org-2/members'));
  expect(screen.getByText('Managed as platform admin')).toBeInTheDocument();
});

test('password reset helper handles no raw token response gracefully', async () => {
  useAuth.mockReturnValue({ user: baseUser, memberships: [ownerMembership] });
  api.get.mockResolvedValue({ data: { actorRole: 'owner', members: [defaultMembers[1]] } });
  api.post.mockResolvedValueOnce({ data: { success: true } });

  render(<Settings />);

  await screen.findByText('Owner User');
  await userEvent.click(screen.getAllByRole('button', { name: 'Request reset' })[0]);

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/password-reset/request', { email: 'owner@example.com' }));
  expect(await screen.findByText(/did not return a raw token/i)).toBeInTheDocument();
});
