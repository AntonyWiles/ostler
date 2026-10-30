/**
 * Runs inside Ostler's window (the page's own world) on every load. It is the
 * monkey's eyes and its key logger:
 *
 * - every key the page receives, with the control that had focus, whoever
 *   pressed it: the monkey, an overseer driving the app, or a person at the
 *   keyboard. Password fields are logged as dots.
 * - every click, with the control under it
 * - a running count of DOM changes, so an action that changed nothing shows
 * - an inventory of the visible controls, by role and accessible name
 *
 * Kept as one self-contained function: it is serialised into the page, so it
 * must not use anything from this module's scope.
 */
function pageProbe(): void {
  type ProbeWindow = Window & {
    __monkey?: boolean
    __monkeyKeys: string[]
    __monkeyClicks: string[]
    __monkeyMutations: number
    __monkeyDescribe: (element: Element | null) => string
    __monkeyScreen: () => string
    __monkeyInventory: (tag: boolean) => {
      id: number
      role: string
      name: string
      disabled: boolean
    }[]
  }
  const w = window as unknown as ProbeWindow
  if (w.__monkey) return
  w.__monkey = true
  w.__monkeyKeys = []
  w.__monkeyClicks = []
  w.__monkeyMutations = 0

  const clean = (text: string | null | undefined, max = 80) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

  const roleOf = (element: Element): string => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit.split(' ')[0]
    const tag = element.tagName.toLowerCase()
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'a') return element.hasAttribute('href') ? 'link' : 'a'
    if (tag === 'select') return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = ((element as HTMLInputElement).type || 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
      if (type === 'range') return 'slider'
      if (type === 'search') return 'searchbox'
      return 'textbox'
    }
    return tag
  }

  const nameOf = (element: Element): string => {
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
      if (clean(text)) return clean(text)
    }
    const aria = element.getAttribute('aria-label')
    if (aria && aria.trim()) return clean(aria)
    const labels = (element as HTMLInputElement).labels
    if (labels && labels.length) {
      const text = Array.from(labels)
        .map((label) => label.textContent ?? '')
        .join(' ')
      if (clean(text)) return clean(text)
    }
    const html = element as HTMLElement
    if (html.tagName === 'INPUT') {
      const input = html as HTMLInputElement
      if (['button', 'submit', 'reset'].includes(input.type)) return clean(input.value)
    } else {
      const text = clean(html.innerText || html.textContent)
      if (text) return text
    }
    return clean(element.getAttribute('title') || element.getAttribute('placeholder') || '')
  }

  const interactive =
    'button, a[href], input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=switch], [role=radio], [role=combobox], [role=option], [role=treeitem], [role=slider], [role=gridcell][tabindex], [contenteditable=true]'

  const controlOf = (element: Element | null): Element | null =>
    element ? (element.closest(interactive) ?? element) : null

  w.__monkeyDescribe = (element) => {
    const control = controlOf(element)
    if (!control) return '(nothing)'
    const name = nameOf(control)
    return `${roleOf(control)}${name ? ` "${name}"` : ''}`
  }

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
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const box = html.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0
  }

  /** The top open dialog's name: the screen within the screen. */
  const topDialog = (): string => {
    const dialogs = Array.from(
      document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')
    ).filter(visible)
    const top = dialogs[dialogs.length - 1]
    return top ? clean(nameOf(top) || top.getAttribute('aria-label') || 'dialog', 60) : ''
  }

  // Ostler routes in memory, so the address never changes. Where a person is
  // comes from the title bar ("Pomodoro Desk › Board"), or failing that the
  // page heading and the selected tab.
  w.__monkeyScreen = () => {
    const place = clean(document.querySelector('.ostler-titlebar-place')?.textContent, 80)
    const heading = clean(document.querySelector('main h1')?.textContent, 60)
    const tab = clean(
      document.querySelector('main [role=tab][aria-selected=true]')?.textContent,
      40
    )
    const where = place || [heading, tab].filter(Boolean).join(' › ') || 'Ostler'
    const dialog = topDialog()
    return dialog ? `${where} › ${dialog}` : where
  }

  let nextId = 1
  w.__monkeyInventory = (tag) => {
    const dialogs = Array.from(
      document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')
    ).filter(visible)
    // With a modal open, only its controls are reachable, as for a person.
    const scope: ParentNode = dialogs[dialogs.length - 1] ?? document
    const seen = new Set<Element>()
    const controls: { id: number; role: string; name: string; disabled: boolean }[] = []
    for (const element of Array.from(scope.querySelectorAll(interactive))) {
      if (seen.has(element) || !visible(element)) continue
      seen.add(element)
      const html = element as HTMLElement
      const disabled =
        (html as HTMLButtonElement).disabled === true ||
        html.getAttribute('aria-disabled') === 'true'
      let id = Number(html.dataset.monkeyId || 0)
      if (tag && !id) {
        id = nextId++
        html.dataset.monkeyId = String(id)
      }
      controls.push({ id, role: roleOf(element), name: nameOf(element), disabled })
    }
    return controls
  }

  const stamp = () => new Date().toISOString().slice(11, 23)
  const isSecret = (element: Element | null) =>
    !!element &&
    element instanceof HTMLInputElement &&
    (element.type === 'password' || /key|token|secret/i.test(element.name || element.id))

  // Typing into one field is one line, not one line per key.
  let typing: { target: Element | null; line: number; at: number } | null = null
  document.addEventListener(
    'keydown',
    (event) => {
      const target = document.activeElement
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
      if (printable) {
        const char = isSecret(target) ? '•' : event.key
        if (typing && typing.target === target && Date.now() - typing.at < 2000) {
          w.__monkeyKeys[typing.line] += char
          typing.at = Date.now()
          return
        }
        w.__monkeyKeys.push(
          `${stamp()}  [${w.__monkeyScreen()}]  ${w.__monkeyDescribe(target)}  typed: ${char}`
        )
        typing = { target, line: w.__monkeyKeys.length - 1, at: Date.now() }
        return
      }
      typing = null
      const combo = [
        event.ctrlKey ? 'Ctrl' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey && event.key.length > 1 ? 'Shift' : '',
        event.metaKey ? 'Meta' : '',
        event.key === ' ' ? 'Space' : event.key
      ]
        .filter(Boolean)
        .join('+')
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
      w.__monkeyKeys.push(
        `${stamp()}  [${w.__monkeyScreen()}]  ${w.__monkeyDescribe(target)}  key: ${combo}`
      )
    },
    true
  )

  // Text that arrives without key presses: a paste, or a long text typed in
  // one go. Logged so the key log still shows what went in.
  document.addEventListener(
    'input',
    (event) => {
      const input = event as InputEvent
      if (!input.data || input.data.length < 2) return
      if (input.inputType !== 'insertFromPaste' && input.inputType !== 'insertText') return
      const target = event.target as Element | null
      const text = isSecret(target) ? '•'.repeat(6) : clean(input.data, 120)
      typing = null
      w.__monkeyKeys.push(
        `${stamp()}  [${w.__monkeyScreen()}]  ${w.__monkeyDescribe(target)}  pasted (${input.data.length} chars): ${text}`
      )
    },
    true
  )

  document.addEventListener(
    'click',
    (event) => {
      typing = null
      const target = event.target as Element | null
      w.__monkeyClicks.push(
        `${stamp()}  [${w.__monkeyScreen()}]  click ${w.__monkeyDescribe(target)} at ${Math.round(event.clientX)},${Math.round(event.clientY)}`
      )
    },
    true
  )

  const observer = new MutationObserver((records) => {
    w.__monkeyMutations += records.length
  })
  const start = () =>
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    })
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start)
}

export const PAGE_PROBE_SCRIPT = `(${pageProbe.toString()})()`
