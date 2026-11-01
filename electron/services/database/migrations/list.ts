import type { Migration } from './types'
import { baseline } from './0001-baseline'
import { dropUnusedTables } from './0002-drop-unused-tables'
import { taskEssentials } from './0003-task-essentials'
import { commentsAndActivity } from './0004-comments-and-activity'
import { homeInboxReminders } from './0005-home-inbox-reminders'
import { searchAndSavedViews } from './0006-search-and-saved-views'
import { dropBoardPresets } from './0007-drop-board-presets'
import { importBatches } from './0008-import-batches'
import { performanceIndexes } from './0009-performance-indexes'
import { manualOrder } from './0010-manual-order'
import { customFields } from './0011-custom-fields'
import { timeEntries } from './0012-time-entries'
import { boardColumns } from './0013-board-columns'
import { peopleCapacity } from './0014-people-capacity'
import { agentRuns } from './0015-agent-runs'
import { githubLinks } from './0016-github-links'
import { iterations } from './0017-iterations'
import { rules } from './0018-rules'
import { wontDo } from './0019-wont-do'
import { showFromAndSomeday } from './0020-show-from-and-someday'
import { taskTemplates } from './0021-task-templates'
import { myDay } from './0022-my-day'
import { weeklyReviews } from './0023-weekly-reviews'
import { keepReminding } from './0024-keep-reminding'
import { checklistDetails } from './0025-checklist-details'
import { taskLinks } from './0026-task-links'
import { descriptionVersions } from './0027-description-versions'
import { takeTurns } from './0028-take-turns'
import { taskTypes } from './0029-task-types'
import { daysOff } from './0030-days-off'
import { outsideCalendars } from './0031-outside-calendars'
import { timeBlocks } from './0032-time-blocks'
import { itemLinks } from './0033-item-links'
import { pins } from './0034-pins'
import { statusUpdates } from './0035-status-updates'
import { goalMeasures } from './0036-goal-measures'
import { milestoneRounds } from './0037-milestone-rounds'
import { budgetsAndCosts } from './0038-budgets-and-costs'
import { billableTime } from './0039-billable-time'
import { contacts } from './0040-contacts'
import { planFirst } from './0041-plan-first'
import { taskNumbers } from './0042-task-numbers'
import { commitLinks } from './0043-commit-links'
import { ideaScores } from './0044-idea-scores'
import { triage } from './0045-triage'
import { taskTypeFields } from './0046-task-type-fields'
import { calendarLinks } from './0047-calendar-links'
import { milestoneCompletedAt } from './0048-milestone-completed-at'
import { pinCountdowns } from './0049-pin-countdowns'
import { personalGoals } from './0050-personal-goals'
import { shoppingList } from './0051-shopping-list'
import { dependencyTypes } from './0052-dependency-types'
import { baselines } from './0053-baselines'
import { aiFields } from './0054-ai-fields'
import { playbooks } from './0055-playbooks'
import { scheduledAgentTasks } from './0056-scheduled-agent-tasks'
import { ostlerNames } from './0057-ostler-names'
import { changeHistory } from './0058-change-history'
import { sync } from './0059-sync'
import { syncKeys } from './0060-sync-keys'
import { syncRecords } from './0061-sync-records'
import { syncKeyRotation } from './0062-sync-key-rotation'
import { connectedAccounts } from './0063-connected-accounts'
import { accountCalendars } from './0064-account-calendars'
import { projectWebhooks } from './0065-project-webhooks'
import { timeBlockEvents } from './0066-time-block-events'
import { taskListItems } from './0067-task-list-items'
import { syncServer } from './0068-sync-server'
import { personKeys } from './0069-person-keys'
import { memberMe } from './0070-member-me'
import { personLinkAnswers } from './0071-person-link-answers'
import { pendingActor } from './0072-pending-actor'
import { roles } from './0073-roles'
import { myRole } from './0074-my-role'
import { personalShare } from './0075-personal-share'
import { settingsFollowYou } from './0076-settings-follow-you'
import { everyProjectOnEveryDevice } from './0077-every-project-on-every-device'
import { projectPeople } from './0078-project-people'
import { memberLeft } from './0079-member-left'
import { whiteboards } from './0080-whiteboards'
import { commentPins } from './0081-comment-pins'
import { customColumns } from './0082-custom-columns'
import { subprojects } from './0083-subprojects'
import { roleFileSigner } from './0084-role-file-signer'
import { memberCapabilities } from './0085-member-capabilities'
import { contributorRole } from './0086-contributor-role'
import { invitesReset } from './0087-invites-reset'
import { sharedAway } from './0088-shared-away'
import { teams } from './0089-teams'
import { taskFollows } from './0090-task-follows'
import { signOffs } from './0091-sign-offs'
import { blockedReasonOwnerOnly } from './0092-blocked-reason-owner-only'

/*
 * The list of migrations on its own, importing nothing from Node, so the phone app can load it
 * (the runner and backups in index.ts use fs and path). Append only; never edit a shipped one.
 */

/** Every schema change, in order. Append only; never edit one that has shipped. */
export const MIGRATIONS: readonly Migration[] = [
  baseline,
  dropUnusedTables,
  taskEssentials,
  commentsAndActivity,
  homeInboxReminders,
  searchAndSavedViews,
  dropBoardPresets,
  importBatches,
  performanceIndexes,
  manualOrder,
  customFields,
  timeEntries,
  boardColumns,
  peopleCapacity,
  agentRuns,
  githubLinks,
  iterations,
  rules,
  wontDo,
  showFromAndSomeday,
  taskTemplates,
  myDay,
  weeklyReviews,
  keepReminding,
  checklistDetails,
  taskLinks,
  descriptionVersions,
  takeTurns,
  taskTypes,
  daysOff,
  outsideCalendars,
  timeBlocks,
  itemLinks,
  pins,
  statusUpdates,
  goalMeasures,
  milestoneRounds,
  budgetsAndCosts,
  billableTime,
  contacts,
  planFirst,
  taskNumbers,
  commitLinks,
  ideaScores,
  triage,
  taskTypeFields,
  calendarLinks,
  milestoneCompletedAt,
  pinCountdowns,
  personalGoals,
  shoppingList,
  dependencyTypes,
  baselines,
  aiFields,
  playbooks,
  scheduledAgentTasks,
  ostlerNames,
  changeHistory,
  sync,
  syncKeys,
  syncRecords,
  syncKeyRotation,
  connectedAccounts,
  accountCalendars,
  projectWebhooks,
  timeBlockEvents,
  taskListItems,
  syncServer,
  personKeys,
  memberMe,
  personLinkAnswers,
  pendingActor,
  roles,
  myRole,
  personalShare,
  settingsFollowYou,
  everyProjectOnEveryDevice,
  projectPeople,
  memberLeft,
  whiteboards,
  commentPins,
  customColumns,
  subprojects,
  roleFileSigner,
  memberCapabilities,
  contributorRole,
  invitesReset,
  sharedAway,
  teams,
  taskFollows,
  signOffs,
  blockedReasonOwnerOnly
]

/** The schema version this build writes. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
