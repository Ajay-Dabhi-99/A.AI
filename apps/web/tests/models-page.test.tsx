import type { CatalogModel, MeResponse } from '@a-ai/shared-types';
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

const adminMe: MeResponse = {
  ...userMe,
  identity: { kind: 'user', user: { ...testUser, role: 'admin' } },
};

function entry(overrides: Partial<CatalogModel>): CatalogModel {
  return {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    name: 'GPT-OSS 20B',
    category: 'text',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    availability: 'free-tier',
    inputPricePerMillionUsd: null,
    outputPricePerMillionUsd: null,
    registryId: '11111111-1111-4111-8111-111111111111',
    status: 'available',
    enabled: true,
    sortOrder: 10,
    verifiedAt: null,
    updatedAt: '2026-09-14T08:00:00.000Z',
    ...overrides,
  };
}

const catalog = () => ({
  providers: [
    { id: 'groq', name: 'Groq', configured: true },
    { id: 'gemini', name: 'Gemini', configured: false },
  ],
  models: [
    entry({}),
    entry({
      id: 'openai/gpt-oss-120b',
      name: 'GPT-OSS 120B',
      registryId: '22222222-2222-4222-8222-222222222222',
      status: 'disabled',
      enabled: false,
      sortOrder: 20,
    }),
    entry({
      id: 'gemini-3.8-flash',
      provider: 'gemini',
      name: 'Gemini 3.8 Flash',
      registryId: '33333333-3333-4333-8333-333333333333',
      status: 'provider_not_configured',
      inputPricePerMillionUsd: 0.15,
      outputPricePerMillionUsd: 0.6,
      verifiedAt: '2026-09-14T09:00:00.000Z',
      sortOrder: 30,
    }),
  ],
});

describe('models page for everyone', () => {
  it('marks a configured provider that is temporarily down', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/models/catalog': () => jsonResponse(catalog()),
      'GET /api/providers/health': () =>
        jsonResponse({
          providers: [
            {
              id: 'groq',
              name: 'Groq',
              configured: true,
              status: 'down',
              consecutiveFailures: 3,
              lastErrorCode: 'PROVIDER_TIMEOUT',
              retryAt: '2026-09-15T12:00:30.000Z',
              lastFailureAt: '2026-09-15T12:00:00.000Z',
              lastSuccessAt: null,
            },
            {
              id: 'gemini',
              name: 'Gemini',
              configured: false,
              status: 'not_configured',
              consecutiveFailures: 0,
              lastErrorCode: null,
              retryAt: null,
              lastFailureAt: null,
              lastSuccessAt: null,
            },
          ],
        }),
    });
    renderApp('/models');

    const groq = await screen.findByRole('region', { name: 'Groq' });
    expect(await within(groq).findByText('Temporarily down')).toBeInTheDocument();
    const gemini = screen.getByRole('region', { name: 'Gemini' });
    expect(within(gemini).getByText('Not configured')).toBeInTheDocument();
    expect(within(gemini).queryByText('Temporarily down')).not.toBeInTheDocument();
  });

  it('lists models by provider with status, limits and price, without admin controls', async () => {
    mockApi({ ...baseRoutes, 'GET /api/models/catalog': () => jsonResponse(catalog()) });
    renderApp('/models');

    expect(await screen.findByRole('heading', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute('href', '/models');

    const groq = screen.getByRole('region', { name: 'Groq' });
    const gemini = screen.getByRole('region', { name: 'Gemini' });
    expect(within(gemini).getByText('Not configured')).toBeInTheDocument();

    const small = within(groq).getByRole('article', { name: 'GPT-OSS 20B' });
    expect(within(small).getByText('Available')).toBeInTheDocument();
    expect(within(small).getByText('131.1K tokens')).toBeInTheDocument();
    expect(within(small).getByText('Price not set')).toBeInTheDocument();
    expect(within(small).getByText('Not yet verified')).toBeInTheDocument();

    expect(within(groq).getByRole('article', { name: 'GPT-OSS 120B' })).toHaveTextContent(
      'Disabled',
    );
    const flash = within(gemini).getByRole('article', { name: 'Gemini 3.8 Flash' });
    expect(flash).toHaveTextContent('Provider not configured');
    expect(flash).toHaveTextContent('$0.15 in · $0.6 out per 1M tokens');
    expect(flash).toHaveTextContent(/Verified/);

    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
    expect(screen.queryByText('Administrator view')).not.toBeInTheDocument();
  });

  it('offers a retry when the catalog cannot be loaded', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/models/catalog': () => errorResponse(500, 'INTERNAL_ERROR', 'boom'),
    });
    renderApp('/models');
    expect(await screen.findByText('The model list could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('models page for administrators', () => {
  function adminRoutes(onPatch: (body: Record<string, unknown>) => Response) {
    let state = catalog();
    return {
      ...baseRoutes,
      '/api/me': () => jsonResponse(adminMe),
      'GET /api/admin/models': () => jsonResponse(state),
      [`PATCH /api/admin/models/${state.models[0]!.registryId}`]: (
        init: RequestInit | undefined,
      ) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const response = onPatch(body);
        if (response.ok) {
          const updated = {
            ...state.models[0]!,
            ...body,
            ...(body.enabled === false ? { status: 'disabled' as const } : {}),
          };
          state = { ...state, models: [updated as CatalogModel, ...state.models.slice(1)] };
          return jsonResponse({ model: updated });
        }
        return response;
      },
    };
  }

  it('disables a model and shows the new status', async () => {
    const api = mockApi(adminRoutes(() => jsonResponse({})));
    renderApp('/models');

    expect(await screen.findByText('Administrator view')).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'GPT-OSS 20B' });
    fireEvent.click(within(card).getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('article', { name: 'GPT-OSS 20B' })).getByText('Disabled'),
      ).toBeInTheDocument(),
    );
    expect(
      JSON.parse(
        String(
          callsTo(api, 'PATCH /api/admin/models/11111111-1111-4111-8111-111111111111')[0]?.body,
        ),
      ),
    ).toEqual({
      enabled: false,
    });
  });

  it('saves only the fields that changed', async () => {
    const api = mockApi(adminRoutes(() => jsonResponse({})));
    renderApp('/models');
    const card = await screen.findByRole('article', { name: 'GPT-OSS 20B' });

    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(card).getByLabelText('Input $ per 1M'), { target: { value: '0.2' } });
    fireEvent.change(within(card).getByLabelText('Output $ per 1M'), { target: { value: '0.8' } });
    fireEvent.click(within(card).getByLabelText('Limits confirmed with a real provider key'));
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(
        callsTo(api, 'PATCH /api/admin/models/11111111-1111-4111-8111-111111111111'),
      ).toHaveLength(1),
    );
    expect(
      JSON.parse(
        String(
          callsTo(api, 'PATCH /api/admin/models/11111111-1111-4111-8111-111111111111')[0]?.body,
        ),
      ),
    ).toEqual({
      inputPricePerMillionUsd: 0.2,
      outputPricePerMillionUsd: 0.8,
      verified: true,
    });
  });

  it('checks the limits before saving', async () => {
    const api = mockApi(adminRoutes(() => jsonResponse({})));
    renderApp('/models');
    const card = await screen.findByRole('article', { name: 'GPT-OSS 20B' });

    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(card).getByLabelText('Max output tokens'), {
      target: { value: '131072' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }));

    expect(
      await within(card).findByText('Must be smaller than the context window'),
    ).toBeInTheDocument();
    expect(
      callsTo(api, 'PATCH /api/admin/models/11111111-1111-4111-8111-111111111111'),
    ).toHaveLength(0);
  });

  it('shows the server message when a change is refused', async () => {
    mockApi(
      adminRoutes(() => errorResponse(403, 'FORBIDDEN', 'You need administrator access for this.')),
    );
    renderApp('/models');
    const card = await screen.findByRole('article', { name: 'GPT-OSS 20B' });

    fireEvent.click(within(card).getByRole('button', { name: 'Disable' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'You need administrator access for this.',
    );
  });
});
