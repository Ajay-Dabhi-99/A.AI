import {
  apiErrorBodySchema,
  audioStatusSchema,
  healthResponseSchema,
  mediaGenerationStatusSchema,
  meResponseSchema,
  modelsResponseSchema,
  readinessResponseSchema,
} from '@a-ai/validation';

/**
 * Release smoke checks against a deployed API and web app (Phase 10, ADR-017).
 * They never call an AI provider, send no personal data, and change nothing
 * except creating one short-lived guest session.
 */

export type SmokeResult = { name: string; ok: boolean; detail: string };

export type SmokeOptions = {
  /** API origin, e.g. https://api.example.com */
  apiUrl: string;
  /** Web app origin, e.g. https://app.example.com. Enables the CORS and web checks. */
  webOrigin?: string;
  /** Set false to skip fetching the web app itself (CORS is still checked). */
  checkWeb?: boolean;
  /** The commit the API must report in GET /health. */
  expectCommit?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DISALLOWED_ORIGIN = 'https://smoke-check.invalid';

function trimOrigin(value: string): string {
  let origin = value.trim();
  while (origin.endsWith('/')) origin = origin.slice(0, -1);
  return origin;
}

function expectStatus(response: Response, status: number): void {
  if (response.status !== status) {
    throw new Error(`expected HTTP ${status}, got ${response.status}`);
  }
}

const onOff = (enabled: boolean) => (enabled ? 'on' : 'off');

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult[]> {
  const api = trimOrigin(options.apiUrl);
  const web = options.webOrigin ? trimOrigin(options.webOrigin) : undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const https = api.startsWith('https://');
  const results: SmokeResult[] = [];

  const request = (url: string, init: RequestInit = {}) =>
    fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      results.push({ name, ok: true, detail: await run() });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await check('health', async () => {
    const response = await request(`${api}/health`);
    expectStatus(response, 200);
    const body = healthResponseSchema.parse(await response.json());
    if (!response.headers.get('x-request-id')) throw new Error('no x-request-id header');
    if (options.expectCommit && body.commit !== options.expectCommit) {
      throw new Error(
        `serving commit ${body.commit ?? 'unknown'}, expected ${options.expectCommit}`,
      );
    }
    return `version ${body.version}${body.commit ? ` (${body.commit.slice(0, 7)})` : ''}`;
  });

  await check('readiness', async () => {
    const response = await request(`${api}/ready`);
    const body = readinessResponseSchema.parse(await response.json());
    if (response.status !== 200) {
      const down = Object.entries(body.checks)
        .filter(([, dependency]) => dependency.status !== 'up')
        .map(([name]) => name);
      throw new Error(`not ready: ${down.join(', ') || 'unknown'}`);
    }
    return 'database, Redis and providers up';
  });

  await check('security headers', async () => {
    const response = await request(`${api}/health`);
    const required = [
      'x-content-type-options',
      'content-security-policy',
      'x-frame-options',
      ...(https ? ['strict-transport-security'] : []),
    ];
    const missing = required.filter((header) => !response.headers.get(header));
    if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
    return `${required.length} headers present`;
  });

  await check('error envelope', async () => {
    const response = await request(`${api}/api/smoke-check-unknown-route`);
    expectStatus(response, 404);
    const body = apiErrorBodySchema.parse(await response.json());
    if (body.error.code !== 'NOT_FOUND') throw new Error(`code ${body.error.code}`);
    return 'NOT_FOUND with a request id';
  });

  await check('validation before providers', async () => {
    const response = await request(`${api}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expectStatus(response, 400);
    const body = apiErrorBodySchema.parse(await response.json());
    if (body.error.code !== 'VALIDATION_ERROR') throw new Error(`code ${body.error.code}`);
    return 'an invalid chat request is rejected without a provider call';
  });

  if (web) {
    await check('CORS allows the web app', async () => {
      const response = await request(`${api}/api/me`, {
        method: 'OPTIONS',
        headers: { origin: web, 'access-control-request-method': 'GET' },
      });
      const allowed = response.headers.get('access-control-allow-origin');
      if (allowed !== web) throw new Error(`allow-origin is ${allowed ?? 'missing'}`);
      if (response.headers.get('access-control-allow-credentials') !== 'true') {
        throw new Error('credentials are not allowed');
      }
      return web;
    });
  }

  await check('CORS refuses other sites', async () => {
    const response = await request(`${api}/api/me`, {
      method: 'OPTIONS',
      headers: { origin: DISALLOWED_ORIGIN, 'access-control-request-method': 'GET' },
    });
    const allowed = response.headers.get('access-control-allow-origin');
    if (allowed === DISALLOWED_ORIGIN || allowed === '*')
      throw new Error(`allow-origin is ${allowed}`);
    return 'unknown origins get no CORS headers';
  });

  await check('guest session cookie', async () => {
    const response = await request(`${api}/api/me`);
    expectStatus(response, 200);
    const me = meResponseSchema.parse(await response.json());
    if (me.identity.kind !== 'guest') throw new Error('expected a guest identity');
    const cookie = response.headers.getSetCookie().find((value) => value.includes('a_ai_guest='));
    if (!cookie) throw new Error('no guest cookie was issued');
    const flags = cookie.split(';').map((part) => part.trim().toLowerCase());
    const missing = ['httponly', 'samesite=lax', ...(https ? ['secure'] : [])].filter(
      (flag) => !flags.includes(flag),
    );
    if (https && !cookie.startsWith('__Host-')) missing.push('__Host- prefix');
    if (missing.length > 0) throw new Error(`guest cookie lacks ${missing.join(', ')}`);
    return `guest quota ${me.quota.remaining} of ${me.quota.limit}`;
  });

  await check('models', async () => {
    const response = await request(`${api}/api/models`);
    expectStatus(response, 200);
    const body = modelsResponseSchema.parse(await response.json());
    if (body.models.length === 0) throw new Error('no models are listed');
    return `${body.models.length} models, default ${body.defaultModel ? body.defaultModel.id : 'none'}`;
  });

  await check('capabilities', async () => {
    const [audio, image, video] = await Promise.all(
      ['/api/audio/status', '/api/image/status', '/api/video/status'].map((path) =>
        request(`${api}${path}`),
      ),
    );
    for (const response of [audio, image, video]) expectStatus(response as Response, 200);
    const voice = audioStatusSchema.parse(await (audio as Response).json());
    const images = mediaGenerationStatusSchema.parse(await (image as Response).json());
    const videos = mediaGenerationStatusSchema.parse(await (video as Response).json());
    return `voice ${onOff(voice.transcription.enabled)}, image ${onOff(images.enabled)}, video ${onOff(videos.enabled)}`;
  });

  if (web && options.checkWeb !== false) {
    await check('web app', async () => {
      const response = await request(web);
      expectStatus(response, 200);
      if (!(await response.text()).includes('id="root"'))
        throw new Error('index.html was not served');
      const policy = response.headers.get('content-security-policy') ?? '';
      if (!policy.includes("script-src 'self'"))
        throw new Error('strict Content-Security-Policy missing');
      if (web.startsWith('https://') && !response.headers.get('strict-transport-security')) {
        throw new Error('Strict-Transport-Security missing');
      }
      return 'served with a strict CSP';
    });

    await check('web deep link', async () => {
      const response = await request(`${web}/chat`);
      expectStatus(response, 200);
      if (!(await response.text()).includes('id="root"'))
        throw new Error('/chat did not resolve to the app');
      return 'client routes resolve to the app';
    });
  }

  return results;
}

/** Polls GET /health until the API reports `commit`, for up to `timeoutMs`. */
export async function waitForCommit(options: {
  apiUrl: string;
  commit: string;
  timeoutMs: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const api = trimOrigin(options.apiUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${api}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const body = healthResponseSchema.safeParse(await response.json());
        if (body.success && body.data.commit === options.commit) return true;
      }
    } catch {
      // The new instance may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 10_000));
  }
  return false;
}
