import { useNavigate } from 'react-router-dom'
import type { PinView } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { goalsPath, itemPath, projectPath } from '../navigation/paths'
import type { ProjectViewId } from '../navigation/registry'
import { useConfirm, useToast } from '../ui'
import { pinExists, pinTitle } from './pin-display'
import { t } from '@shared/i18n'

/**
 * Opens a pin (N5.2a): a task in its drawer, a milestone, decision or Library
 * text in its place, a view as that view. Nothing opens outside Ostler without
 * asking first: a link shows its address before it opens in the browser, and a
 * file asks before it opens in its app.
 */
export function useOpenPin(): (pin: PinView) => Promise<void> {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { toast } = useToast()

  return async (pin) => {
    if (!pinExists(pin)) return
    switch (pin.kind) {
      case 'task':
      case 'milestone':
      case 'decision':
        navigate(itemPath(pin.kind, pin.projectId, pin.targetId))
        return
      case 'saved-view':
        navigate(projectPath(pin.projectId, pin.viewType ?? 'list', { view: pin.targetId }))
        return
      case 'project-view':
        // pinExists checked the id is one of the app's views.
        navigate(projectPath(pin.projectId, pin.targetId as ProjectViewId))
        return
      case 'personal-goal':
        navigate(goalsPath(pin.targetId))
        return
      case 'library':
        break
    }
    const name = pinTitle(pin)
    const outside =
      pin.libraryKind === 'link'
        ? await confirm({
            title: t('common:pins.openLinkTitle'),
            body: t('common:pins.openLinkBody', { url: pin.url ?? '', name }),
            confirmLabel: t('common:pins.openLinkConfirm')
          })
        : pin.libraryKind === 'document' || pin.libraryKind === 'image'
          ? await confirm({
              title: t('common:pins.openFileTitle', { name }),
              body: t('common:pins.openFileBody', { appName: BRAND.name }),
              confirmLabel: t('common:pins.openFileConfirm')
            })
          : null
    if (outside === null) {
      navigate(itemPath('library', pin.projectId, pin.targetId))
      return
    }
    if (!outside) return
    const result = await window.ostlerAPI.openLibraryItemExternally(pin.projectId, pin.targetId)
    if (!result.ok)
      toast({ title: t('common:pins.couldntOpen'), body: result.error, tone: 'danger' })
  }
}
