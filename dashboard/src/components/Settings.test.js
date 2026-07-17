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

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({
    data: {
      actorRole: 'admin',
      members: [
        { id: 1, username: 'admin-user', email: 'admin@example.com', displayName: 'Admin User', role: 'admin', status: 'active' },
        { id: 2, username: 'owner-user', email: 'owner@example.com', displayName: 'Owner User', role: 'owner', status: 'active' },
      ],
    },
  });
});

test('non-owner admins do not see owner invite assignment controls', async () => {
  useAuth.mockReturnValue({ user: baseUser, memberships: [adminMembership] });

  render(<Settings />);

  expect(await screen.findByText('Acme Org')).toBeInTheDocument();
  expect(screen.getByText(/Owner invites are hidden/i)).toBeInTheDocument();

  await userEvent.click(screen.getByText('Viewer'));
  expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
});

test('owners can create manual invites and see the returned one-time link', async () => {
  useAuth.mockReturnValue({ user: baseUser, memberships: [ownerMembership] });
  api.get.mockResolvedValueOnce({ data: { actorRole: 'owner', members: [] } });
  api.post.mockResolvedValueOnce({
    data: {
      invite: { email: 'new@example.com', role: 'viewer' },
      token: 'raw-invite-token',
      acceptUrl: 'https://dashboard.example/accept-invite?token=raw-invite-token',
    },
  });

  render(<Settings />);

  await screen.findByText('Acme Org');
  await userEvent.type(screen.getByLabelText('Recipient email'), 'new@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Create invite' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/org-1/invites', { email: 'new@example.com', role: 'viewer' }));
  expect(await screen.findByText(/Manual delivery required/i)).toBeInTheDocument();
  expect(screen.getAllByText(/raw-invite-token/).length).toBeGreaterThan(0);
});

test('platform admins without memberships get a clear settings follow-up message', () => {
  useAuth.mockReturnValue({ user: { ...baseUser, isPlatformAdmin: true }, memberships: [] });

  render(<Settings />);

  expect(screen.getByText(/only lists organizations returned in your session memberships/i)).toBeInTheDocument();
});
