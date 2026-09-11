import { AccountSnapshot } from './account';

export const SESSION_CHANGED = 'lucky-session-changed';
export const SESSION_MARKER = 'lucky-session-revision';
export const cacheKey = (owner: string, key: string) => `lucky-account:${encodeURIComponent(owner)}:${key}`;

// Older mobile browsers have AbortController but not AbortSignal.any or
// throwIfAborted. Keep cancellation active while the response body is read too.
function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('Request cancelled', 'AbortError');
}
function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortReason(signal);
}
function combineSignals(signals: AbortSignal[]) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const abort = (signal: AbortSignal) => {
    controller.abort(abortReason(signal));
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    listeners.clear();
  };
  for (const signal of new Set(signals)) {
    if (signal.aborted) { abort(signal); break; }
    const listener = () => abort(signal);
    listeners.set(signal, listener);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}

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
    const signal = init?.signal ? combineSignals([current.signal, init.signal]) : current.signal;
    checkAborted(signal);
    const response = await fetch(url, { ...init, credentials: 'same-origin', headers, signal, cache: 'no-store' });
    checkAborted(signal);
    if (response.status === 401 || response.status === 409) window.dispatchEvent(new Event(SESSION_CHANGED));
    return response;
  };
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const current = lifetime, headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await scopedFetch(url, { ...init, headers });
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    checkAborted(current.signal);
    if (init?.signal) checkAborted(init.signal);
    if (!response.ok) throw new Error(data.error || 'Could not complete this action. Please try again.');
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
