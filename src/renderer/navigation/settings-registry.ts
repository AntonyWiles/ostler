import { keywordList, t } from '@shared/i18n'
import { BRAND } from '@shared/brand'
import { Settings } from '../ui/icons'
import type { ViewContext, ViewDefinition } from './registry'

/**
 * The settings half of the one registry (`registry.ts` re-exports all of it):
 * the settings sections and the groups inside them. Only types come from
 * `registry.ts`, so the two modules never load each other.
 */

const always = () => true

/**
 * Settings sections. SettingsView
 * renders each section's content; this list decides which exist and in what
 * order. A section with a `parent` sits under it in the settings menu, which
 * folds open to show it.
 */
export const SETTINGS_SECTIONS = [
  section('general', 10),
  section('projects', 20),
  section('people', 30),
  section('notifications', 40),
  section('ai', 50),
  section('agents', 60),
  section('connections', 65),
  section('devices', 66),
  section('data', 70),
  section('advanced', 80),
  section('git', 81, { parent: 'advanced' }),
  section('about', 90)
] as const

function section<Id extends string, Parent extends string | null = null>(
  id: Id,
  order: number,
  options: { parent?: Parent; isAvailable?: (ctx: ViewContext) => boolean } = {}
) {
  return {
    id,
    parent: (options.parent ?? null) as Parent,
    scope: 'global',
    get label() {
      return t(`navigation:settings.${id}.label`)
    },
    icon: Settings,
    order,
    placement: 'tab',
    get keywords() {
      return keywordList(`navigation:settings.${id}.keywords`)
    },
    isAvailable: options.isAvailable ?? always
  } as const satisfies ViewDefinition & { parent: string | null }
}

/**
 * What the palette needs to find a settings group (a titled block of rows
 * inside a section) and what the group needs to name itself.
 */
export interface SettingsGroupDefinition {
  /** Stable: the folding group's remembered-open key, and the palette's deep link. */
  id: string
  section: SettingsSectionId
  /** The group's heading. */
  label: string
  /** Extra words the command palette matches. */
  keywords: string[]
  /** False: the palette does not offer it (a state of another group, or the section's only group). */
  palette: boolean
  isAvailable(ctx: ViewContext): boolean
}

/**
 * Settings groups: the one list of what is inside each section. A
 * `SettingsGroup` takes its heading from here by `id`, and the command palette
 * lists a group as "Section › Group", so the two cannot drift apart. A group
 * the palette should skip, because the section's own entry already finds it,
 * says `palette: false`.
 */
export const SETTINGS_GROUPS = [
  // General
  group('appearance', 'general', {
    label: () => t('settings:general.appearance'),
    keywords: () => keywordList('navigation:settings.groups.appearance.keywords')
  }),
  group('start-up', 'general', {
    label: () => t('settings:general.startUp'),
    keywords: () => keywordList('navigation:settings.groups.startUp.keywords')
  }),
  group('language', 'general', {
    label: () => t('settings:general.language.title'),
    keywords: () => keywordList('navigation:settings.groups.language.keywords')
  }),
  group('working-hours', 'general', {
    label: () => t('settings:general.workingHours.title'),
    keywords: () => keywordList('navigation:settings.groups.workingHours.keywords')
  }),
  group('windows', 'general', {
    label: () => t('settings:general.windows'),
    keywords: () => keywordList('navigation:settings.groups.windows.keywords')
  }),
  group('calendars', 'general', {
    label: () => t('settings:calendars.title'),
    keywords: () => keywordList('navigation:settings.groups.calendars.keywords')
  }),
  group('tips', 'general', { label: () => t('settings:general.tips.title') }),
  group('progress', 'general', {
    label: () => t('settings:general.progress.title'),
    keywords: () => keywordList('navigation:settings.groups.progress.keywords')
  }),
  // Projects
  group('projects', 'projects', {
    label: () => t('settings:projectsSection.projects'),
    palette: false
  }),
  group('areas', 'projects', { label: () => t('projects:areas.areas') }),
  group('project-templates', 'projects', { label: () => t('settings:templatesGroup.templates') }),
  group('task-templates', 'projects', { label: () => t('settings:taskTemplatesGroup.title') }),
  group('board-all-projects', 'projects', {
    label: () => t('settings:boardDefaults.title'),
    keywords: () => keywordList('navigation:settings.groups.boardAllProjects.keywords')
  }),
  // People
  group('people', 'people', {
    label: () => t('settings:peopleSection.peopleAssignWork'),
    palette: false
  }),
  group('days-off', 'people', { label: () => t('settings:daysOff.title') }),
  group('teams', 'people', { label: () => t('settings:teams.title') }),
  // Notifications
  group('in-app-notifications', 'notifications', {
    label: () => t('settings:notificationsSection.inApp')
  }),
  group('focus-notifications', 'notifications', {
    label: () => t('settings:notificationsSection.focus')
  }),
  group('reminders', 'notifications', {
    label: () => t('settings:notificationsSection.reminders'),
    keywords: () => keywordList('navigation:settings.groups.reminders.keywords')
  }),
  group('desktop-notifications', 'notifications', {
    label: () => t('settings:notificationsSection.desktopNotifications'),
    keywords: () => keywordList('navigation:settings.groups.desktopNotifications.keywords')
  }),
  // AI
  group('ai-not-set-up', 'ai', { label: () => t('ai:aiSection.isntSetUp'), palette: false }),
  group('ai-set-up', 'ai', { label: () => t('ai:aiSection.setUp'), isAvailable: (ctx) => ctx.ai }),
  group('ai-chat', 'ai', { label: () => t('ai:aiSection.chat'), isAvailable: (ctx) => ctx.ai }),
  group('ai-privacy', 'ai', {
    label: () => t('ai:aiSection.privacy'),
    keywords: () => keywordList('navigation:settings.groups.aiPrivacy.keywords'),
    isAvailable: (ctx) => ctx.ai
  }),
  group('ai-response', 'ai', {
    label: () => t('ai:aiSection.response'),
    isAvailable: (ctx) => ctx.ai
  }),
  // Agents
  group('ai-agents', 'agents', { label: () => t('agents:agentsSection.aiAgents'), palette: false }),
  group('built-in-agent', 'agents', {
    label: () => t('agents:agentsSection.builtAgent'),
    keywords: () => keywordList('navigation:settings.groups.builtInAgent.keywords'),
    isAvailable: (ctx) => ctx.agents
  }),
  group('usage-prices', 'agents', {
    label: () => t('agents:usagePrices.usage'),
    keywords: () => keywordList('navigation:settings.groups.usagePrices.keywords'),
    isAvailable: (ctx) => ctx.agents
  }),
  group('agent-monitoring', 'agents', {
    label: () => t('agents:agentsSection.monitoring'),
    isAvailable: (ctx) => ctx.agents
  }),
  group('agent-api', 'agents', {
    label: () => t('agents:agentsSection.agentApi'),
    isAvailable: (ctx) => ctx.agents
  }),
  group('agent-projects', 'agents', {
    label: () => t('agents:agentsSection.projects'),
    isAvailable: (ctx) => ctx.agents
  }),
  // Connections
  group('accounts', 'connections', {
    label: () => t('settings:accounts.title'),
    keywords: () => keywordList('navigation:settings.groups.accounts.keywords')
  }),
  group('sync-server', 'connections', {
    label: () => t('settings:syncServer.title'),
    keywords: () => keywordList('navigation:settings.groups.syncServer.keywords')
  }),
  group('email-server', 'connections', {
    label: () => t('settings:email.title'),
    keywords: () => keywordList('navigation:settings.groups.emailServer.keywords')
  }),
  group('automation-api', 'connections', {
    label: () => t('settings:connectionsSection.automationApi'),
    keywords: () => keywordList('navigation:settings.groups.automationApi.keywords')
  }),
  group('automation-projects', 'connections', {
    label: () => t('settings:connectionsSection.projects'),
    palette: false
  }),
  group('github-token', 'connections', {
    label: () => t('settings:githubToken.title'),
    keywords: () => keywordList('navigation:settings.groups.githubToken.keywords')
  }),
  // Devices
  group('your-pcs', 'devices', {
    label: () => t('settings:devicesSection.yourPcs'),
    palette: false
  }),
  // Data
  group('storage', 'data', {
    label: () => t('settings:dataSection.storage'),
    keywords: () => keywordList('navigation:settings.groups.storage.keywords')
  }),
  group('agent-copies', 'data', {
    label: () => t('settings:dataSection.agentCopiesAndHistory'),
    keywords: () => keywordList('navigation:settings.groups.agentCopies.keywords'),
    isAvailable: (ctx) => ctx.agents
  }),
  group('import', 'data', {
    label: () => t('settings:importGroup.import'),
    keywords: () => keywordList('navigation:settings.groups.import.keywords')
  }),
  group('backups', 'data', {
    label: () => t('settings:backupsSection.backups'),
    keywords: () => keywordList('navigation:settings.groups.backups.keywords')
  }),
  // Advanced
  group('file-activity', 'advanced', { label: () => t('settings:advancedSection.fileActivity') }),
  group('file-activity-settings', 'advanced', {
    label: () => t('settings:advancedSection.fileActivitySettings')
  }),
  group('advanced-ai', 'advanced', {
    label: () => t('settings:advancedSection.ostlerAi'),
    isAvailable: (ctx) => ctx.ai
  }),
  group('version-history', 'advanced', {
    label: () => t('settings:advancedSection.versionHistory'),
    keywords: () => keywordList('navigation:settings.groups.versionHistory.keywords'),
    isAvailable: (ctx) => ctx.agents
  }),
  group('developer', 'advanced', {
    label: () => t('settings:advancedSection.developer'),
    keywords: () => keywordList('navigation:settings.groups.developer.keywords')
  }),
  // Git
  group('git', 'git', { label: () => t('settings:advancedSection.git'), palette: false }),
  // About
  group('about-ostler', 'about', { label: () => BRAND.fullName, palette: false }),
  group('updates', 'about', {
    label: () => t('settings:aboutSection.updates'),
    keywords: () => keywordList('navigation:settings.groups.updates.keywords')
  }),
  group('licences', 'about', {
    label: () => t('settings:aboutSection.openSourceLicences'),
    keywords: () => keywordList('navigation:settings.groups.licences.keywords')
  }),
  group('diagnostics', 'about', {
    label: () => t('settings:aboutSection.diagnostics'),
    keywords: () => keywordList('navigation:settings.groups.diagnostics.keywords')
  })
] as const satisfies readonly SettingsGroupDefinition[]

function group<Id extends string, Section extends SettingsSectionId>(
  id: Id,
  section: Section,
  options: {
    label: () => string
    keywords?: () => string[]
    palette?: boolean
    isAvailable?: (ctx: ViewContext) => boolean
  }
) {
  return {
    id,
    section,
    get label() {
      return options.label()
    },
    get keywords() {
      return options.keywords?.() ?? []
    },
    palette: options.palette ?? true,
    isAvailable: options.isAvailable ?? always
  }
}

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id']

/** A group's heading, from the one list: what `SettingsGroup` shows for its `id`. */
export function settingsGroupLabel(id: SettingsGroupId): string {
  return SETTINGS_GROUPS.find((entry) => entry.id === id)!.label
}

/**
 * The groups the command palette offers in `ctx`: those on an available
 * section, available themselves, and not marked `palette: false`.
 */
export function paletteSettingsGroups(ctx: ViewContext): (typeof SETTINGS_GROUPS)[number][] {
  const sections = new Set<string>(settingsSections(ctx).map((entry) => entry.id))
  return SETTINGS_GROUPS.filter(
    (entry) => entry.palette && sections.has(entry.section) && entry.isAvailable(ctx)
  )
}

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/** Where Settings opens when no section is asked for. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general'

/** The settings sections available in `ctx`, in order. */
export function settingsSections(ctx: ViewContext): (typeof SETTINGS_SECTIONS)[number][] {
  return [...SETTINGS_SECTIONS]
    .sort((a, b) => a.order - b.order)
    .filter((entry) => entry.isAvailable(ctx))
}

export type SettingsSectionDefinition = (typeof SETTINGS_SECTIONS)[number]

/** The sections under `parent` in the settings menu, from a list `settingsSections` gave. */
export function settingsSubsections(
  sections: readonly SettingsSectionDefinition[],
  parent: SettingsSectionId
): SettingsSectionDefinition[] {
  return sections.filter((entry) => entry.parent === parent)
}

export function isSettingsSectionId(id: string | null | undefined): id is SettingsSectionId {
  return SETTINGS_SECTIONS.some((entry) => entry.id === id)
}
