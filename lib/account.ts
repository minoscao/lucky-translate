export type AccountSnapshot = {
  id: string; username: string; email: string | null; status: string; level: string; membershipExpiresAt: number | null; monthlyPrice: number;
  costMultiplier: number;
  limits: { dailySeconds: number; monthlySeconds: number; dailyTokens: number };
  usage: { todayTokens: number; todayCost: number; todaySeconds: number; todayTrainingSeconds: number; todayTranslationSeconds: number; monthTokens: number; monthCost: number; monthSeconds: number; monthTrainingSeconds: number; monthTranslationSeconds: number; totalTokens: number; totalCost: number; totalSeconds: number };
  storage: { bytes: number; limitBytes: number; warning: boolean; ratio: number };
};

export async function accountRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers); if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '暂时无法完成操作');
  return data;
}

export async function saveCloudRecord(id: string, type: string, data: unknown) {
  return accountRequest<{ saved: boolean; account: AccountSnapshot }>('/api/cloud', { method: 'PUT', body: JSON.stringify({ id, type, data }) });
}
