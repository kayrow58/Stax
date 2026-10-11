// Haptics and sound for the scratch-off. Everything fails silently on devices
// that don't support it (for example, iPhones don't support vibration on the web).

const SOUND_KEY = 'ss.sound'
export const soundOn = () => localStorage.getItem(SOUND_KEY) !== 'off'
export const setSoundOn = (on: boolean) => localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

function audio(): AudioContext | null {
  if (!soundOn()) return null
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

let lastScratch = 0
export function scratchTick() {
  const now = performance.now()
  if (now - lastScratch < 70) return
  lastScratch = now
  buzz(5)
  const c = audio()
  if (!c) return
  try {
    if (!noise) {
      const len = Math.floor(c.sampleRate * 0.07)
      noise = c.createBuffer(1, len, c.sampleRate)
      const d = noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    }
    const src = c.createBufferSource()
    const filter = c.createBiquadFilter()
    const gain = c.createGain()
    src.buffer = noise
    filter.type = 'highpass'
    filter.frequency.value = 2400
    gain.gain.value = 0.12
    src.connect(filter).connect(gain).connect(c.destination)
    src.start()
  } catch {
    /* ignore */
  }
}

export function chime(big = false) {
  buzz(big ? [30, 50, 30, 50, 60] : [25, 40, 35])
  const c = audio()
  if (!c) return
  try {
    const notes = big ? [523, 659, 784, 1047, 1319] : [660, 880, 1320]
    notes.forEach((f, i) => {
      const o = c.createOscillator()
      const g = c.createGain()
      const t = c.currentTime + i * 0.08
      o.type = 'triangle'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
      o.connect(g).connect(c.destination)
      o.start(t)
      o.stop(t + 0.34)
    })
  } catch {
    /* ignore */
  }
}
