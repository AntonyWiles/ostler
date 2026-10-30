import type { OstlerAPI } from '@shared/ostler-api'

declare global {
  interface Window {
    ostlerAPI: OstlerAPI
  }
}
