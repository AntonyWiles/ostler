import type { Page } from 'playwright'
import { normalise } from './checks'
import type { FindingInput } from './recorder'
import { readNeedlessScroll } from '../../helpers/needless-scroll'
import { readSqueezedText } from '../../helpers/squeezed-text'

/**
 * What a person notices by looking, checked once on every new screen: a
 * control something else lies over, text cut off with no way to read the
 * rest, a control with no name, a broken image, an empty screen, a screen
 * still loading long after it opened, a box that scrolls by a little with
 * room in the window to show all of it. Cheap DOM heuristics, so they are
 * leads (S3, S4), each with the screenshot taken right after.
 */

interface LookState {
  covered: { control: string; by: string }[]
  clipped: { text: string; control: string; ellipsis: boolean }[]
  unnamed: string[]
  brokenImages: string[]
  blank: boolean
  busy: string[]
}

/** Runs in the window: no imports, nothing from this module's scope. */
function readLook(): LookState {
  const clean = (text: string | null | undefined, max = 80) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const describe = (element: Element): string =>
    (window as unknown as { __monkeyDescribe?: (e: Element) => string }).__monkeyDescribe?.(
      element
    ) ?? element.tagName.toLowerCase()
  const visible = (element: Element): boolean => {
    const html = element as HTMLElement
    if (html.closest('[aria-hidden="true"], [inert]')) return false
    // Inside a closed <details>, content-visibility or the like: laid out, never shown.
    const checkable = html as HTMLElement & { checkVisibility?: (options?: object) => boolean }
    if (
      checkable.checkVisibility &&
      !checkable.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })
    )
      return false
    const style = getComputedStyle(html)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
      return false
    const box = html.getBoundingClientRect()
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.right > 0 &&
      box.top < innerHeight &&
      box.left < innerWidth
    )
  }
  /** Screen-reader-only text: a 1-pixel box, or clipped away. Meant to be unseen. */
  const offscreenText = (element: Element): boolean => {
    for (
      let node: Element | null = element, depth = 0;
      node && depth < 4;
      node = node.parentElement, depth += 1
    ) {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      if (box.width <= 2 || box.height <= 2) return true
      if (style.clip && style.clip !== 'auto') return true
      if (style.clipPath && style.clipPath !== 'none' && /inset\((50|100)%/.test(style.clipPath))
        return true
    }
    return false
  }
  /** Inside something that scrolls: a row can sit under a sticky header or footer until scrolled to. */
  const scrolls = (element: Element): boolean => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      const overflows =
        (/(auto|scroll|hidden)/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight + 1) ||
        (/(auto|scroll|hidden)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1)
      if (overflows) return true
    }
    return false
  }
  const pinned = (element: Element): boolean => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const position = getComputedStyle(node).position
      if (position === 'fixed' || position === 'sticky') return true
    }
    return false
  }
  const interactive =
    'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=radio], [role=combobox], [role=option]'
  const dialogs = Array.from(
    document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')
  ).filter(visible)
  const scope: ParentNode = dialogs[dialogs.length - 1] ?? document
  const controls = Array.from(scope.querySelectorAll(interactive)).filter(visible)

  // Covered: the middle of the control is something else, not the control,
  // its label or its own parts. A person clicking it hits the other thing.
  const covered: LookState['covered'] = []
  for (const control of controls) {
    const html = control as HTMLElement
    // Styled radios and checkboxes hide the real input under their label on purpose.
    if (html instanceof HTMLInputElement && ['radio', 'checkbox'].includes(html.type)) continue
    if (html.closest('[role=tooltip]')) continue
    const box = html.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) continue
    const x = Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2))
    const y = Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2))
    // Scrolled out of its scrolling box (a tab strip, a long list): not on screen at all.
    let outside = false
    for (let node = html.parentElement; node && !outside; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (!/(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)) continue
      const frame = node.getBoundingClientRect()
      outside = x < frame.left || x > frame.right || y < frame.top || y > frame.bottom
    }
    if (outside) continue
    const hit = document.elementFromPoint(x, y)
    if (!hit || hit === control || control.contains(hit) || hit.contains(control)) continue
    if (hit.closest('label')?.contains(control) || control.closest('label')?.contains(hit)) continue
    // A tooltip or toast over a control is momentary.
    if (hit.closest('[role=tooltip], [role=status], [role=alert], .ui-toast')) continue
    // Scrolled under a pinned header, footer or status bar: a person scrolls to it.
    if (
      scrolls(control) &&
      (pinned(hit) ||
        !hit.closest('[role=dialog], main') !== !control.closest('[role=dialog], main'))
    )
      continue
    // Under the edge of whatever it scrolls in (a footer in the same dialog).
    if (scrolls(control) && hit.closest('footer, [class*="footer"], [class*="__actions"]')) continue
    covered.push({ control: describe(control), by: describe(hit) })
    if (covered.length >= 8) break
  }

  // Clipped: text wider than its box. With an ellipsis and no title or
  // accessible name holding the whole text, the rest cannot be read.
  const clipped: LookState['clipped'] = []
  const textual = Array.from(
    (scope as ParentNode).querySelectorAll(
      'button, a, label, h1, h2, h3, h4, th, td, li, span, p, [role=tab], [role=menuitem], [role=option]'
    )
  )
  for (const element of textual) {
    const html = element as HTMLElement
    if (!visible(html) || offscreenText(html)) continue
    if (html.children.length > 3) continue
    const text = clean(html.innerText, 120)
    if (text.length < 4) continue
    if (html.scrollWidth <= html.clientWidth + 2 || html.clientWidth === 0) continue
    const style = getComputedStyle(html)
    if (style.overflowX === 'visible' && style.textOverflow !== 'ellipsis') continue
    if (['auto', 'scroll'].includes(style.overflowX)) continue
    const ellipsis = style.textOverflow === 'ellipsis'
    const full = [
      html.getAttribute('title'),
      html.getAttribute('aria-label'),
      html.closest('[title]')?.getAttribute('title'),
      html.closest('[aria-label]')?.getAttribute('aria-label')
    ].join(' ')
    if (ellipsis && full.includes(text.slice(0, 30))) continue
    const control = html.closest(interactive)
    clipped.push({ text, control: control ? describe(control) : describe(html), ellipsis })
    if (clipped.length >= 8) break
  }

  const unnamed: string[] = []
  for (const control of controls) {
    const name = describe(control)
    if (/"/.test(name)) continue
    const html = control as HTMLElement
    unnamed.push(`${name} <${html.tagName.toLowerCase()} class="${clean(html.className, 60)}">`)
    if (unnamed.length >= 8) break
  }

  const brokenImages = Array.from(document.images)
    .filter((image) => visible(image) && image.complete && image.naturalWidth === 0)
    .map((image) => clean(image.getAttribute('alt') || image.src, 100))
    .slice(0, 5)

  const main = document.querySelector('main')
  const blank = !!main && dialogs.length === 0 && clean((main as HTMLElement).innerText).length < 3

  const busy = Array.from(
    document.querySelectorAll(
      '[aria-busy="true"], .ui-spinner[role=status], .ui-skeleton, .ostler-workspace-loading'
    )
  )
    .filter(visible)
    .map(
      (element) =>
        describe(element) +
        (clean(element.textContent, 60) ? ` (${clean(element.textContent, 60)})` : '')
    )
    .slice(0, 5)

  return { covered, clipped, unnamed, brokenImages, blank, busy }
}

export async function lookFindings(page: Page, screen: string): Promise<FindingInput[]> {
  let state = await page.evaluate(readLook).catch(() => null)
  if (!state) return []
  // A screen still loading gets a few seconds; only what is still busy then counts.
  if (state.busy.length || state.blank) {
    await page.waitForTimeout(4000)
    state = (await page.evaluate(readLook).catch(() => null)) ?? state
  }
  const findings: FindingInput[] = []
  for (const entry of state.covered) {
    findings.push({
      kind: 'visual',
      severity: 'S3',
      title: `${entry.control} is covered by ${entry.by}`,
      details:
        'The middle of this control is under something else, so clicking it hits the other thing. ' +
        'Check the screenshot: a popover left open, a sticky bar, or a layout that overlaps at this window size.',
      where: screen,
      key: `covered|${screen}|${normalise(entry.control)}`
    })
  }
  for (const entry of state.clipped) {
    findings.push({
      kind: 'visual',
      severity: 'S4',
      title: `Text cut off${entry.ellipsis ? ' with no way to read the rest' : ''}: "${entry.text.slice(0, 60)}"`,
      details: `In ${entry.control}. The text is wider than its box${entry.ellipsis ? ', ends in "…", and neither a tooltip nor the accessible name has the whole text' : ' and is clipped mid-word'}.`,
      where: screen,
      key: `clipped|${screen}|${normalise(entry.text.slice(0, 40))}`
    })
  }
  for (const entry of state.unnamed) {
    findings.push({
      kind: 'a11y',
      severity: 'S3',
      title: `A control has no name: ${entry.slice(0, 100)}`,
      details:
        'A screen reader announces it only by its role, and the monkey cannot tell what it does.',
      where: screen,
      key: `unnamed|${screen}|${normalise(entry)}`
    })
  }
  for (const image of state.brokenImages) {
    findings.push({
      kind: 'visual',
      severity: 'S3',
      title: `A broken image: ${image}`,
      details: 'The image loaded with no picture in it.',
      where: screen,
      key: `image|${normalise(image)}`
    })
  }
  if (state.blank) {
    findings.push({
      kind: 'broken',
      severity: 'S2',
      title: 'The screen is blank',
      details: 'The main area has no text at all after five seconds.',
      where: screen,
      key: `blank|${screen}`
    })
  }
  const needless = await page.evaluate(readNeedlessScroll).catch(() => [])
  for (const entry of needless) {
    findings.push({
      kind: 'visual',
      severity: 'S4',
      title: `A needless scrollbar: ${entry.element.slice(0, 80)}`,
      details: `It hides ${entry.hidden}px behind a scrollbar while there is room for ${entry.room}px more, so it could show everything. Let it grow, or let its dialog or page scroll instead.`,
      where: screen,
      key: `needless-scroll|${screen}|${normalise(entry.element)}`
    })
  }
  const squeezed = await page.evaluate(readSqueezedText).catch(() => [])
  for (const entry of squeezed) {
    findings.push({
      kind: 'visual',
      severity: 'S3',
      title: `Text squeezed into a narrow column: ${entry.element.slice(0, 80)}`,
      details: `It wraps onto ${entry.lines} lines only ${entry.width}px wide, so it reads down the page. Give the text a minimum width, or let what sits beside it wrap or move below.`,
      where: screen,
      key: `squeezed-text|${screen}|${normalise(entry.element)}`
    })
  }
  for (const busy of state.busy) {
    findings.push({
      kind: 'perf',
      severity: 'S3',
      title: `Still loading after 4 s: ${busy.slice(0, 100)}`,
      details:
        'Something on this screen still shows it is loading four seconds after the screen opened, with the stand-in AI and a small project.',
      where: screen,
      key: `busy|${screen}|${normalise(busy)}`
    })
  }
  return findings
}
