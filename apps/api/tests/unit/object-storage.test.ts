import { describe, expect, it } from 'vitest';
import {
  createSupabaseStorage,
  disabledStorage,
  StorageError,
} from '../../src/services/storage/object-storage.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const KEY = 'service-role-secret';

function storage(fetchImpl: typeof fetch) {
  return createSupabaseStorage({
    url: 'https://project.supabase.co/',
    serviceRoleKey: KEY,
    bucket: 'a-ai-attachments',
    fetchImpl,
  });
}

describe('Supabase storage adapter', () => {
  it('uploads to the private bucket with the service-role key and no upsert', async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response('{}', { status: 200 }));
    await storage(fetchImpl).put('users/u1/a.png', Uint8Array.from([1, 2]), 'image/png');

    expect(calls[0]?.url).toBe(
      'https://project.supabase.co/storage/v1/object/a-ai-attachments/users/u1/a.png',
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.init.method).toBe('POST');
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['content-type']).toBe('image/png');
    expect(headers['x-upsert']).toBe('false');
  });

  it('downloads bytes', async () => {
    const { fetchImpl } = fakeFetch(() => new Response(Uint8Array.from([7, 8, 9])));
    expect([...(await storage(fetchImpl).get('users/u1/a.png'))]).toEqual([7, 8, 9]);
  });

  it('signs a URL for the requested lifetime', async () => {
    const { calls, fetchImpl } = fakeFetch(() =>
      Response.json({ signedURL: '/object/sign/a-ai-attachments/users/u1/a.png?token=abc' }),
    );
    const url = await storage(fetchImpl).signedUrl('users/u1/a.png', 300);

    expect(url).toBe(
      'https://project.supabase.co/storage/v1/object/sign/a-ai-attachments/users/u1/a.png?token=abc',
    );
    expect(calls[0]?.url).toBe(
      'https://project.supabase.co/storage/v1/object/sign/a-ai-attachments/users/u1/a.png',
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ expiresIn: 300 });
  });

  it('removes several objects in one request and skips empty removals', async () => {
    const { calls, fetchImpl } = fakeFetch(() => Response.json([]));
    await storage(fetchImpl).remove([]);
    expect(calls).toHaveLength(0);

    await storage(fetchImpl).remove(['users/u1/a.png', 'users/u1/b.jpg']);
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('https://project.supabase.co/storage/v1/object/a-ai-attachments');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      prefixes: ['users/u1/a.png', 'users/u1/b.jpg'],
    });
  });

  it('reports failures without keys, paths or response bodies', async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response(`bucket a-ai-attachments token ${KEY}`, { status: 403 }),
    );
    const error = await storage(fetchImpl)
      .put('users/u1/a.png', Uint8Array.from([1]), 'image/png')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).status).toBe(403);
    expect((error as StorageError).message).not.toContain(KEY);
    expect((error as StorageError).message).not.toContain('users/u1');

    const unreachable = createSupabaseStorage({
      url: 'https://project.supabase.co',
      serviceRoleKey: KEY,
      bucket: 'a-ai-attachments',
      fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
    });
    await expect(unreachable.get('users/u1/a.png')).rejects.toBeInstanceOf(StorageError);
  });

  it('rejects an unreadable signed URL response', async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ unexpected: true }));
    await expect(storage(fetchImpl).signedUrl('users/u1/a.png', 60)).rejects.toThrow(
      'Storage signed URL response was unreadable',
    );
  });

  it('is disabled, never faked, when storage is not configured', async () => {
    expect(disabledStorage.enabled).toBe(false);
    await expect(
      disabledStorage.put('users/u1/a.png', Uint8Array.from([1]), 'image/png'),
    ).rejects.toBeInstanceOf(StorageError);
  });
});
