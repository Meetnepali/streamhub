import { getDeviceKey } from './deviceKey';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body, init?: RequestInit): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'include',
    headers: {
      'X-Device-Key': getDeviceKey(),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    ...init,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>('GET', url, undefined, init),
  post: <T>(url: string, body?: Body, init?: RequestInit) => request<T>('POST', url, body, init),
  put: <T>(url: string, body?: Body) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: Body) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}
