/**
 * The online meeting an event links to (docs/plans/integrations/overview.md,
 * phase 1, "Join buttons"): Teams, Zoom, Google Meet, Webex, GoTo or Whereby,
 * read from the event's location, then its description. Only https links on
 * those services' own hosts count, so a Join button never opens anything else.
 */

const MEETING_HOSTS = [
  /^teams\.microsoft\.com$/,
  /^teams\.live\.com$/,
  /^([a-z0-9-]+\.)?zoom\.us$/,
  /^([a-z0-9-]+\.)?zoomgov\.com$/,
  /^meet\.google\.com$/,
  /^([a-z0-9-]+\.)?webex\.com$/,
  /^meet\.goto\.com$/,
  /^global\.gotomeeting\.com$/,
  /^whereby\.com$/
]

const URL_PATTERN = /https:\/\/[^\s<>"')\]]+/gi

/** True when `url` is an https link on a known meeting service. */
export function isMeetingLink(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase()
  if (!MEETING_HOSTS.some((pattern) => pattern.test(host))) return false
  // A bare home page is not a meeting.
  return parsed.pathname.length > 1
}

/** The first meeting link in the location, then the description; null when there is none. */
export function meetingLink(location: string, description: string): string | null {
  for (const text of [location, description]) {
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;:!?]+$/, '')
      if (isMeetingLink(url)) return url
    }
  }
  return null
}
