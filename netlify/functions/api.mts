import type { Config } from '@netlify/functions'
import { authUser } from '../lib/auth'
import { handle } from '../lib/app'
import { blobsKV } from '../lib/kv'

// Every /api/* request from the app lands here.
export default async (req: Request) => {
  const kv = blobsKV()
  return handle(req, await authUser(req, kv), kv)
}

export const config: Config = { path: '/api/*' }
