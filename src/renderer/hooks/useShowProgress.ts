import { useConfig } from './useConfig'

/**
 * Show my progress (N3.6): read from config, and again whenever main says a
 * setting changed. False until read, so Home asks for nothing extra while
 * the setting is off.
 */
export function useShowProgress(): boolean {
  const { config } = useConfig()
  return config?.ui?.showProgress === true
}
