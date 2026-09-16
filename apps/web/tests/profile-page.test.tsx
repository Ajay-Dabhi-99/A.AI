import type { MeResponse } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  jsonResponse,
  mockApi,
  renderApp,
  testUser,
  userMe,
} from './helpers/render';

const namedUser = {
  ...testUser,
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '+91 98765 43210',
};
const namedMe: MeResponse = { ...userMe, identity: { kind: 'user', user: namedUser } };

describe('profile page', () => {
  it('shows the saved name and phone, and initials in the header', async () => {
    mockApi({ ...baseRoutes, '/api/me': () => jsonResponse(namedMe) });
    renderApp('/settings');

    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Ada');
    expect(screen.getByLabelText('Phone number')).toHaveValue('+91 98765 43210');
    expect(screen.getByRole('link', { name: /account settings/i })).toHaveTextContent('AL');
  });

  it('says when a profile is empty and falls back to the email for the avatar', async () => {
    mockApi({ ...baseRoutes, '/api/me': () => jsonResponse(userMe) });
    renderApp('/settings');

    expect(await screen.findByText('Not added yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /account settings/i })).toHaveTextContent('P');
  });

  it('saves the changed fields and confirms', async () => {
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(namedMe),
      'PATCH /api/me/profile': () =>
        jsonResponse({ user: { ...namedUser, firstName: 'Grace', phone: null } }),
    });
    renderApp('/settings');

    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(callsTo(api, 'PATCH /api/me/profile')).toHaveLength(1));
    const [request] = callsTo(api, 'PATCH /api/me/profile');
    expect(JSON.parse(String(request?.body))).toEqual({
      firstName: 'Grace',
      lastName: 'Lovelace',
      phone: null,
    });
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
  });

  it('rejects an invalid phone number before sending anything', async () => {
    const api = mockApi({ ...baseRoutes, '/api/me': () => jsonResponse(namedMe) });
    renderApp('/settings');

    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: 'call me maybe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Use digits, and + ( ) - if you need them')).toBeInTheDocument();
    expect(callsTo(api, 'PATCH /api/me/profile')).toHaveLength(0);
  });

  it('does not let a name be cleared', async () => {
    const api = mockApi({ ...baseRoutes, '/api/me': () => jsonResponse(namedMe) });
    renderApp('/settings');

    fireEvent.change(await screen.findByLabelText('Last name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Enter your last name')).toBeInTheDocument();
    expect(callsTo(api, 'PATCH /api/me/profile')).toHaveLength(0);
  });

  it('shows a server error when saving fails', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(namedMe),
      'PATCH /api/me/profile': () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', [
          { path: 'firstName', message: 'Use letters, spaces, hyphens or apostrophes' },
        ]),
    });
    renderApp('/settings');

    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Use letters, spaces, hyphens or apostrophes'),
    ).toBeInTheDocument();
  });
});
