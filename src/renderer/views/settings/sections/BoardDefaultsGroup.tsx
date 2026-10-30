import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SavedView } from '@shared/ostler-api'
import { formatList } from '@shared/format'
import { boardLayoutPath } from '../../../navigation/paths'
import { readLastProject } from '../../../navigation/last-view'
import { unwrapResult } from '../../../utils/unwrap-result'
import { Button, IconButton, useConfirm, useToast } from '../../../ui'
import { Columns3Cog, Pencil, RotateCcw, Trash2 } from '../../../ui/icons'
import { SavedViewNameDialog } from '../../planning/ViewsMenu'
import { SettingsGroup, useSettings } from '../settings-form'
import '../../planning/board-layout/BoardLayoutEditor.css'
import { t } from '@shared/i18n'

/**
 * Settings › Projects › Board for all projects: the Board's default for every
 * project that keeps none of its own, and the views offered in every project.
 * The same saved views Customise board shows under "All projects"; it is
 * changed there, on a project's Board, and here they can be reset, renamed
 * and deleted, with a link back to Customise board.
 */
export function BoardDefaultsGroup() {
  const { config, markSaved, setError } = useSettings()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { toastUndo } = useToast()
  const projects = config.projects.filter((project) => project.enabled)
  const [hasDefault, setHasDefault] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])
  const [renaming, setRenaming] = useState<SavedView | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.ostlerAPI.getDefaultSavedView(null, 'board').then(unwrapResult),
      window.ostlerAPI.listSharedSavedViews('board').then(unwrapResult)
    ])
      .then(([defaultView, shared]) => {
        if (cancelled) return
        setHasDefault(defaultView !== null)
        setViews(shared)
      })
      .catch((error: unknown) => console.error('Could not read the board views:', error))
    return () => {
      cancelled = true
    }
  }, [])

  const act = async (action: () => Promise<void>) => {
    try {
      await action()
      markSaved()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  const resetDefault = async () => {
    const ok = await confirm({
      title: t('tasks:boardLayout.resetAllTitle'),
      body: t('tasks:boardLayout.resetAllMessage'),
      confirmLabel: t('tasks:boardLayout.reset')
    })
    if (!ok) return
    await act(async () => {
      unwrapResult(await window.ostlerAPI.clearDefaultSavedView(null, 'board'))
      setHasDefault(false)
    })
  }

  const remove = (view: SavedView) =>
    act(async () => {
      const deleted = unwrapResult(await window.ostlerAPI.deleteSavedView(view.id))
      setViews((current) => current.filter((candidate) => candidate.id !== view.id))
      toastUndo(t('tasks:useTaskFilters.deletedView', { deletedName: deleted.name }), async () => {
        const restored = unwrapResult(await window.ostlerAPI.restoreSavedView(deleted))
        setViews((current) => [...current, restored].sort((a, b) => a.position - b.position))
      })
    })

  const lastProject = readLastProject()
  const project = projects.find((candidate) => candidate.id === lastProject) ?? projects[0]

  return (
    <SettingsGroup
      id="board-all-projects"
      description={t('settings:boardDefaults.description')}
      fold={{
        summary: formatList(
          [
            hasDefault ? t('tasks:boardLayout.customised') : t('tasks:boardLayout.standard'),
            t('settings:boardDefaults.viewCount', { count: views.length })
          ],
          'unit'
        )
      }}
    >
      <div className="ostler-board-defaults__row">
        <span>
          <strong>{t('tasks:boardLayout.allProjectsDefault')}</strong>{' '}
          {hasDefault ? t('tasks:boardLayout.customised') : t('tasks:boardLayout.standard')}
        </span>
        {hasDefault && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void resetDefault()}>
            {t('tasks:boardLayout.resetToStandard')}
          </Button>
        )}
      </div>

      {views.length > 0 ? (
        <ul className="ostler-board-defaults__views" aria-label={t('settings:boardDefaults.views')}>
          {views.map((view) => (
            <li key={view.id} className="ostler-board-defaults__row">
              <span>{view.name}</span>
              <span>
                <IconButton
                  size="sm"
                  icon={Pencil}
                  label={t('tasks:boardLayout.renameView', { name: view.name })}
                  onClick={() => setRenaming(view)}
                />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  variant="danger"
                  label={t('tasks:boardLayout.deleteView', { name: view.name })}
                  onClick={() => void remove(view)}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ostler-board-defaults__hint">{t('tasks:boardLayout.noSharedViews')}</p>
      )}

      {project && (
        <div>
          <Button
            variant="secondary"
            icon={Columns3Cog}
            onClick={() => navigate(boardLayoutPath(project.id))}
          >
            {t('settings:boardDefaults.customiseIn', { projectName: project.name })}
          </Button>
        </div>
      )}

      <SavedViewNameDialog
        mode={renaming ? 'rename' : null}
        initialName={renaming?.name ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return
          const renamed = unwrapResult(
            await window.ostlerAPI.updateSavedView(renaming.id, { name })
          )
          setViews((current) =>
            current.map((candidate) => (candidate.id === renamed.id ? renamed : candidate))
          )
          markSaved()
        }}
      />
    </SettingsGroup>
  )
}
