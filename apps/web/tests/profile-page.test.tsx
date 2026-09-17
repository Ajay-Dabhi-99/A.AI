import type { MeResponse } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

describe('personal instructions (MODEL-069)', () => {
  it('loads, edits and saves the instructions', async () => {
    let saved = { about: null as string | null, style: 'Be brief.', enabled: true };
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/me/instructions': () => jsonResponse({ instructions: saved }),
      'PATCH /api/me/instructions': (init) => {
        saved = JSON.parse(String(init?.body)) as typeof saved;
        return jsonResponse({ instructions: saved });
      },
    });
    renderApp('/settings');

    const card = await screen.findByRole('region', { name: 'Personal instructions' });
    const style = await within(card).findByLabelText('How should A.ai respond?');
    expect(style).toHaveValue('Be brief.');
    const save = within(card).getByRole('button', { name: 'Save instructions' });
    expect(save).toBeDisabled();

    fireEvent.change(within(card).getByLabelText('What should A.ai know about you?'), {
      target: { value: '  I am a nurse.  ' },
    });
    fireEvent.click(within(card).getByRole('checkbox', { name: /use these in new messages/i }));
    fireEvent.click(save);

    expect(await within(card).findByText('Instructions saved.')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(api, 'PATCH /api/me/instructions')[0]?.body))).toEqual({
      about: 'I am a nurse.',
      style: 'Be brief.',
      enabled: false,
    });
  });

  it('blocks saving text that is too long', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/me/instructions': () =>
        jsonResponse({ instructions: { about: null, style: null, enabled: true } }),
    });
    renderApp('/settings');
    const card = await screen.findByRole('region', { name: 'Personal instructions' });
    const about = await within(card).findByLabelText('What should A.ai know about you?');
    fireEvent.change(about, { target: { value: 'x'.repeat(1_501) } });
    expect(about).toHaveAttribute('aria-invalid', 'true');
    expect(within(card).getByText('1501/1500')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Save instructions' })).toBeDisabled();
  });

  it('shows an error when saving fails', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/me/instructions': () =>
        jsonResponse({ instructions: { about: null, style: null, enabled: true } }),
      'PATCH /api/me/instructions': () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Keep this under 1500 characters'),
    });
    renderApp('/settings');
    const card = await screen.findByRole('region', { name: 'Personal instructions' });
    fireEvent.change(await within(card).findByLabelText('How should A.ai respond?'), {
      target: { value: 'Short answers' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Save instructions' }));
    expect(await within(card).findByText('Keep this under 1500 characters')).toBeInTheDocument();
  });
});

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
