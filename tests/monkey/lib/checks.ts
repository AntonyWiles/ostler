import AxeBuilder from '@axe-core/playwright'
import type { Page } from 'playwright'
import type { FindingInput } from './recorder'

/**
 * What the monkey notices by itself after each action. Each check is cheap
 * and returns findings; the session records them with the screen and a
 * screenshot. None of these are proof of a bug on their own: they are leads,
 * which is why most of them are S3 or S4.
 */

/** Text that should never reach a person's screen. */
const SUSPICIOUS_TEXT: { pattern: RegExp; title: string }[] = [
  { pattern: /\bundefined\b/, title: 'The word "undefined" is shown' },
  { pattern: /\bNaN\b/, title: '"NaN" is shown where a number should be' },
  { pattern: /\[object Object\]/, title: '"[object Object]" is shown' },
  { pattern: /\bInvalid Date\b/, title: '"Invalid Date" is shown' },
  { pattern: /\{\{\s*[a-zA-Z]+\s*\}\}/, title: 'An untranslated {{placeholder}} is shown' },
  {
    pattern:
      /\b(?:agents|ai|common|data|desktop|errors|help|library|navigation|onboarding|projects|settings|tasks|views):[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+\b/,
    title: 'A raw translation key is shown instead of words'
  }
]

export interface ScreenState {
  /** Visible text of the window, trimmed to a reasonable size. */
  text: string
  errorBoundary: string | null
  dangerToasts: string[]
  dangerAlerts: string[]
  overflowX: boolean
  /**
   * A part of the window's frame that cannot be scrolled by a person (overflow
   * hidden or clip) but has been scrolled anyway, by focus or scrollIntoView:
   * the sidebar, header or toolbar slide out of sight. Put back once seen.
   */
  frameScrolled: string | null
}

export async function readScreenState(page: Page): Promise<ScreenState> {
  return page.evaluate(() => {
    const text = (document.body?.innerText ?? '').slice(0, 200_000)
    const boundary = document.querySelector('.ostler-error-boundary')
    const titles = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200))
        .filter(Boolean)
    return {
      text,
      errorBoundary: boundary
        ? (boundary.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
        : null,
      dangerToasts: titles('.ui-toast--danger .ui-toast__title'),
      dangerAlerts: titles('.ui-inline-alert--danger'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      frameScrolled: (() => {
        const root = document.getElementById('root')
        const frame: Element[] = [document.documentElement, document.body]
        // The shell: the root and three levels under it, where the sidebar,
        // header and content panes are laid out.
        let level: Element[] = root ? [root] : []
        for (let depth = 0; depth < 4; depth += 1) {
          frame.push(...level)
          level = level.flatMap((element) => Array.from(element.children))
        }
        for (const element of frame) {
          if (element.scrollTop === 0 && element.scrollLeft === 0) continue
          const style = getComputedStyle(element)
          if (!/(hidden|clip)/.test(style.overflowX + style.overflowY)) continue
          const name =
            element.tagName.toLowerCase() +
            (element.id ? '#' + element.id : '') +
            (typeof element.className === 'string' && element.className
              ? '.' + element.className.trim().split(/\s+/).join('.')
              : '')
          const moved =
            'scrolled ' + element.scrollLeft + ' px across, ' + element.scrollTop + ' px down'
          // What sticks out past its edge and gave it room to scroll: the
          // innermost such elements, as the place to fix.
          const frameBox = element.getBoundingClientRect()
          const sticksOut = (node: Element) => {
            const box = node.getBoundingClientRect()
            return (
              box.width > 0 &&
              // Measured as if the frame were not scrolled.
              (box.right + element.scrollLeft > frameBox.right + 1 ||
                box.bottom + element.scrollTop > frameBox.bottom + 1)
            )
          }
          const culprits = Array.from(element.querySelectorAll('*'))
            .slice(0, 20_000)
            .filter((node) => sticksOut(node) && !Array.from(node.children).some(sticksOut))
            .slice(0, 6)
            .map((node) => {
              const box = node.getBoundingClientRect()
              const label =
                node.tagName.toLowerCase() +
                (typeof node.className === 'string' && node.className
                  ? '.' + node.className.trim().split(/\s+/).slice(0, 3).join('.')
                  : '')
              return `${label} (right ${Math.round(box.right + element.scrollLeft)}, bottom ${Math.round(box.bottom + element.scrollTop)}, frame ${Math.round(frameBox.right)}×${Math.round(frameBox.bottom)})`
            })
          element.scrollTop = 0
          element.scrollLeft = 0
          return (
            name + ' ' + moved + (culprits.length ? '. Sticking out: ' + culprits.join('; ') : '')
          )
        }
        return null
      })()
    }
  })
}

/** The textual leads in a screen's state. */
export function screenFindings(state: ScreenState, screen: string): FindingInput[] {
  const findings: FindingInput[] = []
  if (state.errorBoundary) {
    findings.push({
      kind: 'broken',
      severity: 'S2',
      title: 'A view crashed and showed its error page',
      details: state.errorBoundary,
      where: screen,
      key: `boundary|${screen}`
    })
  }
  for (const title of state.dangerToasts) {
    findings.push({
      kind: 'error',
      severity: 'S3',
      title: `Error message: ${title}`,
      details:
        'A danger toast appeared after this action. Check whether the action was wrong or Ostler was.',
      where: screen,
      key: `toast|${normalise(title)}`
    })
  }
  for (const alert of state.dangerAlerts) {
    findings.push({
      kind: 'error',
      severity: 'S3',
      title: `Error shown on the page: ${alert.slice(0, 120)}`,
      details: alert,
      where: screen,
      key: `alert|${normalise(alert)}`
    })
  }
  for (const { pattern, title } of SUSPICIOUS_TEXT) {
    const match = pattern.exec(state.text)
    if (!match) continue
    const start = Math.max(0, match.index - 60)
    findings.push({
      kind: 'visual',
      severity: 'S3',
      title,
      details: `…${state.text.slice(start, match.index + match[0].length + 60).replace(/\s+/g, ' ')}…`,
      where: screen,
      key: `text|${title}|${screen}`
    })
  }
  if (state.frameScrolled) {
    findings.push({
      kind: 'visual',
      severity: 'S3',
      title: "The window's frame scrolled out of place",
      details:
        `${state.frameScrolled}. This part of the frame does not scroll for a person (overflow is hidden), ` +
        'but moving focus or scrolling a control into view moved it, so the sidebar, header or toolbar slid out of sight ' +
        'and only a restart puts it back. Keyboard users get here by tabbing to something off-screen. ' +
        'The monkey put it back after the screenshot.',
      where: screen,
      key: `frame|${screen.split(' › ').slice(0, 2).join(' › ')}`
    })
  }
  if (state.overflowX) {
    findings.push({
      kind: 'visual',
      severity: 'S4',
      title: 'The window scrolls sideways',
      details:
        'The page is wider than the window, so part of it is cut off or needs a horizontal scroll.',
      where: screen,
      key: `overflow|${screen}`
    })
  }
  return findings
}

/** Ids, numbers and times vary between occurrences of the same problem. */
export function normalise(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, ':time')
    .replace(/\d+/g, '#')
    .slice(0, 160)
}

/** Serious and critical axe violations on the screen as it is now. */
export async function accessibilityFindings(page: Page, screen: string): Promise<FindingInput[]> {
  try {
    const results = await new AxeBuilder({ page })
      // Electron cannot open the blank page axe's default mode uses for iframes.
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    // WCAG 1.4.3 exempts inactive controls from contrast: drop contrast
    // failures inside a disabled or busy control.
    for (const violation of results.violations) {
      if (violation.id !== 'color-contrast') continue
      const keep: typeof violation.nodes = []
      for (const node of violation.nodes) {
        const selector = String(node.target[0] ?? '')
        const inactive = await page
          .evaluate(
            (css) =>
              !!document
                .querySelector(css)
                ?.closest('[aria-disabled="true"], :disabled, [aria-busy="true"]'),
            selector
          )
          .catch(() => false)
        if (!inactive) keep.push(node)
      }
      violation.nodes = keep
    }
    // A control can be inactive for a moment (a dialog loading its data) and
    // be caught then. Contrast failures count only if they are still there on
    // a second look.
    const contrast = results.violations.find((violation) => violation.id === 'color-contrast')
    if (contrast && contrast.nodes.length > 0) {
      await page.waitForTimeout(1500)
      const again = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withRules(['color-contrast'])
        .analyze()
      const still = new Set(
        again.violations.flatMap((violation) =>
          violation.nodes.map((node) => node.target.join(' '))
        )
      )
      contrast.nodes = contrast.nodes.filter((node) => still.has(node.target.join(' ')))
    }
    return results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .filter((violation) => violation.nodes.length > 0)
      .map((violation) => ({
        kind: 'a11y' as const,
        severity: violation.impact === 'critical' ? ('S2' as const) : ('S3' as const),
        title: `${violation.id}: ${violation.help}`,
        details: violation.nodes
          .slice(0, 5)
          .map(
            (node) =>
              `${node.target.join(' ')} — ${(node.failureSummary ?? '').split('\n')[1]?.trim() ?? ''}`
          )
          .join('\n'),
        where: screen,
        key: `a11y|${violation.id}|${screen}`
      }))
  } catch (error) {
    return [
      {
        kind: 'error',
        severity: 'S4',
        title: 'The accessibility check could not run',
        details: String(error),
        where: screen,
        key: 'a11y-failed'
      }
    ]
  }
}
