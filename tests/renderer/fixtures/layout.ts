import { afterEach, beforeEach } from 'vitest'

/**
 * jsdom lays nothing out, so every element measures 0 × 0 and a virtualised
 * list shows no rows. This gives every element a size for the tests in the
 * calling file, as a window of that size would.
 */
export function withElementSize(width: number, height: number): void {
  const originals = {
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
    scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
  }
  const offsets = new WeakMap<Element, number>()
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => width
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => height
    })
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get: () => height
    })
    // Room to scroll: the content's own height is not known without layout.
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 10_000_000
    })
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return offsets.get(this) ?? 0
      },
      set(this: Element, value: number) {
        offsets.set(this, value)
      }
    })
    // jsdom does not scroll: set the offset and say so, as a browser would.
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      value(this: Element, options: ScrollToOptions | number, y?: number) {
        const top = typeof options === 'number' ? y : options.top
        const left = typeof options === 'number' ? options : options.left
        if (top !== undefined) this.scrollTop = top
        if (left !== undefined) this.scrollLeft = left
        this.dispatchEvent(new Event('scroll'))
      }
    })
  })
  afterEach(() => {
    if (originals.offsetWidth)
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originals.offsetWidth)
    if (originals.offsetHeight)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originals.offsetHeight)
    if (originals.clientHeight)
      Object.defineProperty(Element.prototype, 'clientHeight', originals.clientHeight)
    if (originals.scrollHeight)
      Object.defineProperty(Element.prototype, 'scrollHeight', originals.scrollHeight)
    if (originals.scrollTop)
      Object.defineProperty(Element.prototype, 'scrollTop', originals.scrollTop)
    if (originals.scrollTo) Object.defineProperty(Element.prototype, 'scrollTo', originals.scrollTo)
    else delete (Element.prototype as { scrollTo?: unknown }).scrollTo
  })
}
