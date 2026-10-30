import { buildCreateCommands } from './create'
import { buildCurrentProjectCommands } from './current-project'
import { buildHelpCommands, buildNavigationCommands, buildPrintCommands } from './navigation'
import { buildPinCommands } from './pins'
import { buildProjectCommands, buildSavedViewCommands } from './projects'
import { buildSettingsCommands } from './settings'
import type { Command, PaletteContext } from './types'

export * from './types'
export * from './pickers'

/** Every command the palette offers, in the order it lists them. */
export function buildPaletteCommands(ctx: PaletteContext): Command[] {
  return [
    ...buildPinCommands(ctx),
    ...buildCurrentProjectCommands(ctx),
    ...buildCreateCommands(ctx),
    ...buildPrintCommands(ctx),
    ...buildNavigationCommands(ctx),
    ...buildHelpCommands(ctx),
    ...buildProjectCommands(ctx),
    ...buildSettingsCommands(ctx),
    ...buildSavedViewCommands(ctx)
  ]
}
