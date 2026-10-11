import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

/** False until the Supabase keys are added (see README, step 3). */
export const configured = Boolean(url && key)

export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Turn a Supabase error into a sentence a person can read. */
export function errorText(err: unknown): string {
  if (!err) return 'Something went wrong. Please try again.'
  if (typeof err === 'string') return err
  const m = (err as { message?: string }).message
  return m || 'Something went wrong. Please try again.'
}
