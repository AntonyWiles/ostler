import type { Ref } from 'react'

/** Points a callback or object ref at `value`, so a component can share its element. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}
