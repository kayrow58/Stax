export type AuthUser = { id: string; email: string }

// Verified tokens, so polling doesn't re-check with Identity every few seconds.
const cache = new Map<string, { user: AuthUser; until: number }>()

function tokenFrom(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (h?.startsWith('Bearer ')) return h.slice(7).trim() || null
  const m = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)nf_jwt=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function expiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

/**
 * Who is making this request, checked against Netlify Identity.
 * The browser library keeps the signed-in user's token in the `nf_jwt` cookie.
 */
export async function authUser(req: Request): Promise<AuthUser | null> {
  const token = tokenFrom(req)
  if (!token) return null
  const now = Date.now()
  const hit = cache.get(token)
  if (hit && hit.until > now) return hit.user

  const res = await fetch(new URL('/.netlify/identity/user', req.url), {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json()) as { id?: string; email?: string }
  if (!body.id) return null
  const user = { id: body.id, email: body.email ?? '' }

  if (cache.size > 1000) cache.clear()
  cache.set(token, { user, until: Math.min(now + 5 * 60_000, expiry(token) || now + 60_000) })
  return user
}
