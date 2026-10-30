import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectPath } from '../../navigation/paths'
import type { LibraryItem, PlanningWorkItem, Result, WorkItemSource } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { LibraryAttachPicker } from '../../components/LibraryAttachPicker'
import { KIND_LABEL } from '../project-detail/library/libraryUi'
import { useWorkItemAttachments } from './useWorkItemAttachments'
import { useFeatures } from '../../navigation/features'
import { Badge, Button, Checkbox, IconButton, InlineAlert } from '../../ui'
import { Plus, Sparkles, X } from '../../ui/icons'
import { TaskDrawerSection } from './TaskDrawerSection'
import { t } from '@shared/i18n'

/**
 * The library items a work item was written from, each at the revision it was
 * linked at. A source edited since is flagged, and "Re-draft with AI" runs the
 * existing improve flow with the sources so the task text can catch up.
 */
export function WorkItemSourcesSection({
  ws,
  workItem,
  requestLeave
}: {
  ws: PlanningWorkspace
  workItem: PlanningWorkItem
  /** Closes the drawer (saving what is typed first, and asking if a save failed), then runs `then`. */
  requestLeave: (then: () => void) => Promise<void>
}) {
  const features = useFeatures()
  const navigate = useNavigate()
  const [sources, setSources] = useState<WorkItemSource[]>([])
  const [library, setLibrary] = useState<LibraryItem[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { projectId, id: workItemId } = workItem
  const attachments = useWorkItemAttachments(projectId, workItemId)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listWorkItemSources(projectId, workItemId)
    if (result.ok) setSources(result.value)
  }, [projectId, workItemId])

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

  const openPicker = async () => {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    const result = await window.ostlerAPI.listLibraryItems(projectId, {})
    if (result.ok) setLibrary(result.value)
    setPickerOpen(true)
  }

  const apply = async (call: Promise<Result<WorkItemSource[]>>) => {
    setError(null)
    const result = await call
    if (result.ok) setSources(result.value)
    else setError(result.error)
  }

  const toggle = (item: LibraryItem) =>
    void apply(
      sources.some((source) => source.item.id === item.id)
        ? window.ostlerAPI.removeWorkItemSource(projectId, workItemId, item.id)
        : window.ostlerAPI.addWorkItemSource(projectId, workItemId, item.id)
    )

  const changed = sources.filter((source) => source.changedSince)
  // Only what Ostler AI may read is passed; main re-checks every id anyway.
  const aiSourceIds = sources
    .filter((source) => source.item.aiAccess !== 'human-only' && !source.item.archivedAt)
    .map((source) => source.item.id)

  return (
    <TaskDrawerSection
      title={t('tasks:workItemSourcesSection.sources')}
      description={t('tasks:workItemSourcesSection.libraryItemsTaskWas')}
      part={{ id: 'sources', inUse: sources.length > 0, start: () => void openPicker() }}
      actions={
        <div className="task-drawer__picker-anchor">
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => void openPicker()}>
            {t('tasks:workItemSourcesSection.addSource')}
          </Button>
          {pickerOpen && library && (
            <LibraryAttachPicker
              items={library}
              selectedIds={sources.map((source) => source.item.id)}
              onToggle={toggle}
              onClose={() => setPickerOpen(false)}
              includeHumanOnly
              label={t('tasks:workItemSourcesSection.addSource')}
            />
          )}
        </div>
      }
    >
      {changed.length > 0 && (
        <InlineAlert tone="warning">
          <span role="status">
            {changed.length === 1
              ? t('tasks:workItemSourcesSection.oneSourceChanged', {
                  from: changed[0].revisionAtLink,
                  to: changed[0].currentRevision
                })
              : t('tasks:workItemSourcesSection.sourcesChanged', { count: changed.length })}
          </span>
          {features.ai && (
            <Button
              size="sm"
              variant="ai"
              icon={Sparkles}
              className="task-drawer__alert-action"
              loading={ws.aiImproveBusy}
              disabled={aiSourceIds.length === 0}
              disabledReason={
                aiSourceIds.length === 0
                  ? t('tasks:workItemSourcesSection.noneTheseSourcesCan')
                  : undefined
              }
              title={t('tasks:workItemSourcesSection.reDraftTaskCurrent')}
              onClick={() => void ws.improveWorkItem(aiSourceIds)}
            >
              {ws.aiImproveBusy
                ? t('tasks:workItemSourcesSection.reDrafting')
                : t('tasks:workItemSourcesSection.reDraftAi')}
            </Button>
          )}
        </InlineAlert>
      )}
      {sources.length > 0 ? (
        <ul className="task-library-list">
          {sources.map((source) => (
            <li key={source.item.id} className="task-library-list__row">
              <button
                type="button"
                className="task-library-list__open"
                title={t('tasks:workItemSourcesSection.openLibrary')}
                onClick={() =>
                  void requestLeave(() =>
                    navigate(projectPath(projectId, 'library', { item: source.item.id }))
                  )
                }
              >
                <span className="task-library-list__kind">{KIND_LABEL[source.item.kind]}</span>
                <span className="task-library-list__title">{source.item.title}</span>
                <span className="task-library-list__meta">
                  {t('tasks:workItemSourcesSection.r', { revisionAtLink: source.revisionAtLink })}
                </span>
              </button>
              {source.changedSince && (
                <Badge tone="warning">
                  {t('tasks:workItemSourcesSection.rR', {
                    revisionAtLink: source.revisionAtLink,
                    currentRevision: source.currentRevision
                  })}
                </Badge>
              )}
              {source.item.aiAccess === 'human-only' && (
                <Badge tone="warning">{t('tasks:workItemSourcesSection.notReadAi')}</Badge>
              )}
              {features.agents &&
                source.item.aiAccess !== 'human-only' &&
                !source.item.archivedAt && (
                  <Checkbox
                    label={t('tasks:workItemSourcesSection.attachAgent')}
                    className="task-library-list__attach"
                    checked={attachments.isAttached(source.item.id)}
                    onChange={(event) =>
                      void (event.target.checked
                        ? attachments.attach(source.item.id, 'human')
                        : attachments.detach(source.item.id))
                    }
                  />
                )}
              <IconButton
                size="sm"
                icon={X}
                label={t('tasks:workItemSourcesSection.removeSources', {
                  itemTitle: source.item.title
                })}
                onClick={() =>
                  void apply(
                    window.ostlerAPI.removeWorkItemSource(projectId, workItemId, source.item.id)
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="task-drawer__muted">{t('tasks:workItemSourcesSection.noLibrarySources')}</p>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {attachments.error && <InlineAlert tone="danger">{attachments.error}</InlineAlert>}
    </TaskDrawerSection>
  )
}
