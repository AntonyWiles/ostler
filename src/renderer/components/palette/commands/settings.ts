import { t } from '@shared/i18n'
import { Settings } from '../../../ui/icons'
import { viewContext } from '../../../navigation/features'
import { paletteSettingsGroups, settingsSections } from '../../../navigation/registry'
import { settingsPath } from '../../../navigation/paths'
import { openSettingsGroup } from '../../../views/settings/settings-form'
import type { Command, PaletteContext } from './types'

/** Each settings section, each group inside one, and (in development) the UI gallery. */
export function buildSettingsCommands(ctx: PaletteContext): Command[] {
  const group = t('navigation:commandPalette.settings')
  const globalCtx = viewContext(ctx.features, null)
  const list: Command[] = []
  const sections = settingsSections(globalCtx)
  for (const section of sections) {
    list.push({
      id: `settings:${section.id}`,
      group,
      label: t('navigation:commandPalette.settings2', { sectionLabel: section.label }),
      icon: Settings,
      keywords: section.keywords,
      run: ctx.go(settingsPath(section.id))
    })
  }

  // A group inside a section ("Connections › Email server"), from the same
  // list the group's own heading comes from.
  for (const entry of paletteSettingsGroups(globalCtx)) {
    const sectionLabel = sections.find((candidate) => candidate.id === entry.section)?.label ?? ''
    list.push({
      id: `settings-group:${entry.id}`,
      group,
      label: t('navigation:commandPalette.settingsGroup', {
        sectionLabel,
        groupLabel: entry.label
      }),
      icon: Settings,
      keywords: entry.keywords,
      run: () => {
        openSettingsGroup(entry.id)
        ctx.navigate(settingsPath(entry.section))
        ctx.close()
      }
    })
  }

  // Development builds only: the route does not exist in production.
  if (import.meta.env.DEV) {
    list.push({
      id: 'dev:ui',
      group: t('navigation:commandPalette.developer'),
      label: t('navigation:commandPalette.developerUiGallery'),
      icon: Settings,
      run: ctx.go('/dev/ui')
    })
  }
  return list
}
