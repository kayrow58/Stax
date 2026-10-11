import { getStore } from '@netlify/blobs'

/** The small slice of Netlify Blobs the app uses. Swappable for tests. */
export interface KV {
  get<T>(key: string): Promise<{ data: T; etag: string } | null>
  set(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<boolean>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

export function blobsKV(): KV {
  const store = getStore({ name: 'stax', consistency: 'strong' })
  return {
    async get<T>(key: string) {
      const r = await store.getWithMetadata(key, { type: 'json' })
      if (!r || r.data == null) return null
      return { data: r.data as T, etag: r.etag ?? '' }
    },
    async set(key, value, opts) {
      const r = opts?.onlyIfNew
        ? await store.setJSON(key, value, { onlyIfNew: true })
        : opts?.onlyIfMatch !== undefined
          ? await store.setJSON(key, value, { onlyIfMatch: opts.onlyIfMatch })
          : await store.setJSON(key, value)
      return r.modified
    },
    async delete(key) {
      await store.delete(key)
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix })
      return blobs.map((b) => b.key)
    },
  }
}

/** In-memory version with the same conditional-write rules (used by tests). */
export function memoryKV(): KV {
  const m = new Map<string, { json: string; etag: string }>()
  let n = 0
  return {
    async get<T>(key: string) {
      const v = m.get(key)
      return v ? { data: JSON.parse(v.json) as T, etag: v.etag } : null
    },
    async set(key, value, opts) {
      const cur = m.get(key)
      if (opts?.onlyIfNew && cur) return false
      if (opts?.onlyIfMatch !== undefined && (!cur || cur.etag !== opts.onlyIfMatch)) return false
      m.set(key, { json: JSON.stringify(value), etag: `"${++n}"` })
      return true
    },
    async delete(key) {
      m.delete(key)
    },
    async list(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix))
    },
  }
}
