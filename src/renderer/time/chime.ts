/**
 * The focus chime (N3.5, N29): two soft notes made with the Web Audio API, so
 * no sound file ships. It plays through Windows' own mixer, so a muted PC (or
 * a muted Ostler) stays silent, and `playChimeOnce` never plays the same
 * moment twice, however many times the window hears about it.
 */

const played = new Set<string>()

type AudioContextClass = typeof AudioContext

function audioContextClass(): AudioContextClass | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { AudioContext?: AudioContextClass }).AudioContext
  return typeof candidate === 'function' ? candidate : null
}

/** Plays the chime once for `key` (a focus id and what ended). Returns whether it played. */
export function playChimeOnce(key: string): boolean {
  if (played.has(key)) return false
  played.add(key)
  return playChime()
}

export function playChime(): boolean {
  const Context = audioContextClass()
  if (!Context) return false
  try {
    const context = new Context()
    const start = context.currentTime + 0.05
    // A fifth apart, each fading out: soft, short and not alarming.
    for (const [frequency, offset] of [
      [659.25, 0],
      [987.77, 0.18]
    ] as const) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 1.2)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 1.25)
    }
    setTimeout(() => void context.close().catch(() => {}), 2000)
    return true
  } catch {
    return false
  }
}
