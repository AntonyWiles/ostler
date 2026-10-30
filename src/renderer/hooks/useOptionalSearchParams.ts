import { useInRouterContext, useSearchParams, type SetURLSearchParams } from 'react-router-dom'

const NONE = new URLSearchParams()
const IGNORE: SetURLSearchParams = () => {}

/**
 * The address's query, or an empty one outside a router: for panels that
 * read a hand-off (`?view=`, `?edit=`) but also render on their own, as in
 * component tests. A component is always inside a router or never, so the
 * hook order never changes.
 */
export function useOptionalSearchParams(): [URLSearchParams, SetURLSearchParams] {
  const inRouter = useInRouterContext()
  return inRouter ? useSearchParams() : [NONE, IGNORE]
}
