import { DEFAULT_CONFIG, type OstlerAPI, type RendererConfig } from '@shared/ostler-api'
import { toRendererConfig } from '@shared/renderer-config'

/** The default config as `getConfig` hands it to the renderer: no key, no tokens. */
export const RENDERER_DEFAULT_CONFIG: RendererConfig = toRendererConfig(DEFAULT_CONFIG)

/**
 * Installs a `window.ostlerAPI` fake typed against the real `OstlerAPI` contract.
 *
 * Methods in `overrides` behave as given. Every other method resolves to a clear "not mocked"
 * failure, and every `on*` subscription returns a no-op unsubscribe. Because `overrides` is a
 * `Partial<OstlerAPI>`, renaming a method in the contract breaks typecheck instead of a test.
 */
export function installOstlerApi(overrides: Partial<OstlerAPI> = {}): OstlerAPI {
  const api = new Proxy(overrides, {
    get(target, property) {
      // `then` stays undefined so the fake is never mistaken for a promise.
      if (typeof property !== 'string' || property === 'then') return undefined
      if (property in target) return target[property as keyof OstlerAPI]
      // A value, not a method: no appearance unless a test passes one.
      if (property === 'initialAppearance') return null
      if (/^on[A-Z]/.test(property)) return () => () => {}
      return async () => ({ ok: false, error: `ostlerAPI.${property} is not mocked in this test` })
    }
  }) as OstlerAPI
  window.ostlerAPI = api
  return api
}
