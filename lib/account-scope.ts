import { AccountSnapshot } from './account';

export const SESSION_CHANGED = 'lucky-session-changed';
export const SESSION_MARKER = 'lucky-session-revision';
export const cacheKey = (owner: string, key: string) => `lucky-account:${encodeURIComponent(owner)}:${key}`;

// A workspace owns its requests and cache for its entire lifetime, even after
// another tab changes the browser's shared session cookie.
export function createAccountScope(owner: string) {
  let lifetime = new AbortController();
  const storage = {
    getItem(key: string) { return owner && !lifetime.signal.aborted ? localStorage.getItem(cacheKey(owner, key)) : null; },
    setItem(key: string, value: string) { if (owner && !lifetime.signal.aborted) localStorage.setItem(cacheKey(owner, key), value); },
    removeItem(key: string) { if (owner && !lifetime.signal.aborted) localStorage.removeItem(cacheKey(owner, key)); },
  };
  const scopedFetch = async (url: string, init?: RequestInit) => {
    const current = lifetime;
    if (!owner || current.signal.aborted) throw new DOMException('Account closed', 'AbortError');
    const headers = new Headers(init?.headers); headers.set('X-Lucky-Account', owner);
    const signal = init?.signal ? AbortSignal.any([current.signal, init.signal]) : current.signal;
    const response = await fetch(url, { ...init, credentials: 'same-origin', headers, signal, cache: 'no-store' });
    signal.throwIfAborted();
    if (response.status === 401 || response.status === 409) window.dispatchEvent(new Event(SESSION_CHANGED));
    return response;
  };
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const current = lifetime, headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await scopedFetch(url, { ...init, headers });
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    current.signal.throwIfAborted();
    if (!response.ok) throw new Error(data.error || '暂时无法完成操作');
    return data;
  }
  return {
    owner, storage, fetch: scopedFetch, request,
    get active() { return Boolean(owner) && !lifetime.signal.aborted; },
    activate() { if (lifetime.signal.aborted) lifetime = new AbortController(); },
    dispose() { lifetime.abort(); },
    save(id: string, type: string, data: unknown) {
      return request<{ saved: boolean; account: AccountSnapshot }>('/api/cloud', { method: 'PUT', body: JSON.stringify({ id, type, data }) });
    },
  };
}
export type AccountScope = ReturnType<typeof createAccountScope>;
