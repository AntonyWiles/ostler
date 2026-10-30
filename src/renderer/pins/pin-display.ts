import type { PinKind, PinView } from '@shared/ostler-api'
import { PROJECT_VIEWS } from '../navigation/registry'
import {
  File,
  FileText,
  Layers,
  Link2,
  ListChecks,
  Milestone,
  Presentation,
  Scale,
  Target,
  type LucideIcon
} from '../ui/icons'
import { t } from '@shared/i18n'

const KIND_ICONS: Record<Exclude<PinKind, 'project-view' | 'library'>, LucideIcon> = {
  task: ListChecks,
  milestone: Milestone,
  decision: Scale,
  'saved-view': Layers,
  'personal-goal': Target
}

/**
 * Whether a pin shows: its project is one on screen, or it belongs to no
 * project (a goal of one's own, N5.6b). A disabled project's pins are left
 * out, as its project is.
 */
export function pinShown(
  pin: Pick<PinView, 'kind' | 'projectId'>,
  projectIds: { has(id: string): boolean }
): boolean {
  return pin.kind === 'personal-goal' || projectIds.has(pin.projectId)
}

function projectView(id: string) {
  return PROJECT_VIEWS.find((view) => view.id === id) ?? null
}

/** Whether the pin's target is still there: a project view must still be one the app has. */
export function pinExists(pin: PinView): boolean {
  if (!pin.exists) return false
  return pin.kind !== 'project-view' || projectView(pin.targetId) !== null
}

/** The pin's title as it shows: the target's current title, a view's name, or "Gone". */
export function pinTitle(pin: PinView): string {
  if (!pinExists(pin)) return t('common:pins.gone')
  if (pin.kind === 'project-view') return projectView(pin.targetId)!.label
  return pin.title ?? t('common:pins.gone')
}

/** The kind's icon; a Library item's says whether it is a link, a file, a whiteboard or a text. */
export function pinIcon(pin: Pick<PinView, 'kind' | 'targetId' | 'libraryKind'>): LucideIcon {
  if (pin.kind === 'project-view') return projectView(pin.targetId)?.icon ?? Layers
  if (pin.kind === 'library') {
    if (pin.libraryKind === 'link') return Link2
    if (pin.libraryKind === 'document' || pin.libraryKind === 'image') return File
    // The Plan's Whiteboards entry uses the same icon.
    if (pin.libraryKind === 'whiteboard') return Presentation
    return FileText
  }
  return KIND_ICONS[pin.kind]
}

export function pinKindLabel(kind: PinKind): string {
  return t(`common:pins.kinds.${kind}`)
}
