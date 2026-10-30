import { useEffect, useState } from 'react'
import type { ProjectArea } from '@shared/project-areas'
import type { RendererProject, TimelineOverviewProject } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { formatDateTime } from '@shared/format'
import { groupProjectsByArea } from '@shared/project-areas'
import type { TimelineOverviewPrintRoute } from '@shared/print-route'
import './PrintPage.css'
import { t } from '@shared/i18n'

interface OverviewPrintData {
  projects: RendererProject[]
  areas: ProjectArea[]
  overview: Map<string, TimelineOverviewProject>
}

async function unwrap<T>(call: Promise<{ ok: true; value: T } | { ok: false; error: string }>) {
  const result = await call
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

/**
 * Print the Timeline across projects (N5.4): every shown project's row, in
 * its area, with its dated span and each milestone on its own line, drawn
 * like the project Timeline's printout (a table with a schedule column), from
 * the call the view makes (`getTimelineOverview`). Every row is on the page:
 * no virtualisation, no controls.
 */
export function TimelineOverviewPrintPage({ route }: { route: TimelineOverviewPrintRoute }) {
  const [data, setData] = useState<OverviewPrintData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const api = window.ostlerAPI
        const [projects, areas, overview] = await Promise.all([
          unwrap(api.getProjects()),
          api.getAreas().then((result) => (result.ok ? result.value : [])),
          unwrap(api.getTimelineOverview())
        ])
        const chosen = route.projectIds ? new Set(route.projectIds) : null
        setData({
          projects: projects.filter(
            (project) => project.enabled && (!chosen || chosen.has(project.id))
          ),
          areas,
          overview: new Map(overview.map((entry) => [entry.projectId, entry]))
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        markReady('error')
      }
    })()
  }, [route])

  useEffect(() => {
    if (!data) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [data])

  if (error) return <p role="alert">{error}</p>
  if (!data) return null

  const today = todayIsoDate()
  const dates = [today]
  for (const project of data.projects) {
    const entry = data.overview.get(project.id)
    if (!entry) continue
    if (entry.firstDate) dates.push(entry.firstDate)
    if (entry.lastDate) dates.push(entry.lastDate)
    for (const milestone of entry.milestones) dates.push(milestone.targetDate)
  }
  const first = dates.reduce((min, date) => (date < min ? date : min))
  const last = dates.reduce((max, date) => (date > max ? date : max))
  const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
  const total = Math.max(1, dayOf(last) - dayOf(first) + 1)
  const percent = (iso: string) => ((dayOf(iso) - dayOf(first)) / total) * 100
  const groups = groupProjectsByArea(data.projects, data.areas).filter(
    (group) => group.projects.length > 0
  )

  return (
    <div className="print-page">
      <header className="print-page__header">
        <h1>{t('views:timelineOverview.title')}</h1>
        <p>{t('views:timelineOverview.printedAt', { date: formatDateTime(Date.now()) })}</p>
      </header>
      <p className="print-page__range">{t('views:printPage.to', { first, last })}</p>
      <table className="print-table print-timeline">
        <thead>
          <tr>
            <th scope="col">{t('views:timelineOverview.projectHeader')}</th>
            <th scope="col">{t('views:printPage.dates')}</th>
            <th scope="col" className="print-timeline__track-head">
              {t('views:printPage.schedule')}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((group) => [
            ...(data.areas.length > 0
              ? [
                  <tr key={`area:${group.area?.id ?? 'none'}`} className="print-table__group">
                    <th colSpan={3} scope="rowgroup">
                      {group.area ? group.area.name : t('views:timelineOverview.noArea')}
                    </th>
                  </tr>
                ]
              : []),
            ...group.projects.flatMap((project) => {
              const entry = data.overview.get(project.id)
              const span = entry?.firstDate && entry.lastDate ? entry : null
              return [
                <tr key={project.id} className="print-table__group">
                  <th scope="row">{project.name}</th>
                  <td className="print-timeline__dates">
                    {span
                      ? span.firstDate === span.lastDate
                        ? span.firstDate
                        : `${span.firstDate} – ${span.lastDate}`
                      : entry && entry.milestones.length > 0
                        ? ''
                        : t('views:timelineOverview.noDatesYet')}
                  </td>
                  <td className="print-timeline__track">
                    {span && (
                      <span
                        className="print-timeline__bar"
                        style={{
                          insetInlineStart: `${percent(span.firstDate!)}%`,
                          width: `max(var(--space-100), ${((dayOf(span.lastDate!) - dayOf(span.firstDate!) + 1) / total) * 100}%)`
                        }}
                      />
                    )}
                  </td>
                </tr>,
                ...(entry?.milestones ?? []).map((milestone) => (
                  <tr key={milestone.id}>
                    <td className="print-timeline__milestone">{milestone.name}</td>
                    <td className="print-timeline__dates">{milestone.targetDate}</td>
                    <td className="print-timeline__track">
                      <span
                        className="print-timeline__bar is-milestone"
                        style={{
                          insetInlineStart: `${percent(milestone.targetDate)}%`,
                          width: 'var(--space-100)'
                        }}
                      />
                    </td>
                  </tr>
                ))
              ]
            })
          ])}
        </tbody>
      </table>
    </div>
  )
}
