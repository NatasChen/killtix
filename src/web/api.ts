export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public title: string,
    public body: Record<string, unknown>,
  ) {
    super(title);
  }
}

type Handler = (err: ApiError) => void;
let onAuthError: Handler | undefined;
/** Registered by the auth provider so expired sessions and stage changes redirect globally. */
export const setAuthErrorHandler = (h: Handler) => {
  onAuthError = h;
};

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.code ?? 'error', data.title ?? res.statusText, data);
    // /auth/me is the refresh itself: a 401 there just means "signed out" and must not trigger another refresh
    const stageChange = res.status === 401 || ['password_change_required', 'mfa_required', 'mfa_enrollment_required'].includes(err.code);
    if (stageChange && path !== '/auth/me') {
      onAuthError?.(err);
    }
    throw err;
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T = any>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T = any>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T = any>(path: string) => api<T>('DELETE', path);

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
