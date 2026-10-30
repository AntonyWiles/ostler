import type { HomeProgressQuery, YearInReviewQuery } from '@shared/ostler-api'
import type { ProgressService } from '../services/progress-service'
import { handleApi } from './handle-ipc'

export interface ProgressHandlerDependencies {
  progressService: ProgressService
}

/** Progress and your year (N3.6): read only; the service validates every field. */
export function registerProgressHandlers({ progressService }: ProgressHandlerDependencies): void {
  handleApi('getHomeProgress', async (_event, query: HomeProgressQuery) =>
    progressService.home(query)
  )
  handleApi('getYearInReview', async (_event, query: YearInReviewQuery) =>
    progressService.year(query)
  )
}
