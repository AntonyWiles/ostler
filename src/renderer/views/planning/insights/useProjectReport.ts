import { useEffect, useState } from 'react'
import type { ProjectReport, ReportRange } from '@shared/ostler-api'

export interface ProjectReportState {
  report: ProjectReport | null
  error: string | null
  loading: boolean
}

/**
 * The project's report for a range, read again whenever `revision` changes
 * (the workspace's tasks or milestones were reloaded). Main caches it, so a
 * read with nothing changed is cheap.
 */
export function useProjectReport(
  projectId: string,
  range: ReportRange,
  revision: unknown
): ProjectReportState {
  const [state, setState] = useState<ProjectReportState>({
    report: null,
    error: null,
    loading: true
  })

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true }))
    void window.ostlerAPI
      .getProjectReport(projectId, range)
      .then((result) => {
        if (!active) return
        setState(
          result.ok
            ? { report: result.value, error: null, loading: false }
            : { report: null, error: result.error, loading: false }
        )
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            report: null,
            error: error instanceof Error ? error.message : String(error),
            loading: false
          })
      })
    return () => {
      active = false
    }
  }, [projectId, range, revision])

  return state
}
