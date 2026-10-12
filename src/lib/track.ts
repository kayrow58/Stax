import { api } from './api'
import { isInstalled } from './push'

type Detail = Record<string, string | number | boolean>

/** Report a feature use for the admin dashboard. Fire-and-forget; never blocks the app. */
export function track(name: string, detail?: Detail) {
  void api('POST', '/event', { name, detail }).catch(() => undefined)
}

function platform(): string {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone'
  if (/android/i.test(ua)) return 'Android'
  if (/mac/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows'
  return 'Other'
}

const SESSION_GAP_MS = 30 * 60_000
let lastOpen = 0

/** One "open" per visit: on launch, and again after 30+ minutes away. */
export function trackOpen() {
  const now = Date.now()
  if (now - lastOpen < SESSION_GAP_MS) return
  lastOpen = now
  const params = new URLSearchParams(window.location.search)
  const fromReminder = params.get('from') === 'reminder'
  track('open', { platform: platform(), installed: isInstalled(), source: fromReminder ? 'reminder' : 'direct' })
  if (fromReminder) {
    track('reminder_open')
    params.delete('from')
    const q = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash)
  }
}

export function watchVisits() {
  trackOpen()
  const onVisible = () => document.visibilityState === 'visible' && trackOpen()
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}
