import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const Harness = () => {
  const auth = useAuth();
  return <>
    <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
    <span data-testid="user">{auth.user?.id || 'none'}</span>
    <span data-testid="revision">{auth.authSessionRevision}</span>
    <button onClick={() => auth.logout()}>Logout now</button>
    <button onClick={() => auth.login('new-user', 'password')}>Login now</button>
  </>;
};

beforeEach(() => vi.clearAllMocks());

test('logout fences identity immediately and serializes a following login behind the server logout', async () => {
  api.get.mockResolvedValue({ status: 200, data: { user: { id: 7 }, memberships: [] } });
  const logout = deferred();
  api.post.mockImplementation((url) => url === '/logout'
    ? logout.promise
    : Promise.resolve({ data: { user: { id: 8 }, memberships: [] } }));
  render(<AuthProvider><Harness /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('7'));
  const initialRevision = Number(screen.getByTestId('revision').textContent);

  await userEvent.click(screen.getByRole('button', { name: 'Logout now' }));
  expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  expect(screen.getByTestId('user')).toHaveTextContent('none');
  expect(Number(screen.getByTestId('revision').textContent)).toBeGreaterThan(initialRevision);

  await userEvent.click(screen.getByRole('button', { name: 'Login now' }));
  expect(api.post.mock.calls.filter(([url]) => url === '/login')).toHaveLength(0);
  await act(async () => { logout.resolve({ status: 200 }); await logout.promise; });
  await waitFor(() => expect(api.post.mock.calls.filter(([url]) => url === '/login')).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('8'));
  expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
});
