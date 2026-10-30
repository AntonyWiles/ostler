import type { WatchedProject } from '@shared/ostler-api'
import type { ReportService } from '../services/report-service'
import { handleApi } from './handle-ipc'

export interface ReportHandlerDependencies {
  reportService: ReportService
  /** Resolves an enabled project or throws: the access check. */
  getProject(projectId: string): WatchedProject
}

/** The project dashboard (P6.2): the same report `GET /reports` returns. */
export function registerReportHandlers({ reportService, getProject }: ReportHandlerDependencies) {
  handleApi('getProjectReport', async (_event, projectId: string, range: unknown) =>
    reportService.getReport(getProject(projectId), range)
  )
  // Compare rounds (N5.7b): the same as `GET /milestones/:milestoneId/rounds`.
  handleApi('getRoundComparison', async (_event, projectId: string, milestoneId: unknown) =>
    reportService.getRoundComparison(getProject(projectId), milestoneId)
  )
}
