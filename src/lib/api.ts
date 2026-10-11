import { refreshSession } from '@netlify/identity'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  return 'Something went wrong. Please try again.'
}

function token(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)nf_jwt=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

async function send(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {}
  const t = token()
  if (t) headers.Authorization = `Bearer ${t}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  })
}

/** Call the Stax backend (netlify/functions/api.mts). Throws ApiError with a readable message. */
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body)
  if (res.status === 401) {
    // The sign-in token may have just expired: refresh it once and retry.
    try {
      await refreshSession()
    } catch {
      /* fall through */
    }
    res = await send(method, path, body)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'Something went wrong. Please try again.')
  return data as T
}
