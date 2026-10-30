import {
  createElement,
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement
} from 'react'

/** Every lazy component's loader, as its module declares it. */
const loads = new Set<() => Promise<unknown>>()

/**
 * A named export as a lazy component: its module, and everything only it
 * imports, become a chunk of their own that loads the first time it renders
 * (P9.1). Render it inside a `Suspense`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<Module extends Record<string, any>, Name extends keyof Module & string>(
  load: () => Promise<Module>,
  name: Name
): LazyExoticComponent<Module[Name]> {
  loads.add(load)
  return lazy(async () => ({ default: (await load())[name] }))
}

/**
 * A lazy dialog or other layer that loads on its own: `lazyNamed` inside a
 * Suspense boundary of its own, which shows nothing while it loads. Without
 * one, the nearest boundary would hide everything else it holds until the
 * code arrives (a drawer the dialog was opened from, with the focus in it),
 * so focus could not go back to what opened the dialog (WCAG 2.4.3).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyLayer<Module extends Record<string, any>, Name extends keyof Module & string>(
  load: () => Promise<Module>,
  name: Name
): (props: ComponentProps<Module[Name]>) => ReactElement {
  const Lazy = lazyNamed(load, name) as unknown as ComponentType<ComponentProps<Module[Name]>>
  return function LazyLayer(props: ComponentProps<Module[Name]>) {
    return createElement(Suspense, { fallback: null }, createElement(Lazy, props))
  }
}

/**
 * Loads the code of every lazy component declared so far (by the modules
 * imported until now). The component tests do this before they start
 * (tests/setup-components.ts): there, a chunk's code is compiled on first
 * use, which on a busy machine takes longer than a test waits for what it
 * shows.
 */
export function loadLazyComponents(): Promise<unknown> {
  return Promise.all([...loads].map((load) => load()))
}

/**
 * True from the first render where `value` is true, for good: a lazy panel
 * that opens and closes (a drawer) loads on first use, then stays mounted so
 * it can animate closed and open again at once.
 */
export function useLatch(value: boolean): boolean {
  const [latched, setLatched] = useState(value)
  if (value && !latched) setLatched(true)
  return latched || value
}
