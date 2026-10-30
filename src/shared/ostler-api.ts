/**
 * Ostler — IPC Contract
 *
 * This file is the SINGLE SOURCE OF TRUTH for all communication between the
 * Electron main process and the sandboxed renderer. Both sides import these types.
 *
 * Rules:
 * - Every IPC method returns Result<T> — never raw exceptions across the bridge.
 * - Event subscriptions return an unsubscribe function.
 * - The renderer has NO direct Node.js or filesystem access.
 */

export * from './ostler-api/common-types'
export * from './ostler-api/project-types'
export * from './ostler-api/harness-types'
export * from './ostler-api/history-types'
export * from './ostler-api/change-history-types'
export * from './ostler-api/planning-types'
export * from './ostler-api/field-types'
export * from './ostler-api/time-types'
export * from './ostler-api/focus-types'
export * from './ostler-api/progress-types'
export * from './ostler-api/people-types'
export * from './ostler-api/days-off-types'
export * from './ostler-api/calendar-types'
export * from './ostler-api/time-block-types'
export * from './ostler-api/home-types'
export * from './ostler-api/team-types'
export * from './ostler-api/sign-off-types'
export * from './ostler-api/briefing-types'
export * from './ostler-api/search-types'
export * from './ostler-api/item-link-types'
export * from './ostler-api/pin-types'
export * from './status-updates'
export * from './goal-measures'
export * from './personal-goals'
export * from './contacts'
export * from './ostler-api/ask-types'
export * from './ostler-api/activity-types'
export * from './ostler-api/ai-types'
export * from './ostler-api/config-types'
export * from './ostler-api/appearance-types'
export * from './ostler-api/locale-types'
export * from './ostler-api/desktop-types'
export * from './ostler-api/update-types'
export * from './ostler-api/library-types'
export * from './ostler-api/whiteboard-types'
export * from './ostler-api/backup-types'
export * from './ostler-api/sharing-types'
export * from './ostler-api/personal-space-types'
export * from './ostler-api/account-types'
export * from './ostler-api/webhook-types'
export * from './ostler-api/policy-types'
export * from './ostler-api/template-types'
export * from './ostler-api/import-types'
export * from './ostler-api/github-types'
export * from './ostler-api/report-types'
export * from './ostler-api/rule-types'
export * from './ostler-api/task-template-types'
export * from './ostler-api/task-type-types'
export * from './ostler-api/ipc-types'
export * from './ostler-ai-prompts'
export * from './chat-proposals'
