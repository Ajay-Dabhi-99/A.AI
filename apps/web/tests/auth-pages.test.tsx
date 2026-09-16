import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { safeRedirectPath, tokenFromHash } from '../src/features/auth/form-errors';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  guestMe,
  jsonResponse,
  mockApi,
  renderApp,
  testUser,
  userMe,
} from './helpers/render';

const TOKEN = 'a'.repeat(43);

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** /api/me reports a guest until a sign-in call succeeds, then the user. */
function signInFlowRoutes(extra: Record<string, (init: RequestInit | undefined) => Response>) {
  let signedIn = false;
  const signIn = (response: Response) => {
    signedIn = true;
    return response;
  };
  return {
    ...baseRoutes,
    '/api/me': () => jsonResponse(signedIn ? userMe : guestMe),
    ...Object.fromEntries(
      Object.entries(extra).map(([key, handler]) => [
        key,
        (init: RequestInit | undefined) => {
          const response = handler(init);
          return response.ok ? signIn(response) : response;
        },
      ]),
    ),
  };
}

describe('helpers', () => {
  it('only allows same-site redirect paths', () => {
    expect(safeRedirectPath('/settings?tab=security')).toBe('/settings?tab=security');
    expect(safeRedirectPath('//evil.example')).toBe('/settings');
    expect(safeRedirectPath('/\\evil.example')).toBe('/settings');
    expect(safeRedirectPath('https://evil.example')).toBe('/settings');
    expect(safeRedirectPath(null)).toBe('/settings');
  });

  it('reads the token from a link fragment', () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash('')).toBeNull();
  });
});

describe('login page', () => {
  it('validates fields before calling the API', async () => {
    const api = mockApi(baseRoutes);
    renderApp('/login');

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/auth/login')).toHaveLength(0);
  });

  it('shows the server message for wrong credentials', async () => {
    mockApi({
      ...baseRoutes,
      'POST /api/auth/login': () =>
        errorResponse(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.'),
    });
    renderApp('/login');

    fill('Email', 'person@example.com');
    fill('Password', 'not the password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('offers a new verification link to unverified accounts', async () => {
    const api = mockApi({
      ...baseRoutes,
      'POST /api/auth/login': () =>
        errorResponse(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first.'),
      'POST /api/auth/resend-verification': () => jsonResponse({ status: 'accepted' }, 202),
    });
    renderApp('/login');

    fill('Email', 'Person@Example.com');
    fill('Password', 'a long enough password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new verification link' }));

    expect(await screen.findByText(/new verification link is on its way/i)).toBeInTheDocument();
    const [resend] = callsTo(api, 'POST /api/auth/resend-verification');
    expect(JSON.parse(String(resend?.body))).toEqual({ email: 'person@example.com' });
  });

  it('signs in and continues to the requested page', async () => {
    const api = mockApi(
      signInFlowRoutes({ 'POST /api/auth/login': () => jsonResponse({ user: testUser }) }),
    );
    const { router } = renderApp('/login?next=/settings');

    fill('Email', 'person@example.com');
    fill('Password', 'a long enough password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    expect(callsTo(api, 'POST /api/auth/login')[0]?.credentials).toBe('include');
  });
});

describe('signup page', () => {
  it('shows the check-your-inbox step after signing up', async () => {
    mockApi({
      ...baseRoutes,
      'POST /api/auth/signup': () => jsonResponse({ status: 'accepted' }, 202),
    });
    renderApp('/signup');

    fill('Email', 'new@example.com');
    fill('Password', 'a long enough password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
  });

  it('puts server validation messages on the matching field', async () => {
    mockApi({
      ...baseRoutes,
      'POST /api/auth/signup': () =>
        errorResponse(400, 'VALIDATION_ERROR', 'The request is invalid.', [
          { path: 'email', message: 'This email domain is not accepted' },
        ]),
    });
    renderApp('/signup');

    fill('Email', 'new@example.com');
    fill('Password', 'a long enough password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This email domain is not accepted')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('enforces the password length on the client', async () => {
    const api = mockApi(baseRoutes);
    renderApp('/signup');
    fill('Email', 'new@example.com');
    fill('Password', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/auth/signup')).toHaveLength(0);
  });
});

describe('verify email page', () => {
  it('verifies once, signs in and removes the token from the URL', async () => {
    const api = mockApi(
      signInFlowRoutes({ 'POST /api/auth/verify-email': () => jsonResponse({ user: testUser }) }),
    );
    const { router } = renderApp(`/verify-email#token=${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/auth/verify-email')).toHaveLength(1);
    expect(JSON.parse(String(callsTo(api, 'POST /api/auth/verify-email')[0]?.body))).toEqual({
      token: TOKEN,
    });
    expect(router.state.location.hash).toBe('');
  });

  it('explains an expired link and offers a new one', async () => {
    mockApi({
      ...baseRoutes,
      'POST /api/auth/verify-email': () =>
        errorResponse(
          400,
          'TOKEN_INVALID',
          'This verification link is invalid or has expired. Request a new one.',
        ),
    });
    renderApp(`/verify-email#token=${TOKEN}`);

    expect(
      await screen.findByRole('heading', { name: "This link doesn't work" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeInTheDocument();
  });

  it('does not call the API when the link has no token', async () => {
    const api = mockApi(baseRoutes);
    renderApp('/verify-email');
    expect(
      await screen.findByRole('heading', { name: "This link doesn't work" }),
    ).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/auth/verify-email')).toHaveLength(0);
  });
});

describe('reset password page', () => {
  it('requires matching passwords', async () => {
    const api = mockApi(baseRoutes);
    renderApp(`/reset-password#token=${TOKEN}`);

    fill('New password', 'a brand new password');
    fill('Confirm new password', 'a different password');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/auth/reset-password')).toHaveLength(0);
  });

  it('saves the password and lands on settings with a confirmation', async () => {
    mockApi(
      signInFlowRoutes({ 'POST /api/auth/reset-password': () => jsonResponse({ user: testUser }) }),
    );
    renderApp(`/reset-password#token=${TOKEN}`);

    fill('New password', 'a brand new password');
    fill('Confirm new password', 'a brand new password');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });

  it('explains a link without a token', () => {
    mockApi(baseRoutes);
    renderApp('/reset-password');
    expect(screen.getByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('protected settings', () => {
  it('offers a retry instead of a login redirect when the session cannot be checked', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong on our side.'),
    });
    const { router } = renderApp('/settings');

    expect(await screen.findByText("We couldn't check your sign-in")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('sends guests to sign in and remembers where they were going', async () => {
    mockApi(baseRoutes);
    const { router } = renderApp('/settings');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/settings')}`);
  });

  it('shows the profile, quota and a working sign out for users', async () => {
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const { router } = renderApp('/settings');

    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
    expect(screen.getByText('person@example.com')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Daily message allowance used' }),
    ).toHaveAttribute('aria-valuenow', '3');
    expect(
      screen.getByRole('link', { name: /account settings for person@example.com/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(callsTo(api, 'POST /api/auth/logout')).toHaveLength(1);
  });
});
