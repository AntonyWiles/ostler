import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectPath } from '../../navigation/paths'
import { Markdown } from '../../ui/Markdown'
import type { LibraryAiContextSummary, LibraryItem } from '@shared/ostler-api'
import { LIBRARY_MAX_ALWAYS_IMAGES } from '@shared/ostler-api'
import { useFeatures } from '../../navigation/features'
import { Button, Card, Section, Skeleton } from '../../ui'
import { t } from '@shared/i18n'
import { formatNumber, formatRelativeTime } from '@shared/format'

/** Roughly the first eight lines of the brief: enough to recognise it, not to read it. */
const PREVIEW_LINES = 8

/**
 * The Overview's "Project brief" card: the primary brief from the Library,
 * and one line on what Ostler AI reads from the Library on every request.
 */
export function ProjectBriefCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const features = useFeatures()
  const [brief, setBrief] = useState<LibraryItem | null>(null)
  const [context, setContext] = useState<LibraryAiContextSummary | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [briefs, summary] = await Promise.all([
      window.ostlerAPI.listLibraryItems(projectId, { kind: 'brief' }),
      window.ostlerAPI.getLibraryAiContextSummary(projectId)
    ])
    setBrief(briefs.ok ? (briefs.value.find((item) => item.isPrimaryBrief) ?? null) : null)
    setContext(summary.ok ? summary.value : null)
    setLoaded(true)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.projectId === projectId && update.field === 'library') void load()
      }),
    [projectId, load]
  )

  const openLibrary = (params: { item?: string; new?: string }) =>
    navigate(projectPath(projectId, 'library', params))

  const preview = brief ? brief.body.split('\n').slice(0, PREVIEW_LINES).join('\n') : ''

  return (
    <Section
      title={t('projects:projectBriefCard.projectBrief')}
      actions={
        brief ? (
          <Button size="sm" variant="ghost" onClick={() => openLibrary({ item: brief.id })}>
            {t('projects:projectBriefCard.openLibrary')}
          </Button>
        ) : loaded ? (
          <Button size="sm" variant="ghost" onClick={() => openLibrary({ new: 'brief' })}>
            {t('projects:projectBriefCard.writeBrief')}
          </Button>
        ) : undefined
      }
    >
      {!loaded ? (
        <Skeleton lines={3} />
      ) : brief ? (
        <Card className="overview-brief">
          <h3 className="overview-brief__title">{brief.title}</h3>
          <div className="overview-brief__preview">
            <Markdown projectId={projectId}>{preview}</Markdown>
          </div>
          <p className="overview-muted">
            {t('projects:projectBriefCard.revisionUpdated', {
              revision: brief.revision,
              when: formatRelativeTime(new Date(brief.updatedAt).getTime())
            })}
          </p>
        </Card>
      ) : (
        <Card>
          <p className="overview-quiet">{t('projects:projectBriefCard.noProjectBriefYet')}</p>
        </Card>
      )}
      {context && features.ai && (
        <p className="overview-muted">
          {t(
            context.overBudget
              ? 'projects:projectBriefCard.readsOverBudget'
              : 'projects:projectBriefCard.reads',
            {
              count: context.included.length,
              chars: formatNumber(context.totalChars),
              budget: formatNumber(context.budgetChars),
              images: context.imageCount,
              maxImages: LIBRARY_MAX_ALWAYS_IMAGES
            }
          )}
        </p>
      )}
    </Section>
  )
}
