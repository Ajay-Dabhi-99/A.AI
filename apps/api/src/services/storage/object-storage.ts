/**
 * Private object storage for image attachments (Phase 8, ADR-015 §4). The
 * application depends on this interface only; production uses Supabase
 * Storage, tests an in-memory implementation.
 */
export interface ObjectStorage {
  /** False when no storage is configured: uploads are disabled, never faked. */
  readonly enabled: boolean;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A URL anyone holding it can use until it expires. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  remove(keys: string[]): Promise<void>;
}

/** A storage failure. Its message never includes keys, tokens or response bodies. */
export class StorageError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'StorageError';
    this.status = status;
  }
}

export const disabledStorage: ObjectStorage = {
  enabled: false,
  put: () => Promise.reject(new StorageError('Object storage is not configured')),
  get: () => Promise.reject(new StorageError('Object storage is not configured')),
  signedUrl: () => Promise.reject(new StorageError('Object storage is not configured')),
  remove: () => Promise.reject(new StorageError('Object storage is not configured')),
};

export type SupabaseStorageOptions = {
  /** Project URL, e.g. https://abcd.supabase.co */
  url: string;
  /** Service-role key: server-side only, never sent to a browser. */
  serviceRoleKey: string;
  bucket: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Each path segment is encoded; keys only ever contain ids and fixed words. */
function objectPath(bucket: string, key: string): string {
  return [bucket, ...key.split('/')].map(encodeURIComponent).join('/');
}

/**
 * Supabase Storage over its REST API (the same endpoints `@supabase/storage-js`
 * calls), so no SDK is needed:
 * POST /object/{bucket}/{key} upload, GET /object/{bucket}/{key} download,
 * POST /object/sign/{bucket}/{key} signed URL, DELETE /object/{bucket} remove.
 */
export function createSupabaseStorage(options: SupabaseStorageOptions): ObjectStorage {
  const base = `${options.url.replace(/\/+$/, '')}/storage/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const auth = {
    authorization: `Bearer ${options.serviceRoleKey}`,
    apikey: options.serviceRoleKey,
  };

  async function call(action: string, url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new StorageError(
        `Storage ${action} could not reach the storage service`,
        undefined,
        error,
      );
    }
    if (!response.ok) {
      // Drain without reading: error bodies can echo paths or tokens.
      await response.body?.cancel().catch(() => undefined);
      throw new StorageError(
        `Storage ${action} failed with HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  }

  return {
    enabled: true,

    async put(key, bytes, contentType) {
      await call('upload', `${base}/object/${objectPath(options.bucket, key)}`, {
        method: 'POST',
        headers: {
          ...auth,
          'content-type': contentType,
          'cache-control': 'max-age=3600',
          // Keys are unique per attachment; an existing object means a bug, not an update.
          'x-upsert': 'false',
        },
        body: bytes,
      });
    },

    async get(key) {
      const response = await call('download', `${base}/object/${objectPath(options.bucket, key)}`, {
        method: 'GET',
        headers: auth,
      });
      return new Uint8Array(await response.arrayBuffer());
    },

    async signedUrl(key, expiresInSeconds) {
      const response = await call(
        'signed URL',
        `${base}/object/sign/${objectPath(options.bucket, key)}`,
        {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ expiresIn: expiresInSeconds }),
        },
      );
      const body = (await response.json().catch(() => null)) as { signedURL?: unknown } | null;
      if (typeof body?.signedURL !== 'string') {
        throw new StorageError('Storage signed URL response was unreadable');
      }
      return encodeURI(`${base}${body.signedURL}`);
    },

    async remove(keys) {
      if (keys.length === 0) return;
      await call('delete', `${base}/object/${encodeURIComponent(options.bucket)}`, {
        method: 'DELETE',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: keys }),
      });
    },
  };
}
