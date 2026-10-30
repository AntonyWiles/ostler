import { keywordList, t } from '@shared/i18n'
import { Pin } from '../../../ui/icons'
import { pinExists, pinIcon, pinKindLabel, pinShown, pinTitle } from '../../../pins/pin-display'
import { closing, type Command, type PaletteContext } from './types'

/** Pins first (N5.2a): the sidebar's, then the current project's shortcuts; then "Pin…". */
export function buildPinCommands(ctx: PaletteContext): Command[] {
  const { pins, projects, currentProject } = ctx
  const list: Command[] = []
  const seen = new Set<string>()
  const pinned = [
    ...pins.sidebar,
    ...(currentProject ? pins.overview(currentProject.id) : [])
  ].filter((pin) => {
    const key = `${pin.kind}:${pin.projectId}:${pin.targetId}`
    if (seen.has(key) || !pinExists(pin)) return false
    seen.add(key)
    return pinShown(pin, new Set(projects.map((project) => project.id)))
  })
  for (const pin of pinned) {
    list.push({
      id: `pin:${pin.id}`,
      group: t('common:pins.pinned'),
      label: pinTitle(pin),
      icon: pinIcon(pin),
      hint: projects.find((project) => project.id === pin.projectId)?.name,
      keywords: [pinKindLabel(pin.kind)],
      run: closing(ctx, () => ctx.openPin(pin))
    })
  }
  if (pins.available) {
    list.push({
      id: 'pin:pick',
      group: t('navigation:commandPalette.create'),
      label: t('common:pins.palettePin'),
      icon: Pin,
      hint: t('common:pins.palettePinHint'),
      keywords: keywordList('common:pins.paletteKeywords'),
      run: () => ctx.pick('pin')
    })
  }
  return list
}
