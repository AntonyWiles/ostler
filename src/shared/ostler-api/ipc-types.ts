import type { TryRun } from '../try-it'
import type { RequestSignOffInput, SignOff, SignOffItem } from './sign-off-types'
import type {
  PersonalSpaceState,
  R2SetupCodeView,
  R2SyncState,
  SetR2SyncInput,
  SyncPlaceView
} from './personal-space-types'
import type {
  ChangeDetail,
  ChangeHistoryClear,
  ChangeHistoryHead,
  ChangeHistoryPage,
  ChangeHistoryQuery,
  ChangeHistoryStats,
  ChangeUndoResult
} from './change-history-types'
import type {
  CreatePlanningRuleInput,
  PlanningRule,
  PlanningRuleDeletion,
  PlanningRulePreview,
  UpdatePlanningRuleInput
} from './rule-types'
import type {
  SaveTaskTemplateFromWorkItemInput,
  TaskTemplate,
  TaskTemplateDeletion,
  TaskTemplateOverrides,
  TaskTemplateUse,
  PlaybookRun,
  RunPlaybookInput,
  UpdateTaskTemplateInput
} from './task-template-types'
import type {
  CreatePlanningTaskTypeInput,
  PlanningTaskType,
  PlanningTaskTypeDeletion,
  UpdatePlanningTaskTypeInput
} from './task-type-types'
import type {
  BlockMovePlan,
  CreateTimeBlockInput,
  FillDayPlan,
  PlanApplyResult,
  TimeBlock,
  TimeBlocksQuery,
  UpdateTimeBlockInput
} from './time-block-types'
import type { AgentRunChoice } from '../agent-model'
import type { ProjectArea } from '../project-areas'
import type {
  AddTasksFromTextInput,
  TasksFromTextDraft,
  TasksFromTextRequest
} from '../tasks-from-text'
import type { FilterFromWordsRequest, FilterFromWordsResult } from '../filter-from-words'
import type { PolishedReleaseNotes, PolishReleaseNotesRequest } from '../release-notes'
import type { TriageSuggestion } from '../triage-suggestions'
import type {
  AiFieldFillInput,
  AiFieldFillResult,
  AiFieldFillUndo,
  AiFieldSuggestion
} from './field-types'
import type {
  AddNoteActionsInput,
  AddNoteActionsResult,
  NoteActionsDraft,
  NoteActionsRequest
} from '../note-actions'
import type {
  MakeLineTasksInput,
  MakeLineTasksResult,
  UndoLineTasksInput
} from '../note-line-tasks'
import type { CommentSummary, ImprovedWriting, ImproveWritingRequest } from '../writing-help'
import type { RescheduleChange, ReschedulePlan, RescheduleResult } from '../planning/reschedule'
import type { DependentMovePlan, TaskDateMove } from '../planning/move-dependents'
import type {
  FindReplaceChange,
  FindReplaceChoice,
  FindReplacePreview,
  FindReplaceRequest,
  FindReplaceResult
} from '../planning/find-replace'
import type { ResolvedSetup } from '../workspace-setup'
import type { MilestoneRepeatInput, MilestoneRoundPreview } from '../milestone-rounds'
import type { AskOstlerAnswer, AskOstlerOptions, AskOstlerProgress } from './ask-types'
import type {
  AIConnectionDraft,
  AIConnectionTest,
  AIModelEffortSupport,
  AIModelInfo,
  LocalAiDetection,
  ProjectAiSettings,
  AIHaltState,
  AIConversation,
  AIStreamChunk,
  SessionTranscriptEntry
} from './ai-types'
import type {
  CodeCommandOutputEvent,
  CodeDirEntry,
  DatabaseStats,
  ProjectStateUpdate,
  RendererErrorReport,
  Result
} from './common-types'
import type {
  EmailSettingsInput,
  OstlerNotification,
  RendererConfig,
  RendererConfigUpdate
} from './config-types'
import type { BackupCopyStatus, BackupEntry } from './backup-types'
import type {
  JoinShareResult,
  PersonLinkCandidate,
  SetSyncServerInput,
  ShareRole,
  ShareState,
  MembershipEvent,
  SyncServerState
} from './sharing-types'
import type { PolicySummary } from './policy-types'
import type {
  AccountAppInput,
  AccountCapability,
  AccountProvider,
  AccountProviderInfo,
  ConnectAccountInput,
  ConnectedAccount,
  CloudFileRead,
  CalendarWriteTarget,
  SetCalendarWriteTargetInput,
  AccountTaskList,
  TaskListTarget,
  SetTaskListTargetInput
} from './account-types'
import type { AddWebhookInput, ProjectWebhook, UpdateWebhookInput } from './webhook-types'
import type { RestartToUpdateMode, UpdateState } from './update-types'
import type { GettingStarted, GettingStartedActivity } from '../getting-started'
import type { ProjectReport, ReportRange, RoundComparison } from './report-types'
import type { ProjectTemplateSummary, SaveProjectTemplateInput } from './template-types'
import type {
  CsvImportOptions,
  CsvImportPreview,
  ImportBatch,
  ImportFileInfo,
  ImportRequest,
  ImportResult,
  ImportTarget,
  ImportUndoCheck,
  ImportUndoResult,
  PrintRequest,
  MyWeekPrintRequest,
  TimelineOverviewPrintRequest,
  RoundComparisonPrintRequest,
  ProjectExportOptions,
  CalendarExportOptions,
  ShareReportOptions,
  TimelineSlidesExportOptions,
  TaskCsvExportRequest,
  TrelloImportOptions,
  TrelloImportPreview,
  EditInExcelFile,
  BringBackPreview,
  CsvUpdateApplyRequest,
  CsvUpdateResult,
  TaskValuesRestore
} from './import-types'
import type {
  GithubImportPreview,
  GithubIssueQuery,
  GithubLink,
  GithubLinkAdded,
  GithubLinksRefresh
} from './github-types'
import type { ProjectPackage } from '../project-package'
import type { InitialAppearance } from './appearance-types'
import type { HarnessPlan, SessionPlanView, TaskPlanRecord } from './harness-types'
import type { LocaleInfo } from './locale-types'
import type {
  CreateLibraryItemInput,
  ImportLibraryFileInput,
  ImportLibraryResult,
  LibraryAiContextSummary,
  LibraryContextUse,
  LibraryAttachedBy,
  LibraryItem,
  LibraryItemAttachmentLink,
  LibraryItemSourceLink,
  LibraryQuery,
  LibraryRevision,
  LibraryTextProgress,
  UpdateLibraryItemInput,
  WorkItemAttachment,
  WorkItemSource
} from './library-types'
import type {
  CreateWhiteboardInput,
  ExportWhiteboardFileResult,
  MakeWhiteboardTasksInput,
  MakeWhiteboardTasksResult,
  SaveWhiteboardImageInput,
  UndoWhiteboardTasksInput,
  WhiteboardDocument,
  WhiteboardPrintRequest,
  WhiteboardSaveInput,
  WhiteboardSaveResult
} from './whiteboard-types'
import type {
  HarnessApplyResult,
  HarnessProjectState,
  HarnessGuidance,
  HarnessQuestion,
  HarnessReport,
  HarnessSession,
  RendererHarnessSession,
  HarnessTaskRejection,
  HarnessReviewComment,
  HarnessSessionDiff,
  HarnessTask,
  ProjectAutoDispatchConfig,
  AgentRequirements,
  RecentAgentRun,
  AgentRunFilter,
  AgentRunHistory,
  AgentUsageStatus
} from './harness-types'
import type {
  AgentStorageUsage,
  ProjectHistory,
  ProjectHistoryEntry,
  ProjectHistoryFilter,
  ProjectUndoResult
} from './history-types'
import type {
  CreatePersonInput,
  CreateTeamInput,
  DeletePersonOptions,
  Person,
  PersonUsage,
  PlanningLabel,
  PlanningLabelDeletion,
  Team,
  UpdatePersonInput,
  UpdateTeamInput
} from './people-types'
import type {
  CreateDayOffInput,
  DayOff,
  DaysOffFile,
  DaysOffImportInput,
  DaysOffImportPreview,
  DaysOffImportResult,
  DaysOffQuery,
  SharedAwayQuery,
  SharedAwaySpan,
  UpdateDayOffInput
} from './days-off-types'
import type {
  AddCalendarFileInput,
  AddCalendarLinkInput,
  CalendarEventsQuery,
  CalendarOccurrence,
  ChosenCalendarFile,
  OutsideCalendar,
  UpdateCalendarInput,
  AccountCalendarChoice,
  AddAccountCalendarInput
} from './calendar-types'
import type {
  CreatePlanningFieldInput,
  PlanningFieldDefinition,
  PlanningFieldDeletion,
  UpdatePlanningFieldInput
} from './field-types'
import type {
  CreateTimeEntryInput,
  TimeEntry,
  TimeEntryQuery,
  TimerStart,
  TimerState,
  TimeTotals,
  UpdateTimeEntryInput
} from './time-types'
import type { FocusChange, FocusChoice, FocusState } from './focus-types'
import type {
  HomeProgress,
  HomeProgressQuery,
  YearInReview,
  YearInReviewPrintRequest,
  YearInReviewQuery
} from './progress-types'
import type {
  InboxList,
  InboxSnooze,
  MyWork,
  MyDayAddResult,
  MyDayPlacement,
  MyDayTask,
  PlanMyDayCandidates,
  AssignedTask,
  AssignedChecklistItemsQuery,
  HomeChecklistItem,
  AssignedTasksQuery,
  WorkloadTasksQuery,
  TimelineOverviewProject,
  RescheduleQuery,
  NavigateRequest,
  NeedsYouEntry,
  WeeklyReview,
  WeeklyReviewRecord,
  PlanningRecurrence,
  PlanningRecurrenceInput,
  PlanningReminder,
  PlanningReminderOptions
} from './home-types'
import type { TeamOverviewQuery, TeamOverviewRow } from './team-types'
import type { Briefing, BriefingWriteUp } from './briefing-types'
import type { ActivityPage, ActivityQuery, PlanningComment } from './activity-types'
import type { AppCommand, MenuContext, WindowControl, WindowState } from './desktop-types'
import type { SnipOverlayPicture, SnipPreview, SnipSelection } from '../snip'
import type { PictureBytes } from '../markup'
import type {
  AIDecisionApproval,
  AIDecisionDraft,
  AIMasterPlanApproval,
  AILibraryGoalProposal,
  AIMasterPlanDraft,
  AIMilestoneAdvisory,
  AINextTaskApproval,
  AINextTasksDraft,
  AIPlanningDraft,
  AIPlanningSuggestionApproval,
  AIProjectBrief,
  AITaskSplitApproval,
  AITaskSplitDraft,
  TaskSplitJob,
  AIWorkItemImprovement,
  CreatePlanningDecisionInput,
  CreatePlanningGoalInput,
  CreatePlanningMilestoneInput,
  CreatePlanningWorkItemInput,
  PlanningWorkItemBatchRow,
  PlanningWorkItemBatchRowError,
  HarnessTaskPlanningUpdate,
  PlanningBlocker,
  PlanningBlockerWithWorkItem,
  PlanningBulkQueueResult,
  PlanningDecision,
  PlanningAggregateMetrics,
  PlanningStatusTransition,
  PlanningGoal,
  PlanningHarnessHandoff,
  PlanningMilestone,
  PlanningPriority,
  PlanningReadinessReport,
  PlanningWipLimits,
  PlanningColumnSettings,
  UpdatePlanningColumnSettingsInput,
  CreatePlanningIterationInput,
  PlanningIteration,
  PlanningIterationCarryOver,
  PlanningIterationDeletion,
  PlanningIterationFinish,
  UpdatePlanningIterationInput,
  PlanningWorkItem,
  ProjectUsage,
  PlanningChecklistDetailInput,
  PlanningWorkItemMetrics,
  PlanningWorkItemStatus,
  TaskReview,
  TaskStatusReviewDraft,
  UpdatePlanningDecisionInput,
  UpdatePlanningGoalInput,
  UpdatePlanningMilestoneInput,
  UpdatePlanningWorkItemInput,
  PlanningWorkItemPlacement,
  PlanningWorkItemScope,
  TriageAcceptFields,
  TriageList,
  TriageMoveResult,
  WontDoOptions,
  WontDoResult,
  PlanningTaskLink,
  PlanningDescriptionVersion,
  PlanningLinkKind,
  MarkDuplicateResult,
  CopyWorkItemResult,
  CreatePlanningSubprojectInput,
  PlanningSubproject,
  UpdatePlanningSubprojectInput
} from './planning-types'
import type {
  CreateSavedViewInput,
  SavedView,
  SavedViewConfig,
  SavedViewType,
  SearchOptions,
  SearchResult,
  UpdateSavedViewInput
} from './search-types'
import type { ItemLinkInfo, ItemLinkRef, LinkedFromEntry, LinkTargetKind } from './item-link-types'
import type { LiveListResult } from '../live-list'
import type {
  CreatePinInput,
  ListPinsQuery,
  MovePinInput,
  Pin,
  PinView,
  SetPinCountdownInput
} from './pin-types'
import type { StatusUpdate, StatusUpdateDraft, StatusUpdateInput } from '../status-updates'
import type { Cost, CostInput, CostQuery, MoneySummary, ProjectBudget } from '../money'
import type { ShoppingBuyInput, ShoppingInput, ShoppingItem } from '../shopping'
import type {
  Baseline,
  BaselineComparison,
  BaselineCreateInput,
  BaselineWithEntries
} from '../planning/baselines'
import type { Billing, BillingSettings, TimeReport, UnmarkedBilling } from '../time/billing'
import type { GoalCheckIn, GoalCheckInInput, GoalGlance } from '../goal-measures'
import type {
  CreatePersonalGoalInput,
  DeletedPersonalGoal,
  GoalCountsTowards,
  LinkableProjectGoal,
  PersonalGoalCheckIn,
  PersonalGoalView,
  SetCountsTowardsResult,
  UpdatePersonalGoalInput
} from '../personal-goals'
import type {
  Contact,
  ContactInput,
  ContactTask,
  DeletedContact,
  TaskContact,
  TaskContactLink,
  TaskContactMarks,
  TaskContactRole
} from '../contacts'
import type { VCardContact } from '../vcard'
import type { PopOutInfo, PopOutOpenResult } from '../pop-out'
import type { StickyPinResult, StickyTaskRef } from '../sticky-task'
import type { NewTaskDraft, NewTaskWindowResult } from '../new-task-window'
import type { TaskWindowResult } from '../task-window'
import type { GoalCheckInResult } from './planning-types'
import type {
  EventQuery,
  EventStats,
  ExportOptions,
  GitBranchGraph,
  GitCommit,
  TaskCommit,
  GitProjectState,
  NewProjectDefaults,
  NewProjectLocationCheck,
  NewProjectRequest,
  NewProjectResult,
  ProjectRemoval,
  ProjectRemovalArchive,
  ProjectRemovalInventory,
  ProjectRemovalPurge,
  DemoProjectsStatus,
  ProjectBackupEntry,
  ChecksumVerdict,
  ChecksumWritten,
  ProjectRecordsCheck,
  ProjectRecordsRepair,
  ProjectTokenKind,
  McpClientForm,
  McpConnection,
  RendererProject,
  RendererProjectUpdate,
  WatcherStatus,
  WatchEvent
} from './project-types'

// ─── IPC Channel Names ─────────────────────────────────────────────────────

export const IPC_CHANNELS = {
  // Projects
  GET_PROJECTS: 'ostler:get-projects',
  GET_NEW_PROJECT_DEFAULTS: 'ostler:get-new-project-defaults',
  CHECK_NEW_PROJECT_LOCATION: 'ostler:check-new-project-location',
  CREATE_PROJECT: 'ostler:create-project',
  LIST_PROJECT_TEMPLATES: 'ostler:list-project-templates',
  SAVE_PROJECT_AS_TEMPLATE: 'ostler:save-project-as-template',
  RENAME_PROJECT_TEMPLATE: 'ostler:rename-project-template',
  DELETE_PROJECT_TEMPLATE: 'ostler:delete-project-template',
  RESTORE_PROJECT_TEMPLATE: 'ostler:restore-project-template',
  EXPORT_PROJECT_TEMPLATE_FILE: 'ostler:export-project-template-file',
  IMPORT_TEMPLATE_FILE: 'ostler:import-template-file',
  // Import and export (P6.1)
  PICK_IMPORT_FILE: 'ostler:pick-import-file',
  FORGET_IMPORT_FILE: 'ostler:forget-import-file',
  UNLOCK_IMPORT_FILE: 'ostler:unlock-import-file',
  PREVIEW_CSV_IMPORT: 'ostler:preview-csv-import',
  PREVIEW_TRELLO_IMPORT: 'ostler:preview-trello-import',
  RUN_IMPORT: 'ostler:run-import',
  LIST_IMPORT_BATCHES: 'ostler:list-import-batches',
  CHECK_UNDO_IMPORT: 'ostler:check-undo-import',
  UNDO_IMPORT: 'ostler:undo-import',
  RESTORE_IMPORT: 'ostler:restore-import',
  // GitHub (R4.4, D40)
  LOAD_GITHUB_ISSUES: 'ostler:load-github-issues',
  PREVIEW_GITHUB_IMPORT: 'ostler:preview-github-import',
  REFRESH_GITHUB_LINKS: 'ostler:refresh-github-links',
  ADD_GITHUB_LINK: 'ostler:add-github-link',
  REMOVE_GITHUB_LINK: 'ostler:remove-github-link',
  RESTORE_GITHUB_LINK: 'ostler:restore-github-link',
  SUGGEST_GITHUB_REPOSITORY: 'ostler:suggest-github-repository',
  SET_GITHUB_TOKEN: 'ostler:set-github-token',
  CLEAR_GITHUB_TOKEN: 'ostler:clear-github-token',
  SET_EMAIL_SETTINGS: 'ostler:set-email-settings',
  CLEAR_EMAIL_SETTINGS: 'ostler:clear-email-settings',
  SEND_TEST_EMAIL: 'ostler:send-test-email',
  EXPORT_PROJECT: 'ostler:export-project',
  EXPORT_TASKS_CSV: 'ostler:export-tasks-csv',
  EDIT_IN_EXCEL: 'ostler:edit-in-excel',
  PREVIEW_BRING_BACK: 'ostler:preview-bring-back',
  APPLY_BRING_BACK: 'ostler:apply-bring-back',
  RESTORE_TASK_VALUES: 'ostler:restore-task-values',
  EXPORT_CALENDAR_FILE: 'ostler:export-calendar-file',
  EXPORT_SHARE_REPORT: 'ostler:export-share-report',
  EXPORT_TIMELINE_SLIDES: 'ostler:export-timeline-slides',
  PRINT_PROJECT_VIEW: 'ostler:print-project-view',
  PRINT_MY_WEEK: 'ostler:print-my-week',
  PRINT_TIMELINE_OVERVIEW: 'ostler:print-timeline-overview',
  PRINT_ROUND_COMPARISON: 'ostler:print-round-comparison',
  EXPORT_ROUND_COMPARISON_CSV: 'ostler:export-round-comparison-csv',
  LINK_PROJECT_FOLDER: 'ostler:link-project-folder',
  UNLINK_PROJECT_FOLDER: 'ostler:unlink-project-folder',
  REMOVE_PROJECT: 'ostler:remove-project',
  GET_PROJECT_REMOVAL_INVENTORY: 'ostler:get-project-removal-inventory',
  ARCHIVE_PROJECT_DATA: 'ostler:archive-project-data',
  PURGE_PROJECT_DATA: 'ostler:purge-project-data',
  GET_DEMO_PROJECTS: 'ostler:get-demo-projects',
  REMOVE_DEMO_PROJECTS: 'ostler:remove-demo-projects',
  LIST_PROJECT_BACKUPS: 'ostler:list-project-backups',
  CREATE_PROJECT_BACKUP: 'ostler:create-project-backup',
  DELETE_PROJECT_BACKUP: 'ostler:delete-project-backup',
  VERIFY_PROJECT_BACKUP: 'ostler:verify-project-backup',
  WRITE_PROJECT_BACKUP_CHECKSUM: 'ostler:write-project-backup-checksum',
  SHOW_PROJECT_BACKUP: 'ostler:show-project-backup',
  OPEN_PROJECT_BACKUP: 'ostler:open-project-backup',
  WRITE_CHECKSUM_FILE: 'ostler:write-checksum-file',
  VERIFY_CHECKSUM_FILE: 'ostler:verify-checksum-file',
  CHECK_PROJECT_RECORDS: 'ostler:check-project-records',
  REPAIR_PROJECT_RECORDS: 'ostler:repair-project-records',
  UPDATE_PROJECT: 'ostler:update-project',
  REORDER_PROJECTS: 'ostler:reorder-projects',
  GET_AREAS: 'ostler:get-areas',
  SAVE_AREAS: 'ostler:save-areas',
  BROWSE_FOR_FOLDER: 'ostler:browse-for-folder',

  // Watcher
  GET_WATCHER_STATUS: 'ostler:get-watcher-status',
  PAUSE_WATCHER: 'ostler:pause-watcher',
  RESUME_WATCHER: 'ostler:resume-watcher',

  // Events
  GET_RECENT_EVENTS: 'ostler:get-recent-events',
  GET_EVENT_STATS: 'ostler:get-event-stats',
  EXPORT_EVENTS: 'ostler:export-events',

  // Git
  GET_GIT_STATE: 'ostler:get-git-state',
  GET_GIT_LOG: 'ostler:get-git-log',
  GET_GIT_FILE_DIFF: 'ostler:get-git-file-diff',
  GET_GIT_BRANCH_GRAPH: 'ostler:get-git-branch-graph',

  // Harness
  GET_HARNESS_STATE: 'ostler:get-harness-state',
  HARNESS_START_TASK_SESSION: 'ostler:harness-start-task-session',
  HARNESS_START_EMBEDDED_SESSION: 'ostler:harness-start-embedded-session',
  HARNESS_UPDATE_SESSION: 'ostler:harness-update-session',
  HARNESS_ADD_TASK: 'ostler:harness-add-task',
  HARNESS_UPDATE_TASK: 'ostler:harness-update-task',
  GET_HARNESS_REPORT: 'ostler:get-harness-report',
  HARNESS_ANSWER_QUESTION: 'ostler:harness-answer-question',
  HARNESS_SEND_GUIDANCE: 'ostler:harness-send-guidance',
  HARNESS_GET_SESSION_PLAN: 'ostler:harness-get-session-plan',
  HARNESS_APPROVE_PLAN: 'ostler:harness-approve-plan',
  HARNESS_REQUEST_PLAN_CHANGES: 'ostler:harness-request-plan-changes',
  LIST_WORK_ITEM_PLANS: 'ostler:list-work-item-plans',
  AUTOMATION_GENERATE_TOKEN: 'ostler:automation-generate-token',
  AUTOMATION_REVOKE_TOKEN: 'ostler:automation-revoke-token',
  HARNESS_CANCEL_TASK: 'ostler:harness-cancel-task',
  HARNESS_REORDER_TASKS: 'ostler:harness-reorder-tasks',
  HARNESS_SET_TASK_PRIORITY: 'ostler:harness-set-task-priority',
  HARNESS_SET_TASK_AUTO_CONTINUE: 'ostler:harness-set-task-auto-continue',
  HARNESS_GET_SESSION_DIFF: 'ostler:harness-get-session-diff',
  HARNESS_STOP_SESSION: 'ostler:harness-stop-session',
  HARNESS_APPLY_TASK_WORK: 'ostler:harness-apply-task-work',
  HARNESS_DISCARD_TASK_WORK: 'ostler:harness-discard-task-work',
  // Try it (N9.4): the person's try command in a finished task's copy.
  GET_TRY_RUN: 'ostler:get-try-run',
  START_TRY_RUN: 'ostler:start-try-run',
  STOP_TRY_RUN: 'ostler:stop-try-run',
  UNDO_TRY_LEFT_FILES: 'ostler:undo-try-left-files',
  KEEP_TRY_LEFT_FILES: 'ostler:keep-try-left-files',
  OPEN_TRY_ADDRESS: 'ostler:open-try-address',
  // Triage (N4.3a): the decisions on a task waiting in To triage.
  ACCEPT_TRIAGED_WORK_ITEM: 'ostler:accept-triaged-work-item',
  ACCEPT_ALL_TRIAGED_WORK_ITEMS: 'ostler:accept-all-triaged-work-items',
  MOVE_TRIAGED_WORK_ITEM: 'ostler:move-triaged-work-item',
  UNDO_TRIAGE_MOVE: 'ostler:undo-triage-move',
  GET_TRIAGE: 'ostler:get-triage',
  GET_PROJECT_USAGE: 'ostler:get-project-usage',
  // Triage suggestions (N4.3b): Ostler AI suggests; nothing is saved.
  SUGGEST_AI_TRIAGE: 'ostler:suggest-ai-triage',
  HARNESS_SEND_BACK_TASK_WORK: 'ostler:harness-send-back-task-work',
  HARNESS_SAVE_REVIEW_DRAFTS: 'ostler:harness-save-review-drafts',
  HARNESS_START_REVIEW: 'ostler:harness-start-review',
  HARNESS_DISMISS_REVIEW_FINDING: 'ostler:harness-dismiss-review-finding',
  HARNESS_BRING_BACK_TASK_WORK: 'ostler:harness-bring-back-task-work',
  GET_PROJECT_HISTORY: 'ostler:get-project-history',
  UNDO_HISTORY_ENTRIES: 'ostler:undo-history-entries',
  RESTORE_HISTORY_ENTRY: 'ostler:restore-history-entry',
  GET_AGENT_STORAGE: 'ostler:get-agent-storage',
  REMOVE_LEGACY_AGENT_FILES: 'ostler:remove-legacy-agent-files',
  RETRY_LEGACY_MIGRATION: 'ostler:retry-legacy-migration',
  GET_PROJECT_AUTO_DISPATCH_CONFIG: 'ostler:get-project-auto-dispatch-config',
  CHECK_AGENT_REQUIREMENTS: 'ostler:check-agent-requirements',
  HARNESS_LIST_RECENT_RUNS: 'ostler:harness-list-recent-runs',
  HARNESS_RUN_HISTORY: 'ostler:harness-run-history',
  HARNESS_EXPORT_RUN_HISTORY: 'ostler:harness-export-run-history',
  HARNESS_AGENT_USAGE: 'ostler:harness-agent-usage',
  UPDATE_PROJECT_AUTO_DISPATCH_CONFIG: 'ostler:update-project-auto-dispatch-config',
  HARNESS_SET_TASK_HOLD: 'ostler:harness-set-task-hold',
  HARNESS_SET_TASK_RUN_MODEL: 'ostler:harness-set-task-run-model',
  HARNESS_GET_SESSION_TRANSCRIPT: 'ostler:harness-get-session-transcript',

  // AI Chat
  SEND_MESSAGE: 'ostler:send-message',
  GET_CONVERSATIONS: 'ostler:get-conversations',
  GET_CONVERSATION: 'ostler:get-conversation',
  CREATE_CONVERSATION: 'ostler:create-conversation',
  DELETE_CONVERSATION: 'ostler:delete-conversation',
  SAVE_PROJECT_STATUS_NOTE: 'ostler:save-project-status-note',
  TEST_AI_CONNECTION: 'ostler:test-ai-connection',
  LIST_AI_MODELS: 'ostler:list-ai-models',
  GET_AI_MODEL_EFFORT_SUPPORT: 'ostler:get-ai-model-effort-support',
  EMERGENCY_STOP_AI: 'ostler:emergency-stop-ai',
  RESUME_AI: 'ostler:resume-ai',
  GET_AI_HALT_STATE: 'ostler:get-ai-halt-state',
  FIND_LOCAL_AI: 'ostler:find-local-ai',
  OPEN_AI_PROVIDER_PAGE: 'ostler:open-ai-provider-page',
  GET_PROJECT_AI_SETTINGS: 'ostler:get-project-ai-settings',
  UPDATE_PROJECT_AI_SETTINGS: 'ostler:update-project-ai-settings',

  // Planning
  GET_PLANNING_GOALS: 'ostler:get-planning-goals',
  CREATE_PLANNING_GOAL: 'ostler:create-planning-goal',
  UPDATE_PLANNING_GOAL: 'ostler:update-planning-goal',
  DELETE_PLANNING_GOAL: 'ostler:delete-planning-goal',
  GET_PLANNING_MILESTONES: 'ostler:get-planning-milestones',
  CREATE_PLANNING_MILESTONE: 'ostler:create-planning-milestone',
  UPDATE_PLANNING_MILESTONE: 'ostler:update-planning-milestone',
  DELETE_PLANNING_MILESTONE: 'ostler:delete-planning-milestone',
  SET_MILESTONE_REPEAT: 'ostler:set-milestone-repeat',
  PREVIEW_MILESTONE_ROUND: 'ostler:preview-milestone-round',
  START_NEXT_MILESTONE_ROUND: 'ostler:start-next-milestone-round',
  GET_PLANNING_ITERATIONS: 'ostler:get-planning-iterations',
  CREATE_PLANNING_ITERATION: 'ostler:create-planning-iteration',
  UPDATE_PLANNING_ITERATION: 'ostler:update-planning-iteration',
  START_PLANNING_ITERATION: 'ostler:start-planning-iteration',
  FINISH_PLANNING_ITERATION: 'ostler:finish-planning-iteration',
  DELETE_PLANNING_ITERATION: 'ostler:delete-planning-iteration',
  RESTORE_PLANNING_ITERATION: 'ostler:restore-planning-iteration',
  GET_PLANNING_TASK_TYPES: 'ostler:get-planning-task-types',
  CREATE_PLANNING_TASK_TYPE: 'ostler:create-planning-task-type',
  UPDATE_PLANNING_TASK_TYPE: 'ostler:update-planning-task-type',
  REORDER_PLANNING_TASK_TYPES: 'ostler:reorder-planning-task-types',
  DELETE_PLANNING_TASK_TYPE: 'ostler:delete-planning-task-type',
  RESTORE_PLANNING_TASK_TYPE: 'ostler:restore-planning-task-type',
  LIST_SUBPROJECTS: 'ostler:list-subprojects',
  CREATE_SUBPROJECT: 'ostler:create-subproject',
  UPDATE_SUBPROJECT: 'ostler:update-subproject',
  MOVE_SUBPROJECT: 'ostler:move-subproject',
  ARCHIVE_SUBPROJECT: 'ostler:archive-subproject',
  DELETE_SUBPROJECT: 'ostler:delete-subproject',
  GET_PLANNING_RULES: 'ostler:get-planning-rules',
  CREATE_PLANNING_RULE: 'ostler:create-planning-rule',
  UPDATE_PLANNING_RULE: 'ostler:update-planning-rule',
  DELETE_PLANNING_RULE: 'ostler:delete-planning-rule',
  RESTORE_PLANNING_RULE: 'ostler:restore-planning-rule',
  PREVIEW_PLANNING_RULE: 'ostler:preview-planning-rule',
  GET_TASK_TEMPLATES: 'ostler:get-task-templates',
  GET_ALL_TASK_TEMPLATES: 'ostler:get-all-task-templates',
  SAVE_TASK_TEMPLATE_FROM_WORK_ITEM: 'ostler:save-task-template-from-work-item',
  UPDATE_TASK_TEMPLATE: 'ostler:update-task-template',
  DELETE_TASK_TEMPLATE: 'ostler:delete-task-template',
  RESTORE_TASK_TEMPLATE: 'ostler:restore-task-template',
  USE_TASK_TEMPLATE: 'ostler:use-task-template',
  RUN_PLAYBOOK: 'ostler:run-playbook',
  GET_PLANNING_WORK_ITEMS: 'ostler:get-planning-work-items',
  GET_WORK_ITEM_COMMITS: 'ostler:get-work-item-commits',
  GET_PLANNING_STATUS_TRANSITIONS: 'ostler:get-planning-status-transitions',
  GET_PLANNING_LATEST_STATUS_CHANGES: 'ostler:get-planning-latest-status-changes',
  GET_PLANNING_WORK_ITEM_METRICS: 'ostler:get-planning-work-item-metrics',
  GET_PLANNING_PROJECT_WORK_ITEM_METRICS: 'ostler:get-planning-project-work-item-metrics',
  GET_PLANNING_MILESTONE_METRICS: 'ostler:get-planning-milestone-metrics',
  GET_PLANNING_READINESS: 'ostler:get-planning-readiness',
  GET_PLANNING_PROJECT_METRICS: 'ostler:get-planning-project-metrics',
  GET_PROJECT_REPORT: 'ostler:get-project-report',
  GET_ROUND_COMPARISON: 'ostler:get-round-comparison',
  CREATE_PLANNING_WORK_ITEM: 'ostler:create-planning-work-item',
  CREATE_PLANNING_WORK_ITEM_BATCH: 'ostler:create-planning-work-item-batch',
  CHECK_PLANNING_WORK_ITEM_BATCH: 'ostler:check-planning-work-item-batch',
  UPDATE_PLANNING_WORK_ITEM: 'ostler:update-planning-work-item',
  MOVE_PLANNING_WORK_ITEM: 'ostler:move-planning-work-item',
  DELETE_PLANNING_WORK_ITEM: 'ostler:delete-planning-work-item',
  ARCHIVE_PLANNING_WORK_ITEM: 'ostler:archive-planning-work-item',
  UNARCHIVE_PLANNING_WORK_ITEM: 'ostler:unarchive-planning-work-item',
  WONT_DO_PLANNING_WORK_ITEM: 'ostler:wont-do-planning-work-item',
  RESTORE_PLANNING_WORK_ITEM: 'ostler:restore-planning-work-item',
  DELETE_PLANNING_WORK_ITEM_FOREVER: 'ostler:delete-planning-work-item-forever',
  SET_PLANNING_CHECKLIST_ITEM_CHECKED: 'ostler:set-planning-checklist-item-checked',
  SET_PLANNING_CHECKLIST_ITEM_DETAILS: 'ostler:set-planning-checklist-item-details',
  RENAME_PLANNING_CHECKLIST_ITEM: 'ostler:rename-planning-checklist-item',
  GET_PLANNING_WORK_ITEM_LINKS: 'ostler:get-planning-work-item-links',
  RESOLVE_ITEM_LINKS: 'ostler:resolve-item-links',
  RESOLVE_TASK_KEYS: 'ostler:resolve-task-keys',
  GET_LINKED_FROM: 'ostler:get-linked-from',
  QUERY_LIVE_LISTS: 'ostler:query-live-lists',
  GET_PLANNING_DESCRIPTION_VERSIONS: 'ostler:get-planning-description-versions',
  RESTORE_PLANNING_DESCRIPTION_VERSION: 'ostler:restore-planning-description-version',
  ADD_PLANNING_WORK_ITEM_LINK: 'ostler:add-planning-work-item-link',
  REMOVE_PLANNING_WORK_ITEM_LINK: 'ostler:remove-planning-work-item-link',
  MARK_PLANNING_WORK_ITEM_DUPLICATE: 'ostler:mark-planning-work-item-duplicate',
  COPY_PLANNING_WORK_ITEM: 'ostler:copy-planning-work-item',
  GET_PLANNING_LABELS: 'ostler:get-planning-labels',
  SET_PLANNING_LABEL_COLOR: 'ostler:set-planning-label-color',
  RENAME_PLANNING_LABEL: 'ostler:rename-planning-label',
  DELETE_PLANNING_LABEL: 'ostler:delete-planning-label',
  RESTORE_PLANNING_LABEL: 'ostler:restore-planning-label',
  GET_PLANNING_FIELDS: 'ostler:get-planning-fields',
  CREATE_PLANNING_FIELD: 'ostler:create-planning-field',
  UPDATE_PLANNING_FIELD: 'ostler:update-planning-field',
  REORDER_PLANNING_FIELDS: 'ostler:reorder-planning-fields',
  DELETE_PLANNING_FIELD: 'ostler:delete-planning-field',
  RESTORE_PLANNING_FIELD: 'ostler:restore-planning-field',
  SUGGEST_AI_FIELD_VALUE: 'ostler:suggest-ai-field-value',
  APPLY_AI_FIELD_FILLS: 'ostler:apply-ai-field-fills',
  RESTORE_AI_FIELD_FILLS: 'ostler:restore-ai-field-fills',
  GET_TASK_TIME_ENTRIES: 'ostler:get-task-time-entries',
  GET_TIME_TOTALS: 'ostler:get-time-totals',
  LIST_TIME_ENTRIES: 'ostler:list-time-entries',
  CREATE_TIME_ENTRY: 'ostler:create-time-entry',
  UPDATE_TIME_ENTRY: 'ostler:update-time-entry',
  DELETE_TIME_ENTRY: 'ostler:delete-time-entry',
  RESTORE_TIME_ENTRY: 'ostler:restore-time-entry',
  EXPORT_TIME_CSV: 'ostler:export-time-csv',
  GET_TIMER: 'ostler:get-timer',
  START_TIMER: 'ostler:start-timer',
  STOP_TIMER: 'ostler:stop-timer',
  UNDO_TIMER_START: 'ostler:undo-timer-start',
  RESOLVE_INTERRUPTED_TIMER: 'ostler:resolve-interrupted-timer',
  GET_FOCUS: 'ostler:get-focus',
  START_FOCUS: 'ostler:start-focus',
  STOP_FOCUS: 'ostler:stop-focus',
  CHOOSE_FOCUS_END: 'ostler:choose-focus-end',
  GET_PLANNING_ACTIVITY: 'ostler:get-planning-activity',
  GET_PLANNING_PROJECT_ACTIVITY: 'ostler:get-planning-project-activity',
  GET_PLANNING_COMMENT_COUNTS: 'ostler:get-planning-comment-counts',
  ADD_PLANNING_COMMENT: 'ostler:add-planning-comment',
  UPDATE_PLANNING_COMMENT: 'ostler:update-planning-comment',
  DELETE_PLANNING_COMMENT: 'ostler:delete-planning-comment',
  RESTORE_PLANNING_COMMENT: 'ostler:restore-planning-comment',
  PIN_PLANNING_COMMENT: 'ostler:pin-planning-comment',
  GET_PEOPLE: 'ostler:get-people',
  CREATE_PERSON: 'ostler:create-person',
  UPDATE_PERSON: 'ostler:update-person',
  ARCHIVE_PERSON: 'ostler:archive-person',
  UNARCHIVE_PERSON: 'ostler:unarchive-person',
  GET_PERSON_USAGE: 'ostler:get-person-usage',
  DELETE_PERSON: 'ostler:delete-person',
  SET_ME: 'ostler:set-me',
  GET_DAYS_OFF: 'ostler:get-days-off',
  GET_SHARED_AWAY: 'ostler:get-shared-away',
  GET_TASK_FOLLOW: 'ostler:get-task-follow',
  SET_TASK_FOLLOW: 'ostler:set-task-follow',
  LIST_SIGN_OFFS_FOR_ITEM: 'ostler:list-sign-offs-for-item',
  REQUEST_SIGN_OFF: 'ostler:request-sign-off',
  APPROVE_SIGN_OFF: 'ostler:approve-sign-off',
  SEND_BACK_SIGN_OFF: 'ostler:send-back-sign-off',
  CANCEL_SIGN_OFF: 'ostler:cancel-sign-off',
  LIST_SIGN_OFFS_WAITING_FOR_ME: 'ostler:list-sign-offs-waiting-for-me',
  LIST_SIGN_OFFS_FOR_PROJECT: 'ostler:list-sign-offs-for-project',
  LIST_TEAMS: 'ostler:list-teams',
  CREATE_TEAM: 'ostler:create-team',
  UPDATE_TEAM: 'ostler:update-team',
  SET_TEAM_MEMBERS: 'ostler:set-team-members',
  ARCHIVE_TEAM: 'ostler:archive-team',
  RESTORE_TEAM: 'ostler:restore-team',
  DELETE_TEAM: 'ostler:delete-team',
  GET_AWAY_SHARING: 'ostler:get-away-sharing',
  SET_AWAY_SHARING: 'ostler:set-away-sharing',
  CREATE_DAY_OFF: 'ostler:create-day-off',
  UPDATE_DAY_OFF: 'ostler:update-day-off',
  REMOVE_DAY_OFF: 'ostler:remove-day-off',
  RESTORE_DAYS_OFF: 'ostler:restore-days-off',
  CHOOSE_DAYS_OFF_FILE: 'ostler:choose-days-off-file',
  PREVIEW_DAYS_OFF_IMPORT: 'ostler:preview-days-off-import',
  IMPORT_DAYS_OFF: 'ostler:import-days-off',
  REMOVE_DAYS_OFF_FILE: 'ostler:remove-days-off-file',
  GET_OUTSIDE_CALENDARS: 'ostler:get-outside-calendars',
  CHOOSE_CALENDAR_FILE: 'ostler:choose-calendar-file',
  ADD_CALENDAR_FILE: 'ostler:add-calendar-file',
  RELOAD_OUTSIDE_CALENDAR: 'ostler:reload-outside-calendar',
  UPDATE_OUTSIDE_CALENDAR: 'ostler:update-outside-calendar',
  REMOVE_OUTSIDE_CALENDAR: 'ostler:remove-outside-calendar',
  RESTORE_OUTSIDE_CALENDAR: 'ostler:restore-outside-calendar',
  ADD_CALENDAR_LINK: 'ostler:add-calendar-link',
  REFRESH_CALENDAR_LINK: 'ostler:refresh-calendar-link',
  REPLACE_CALENDAR_LINK: 'ostler:replace-calendar-link',
  GET_CALENDAR_EVENTS: 'ostler:get-calendar-events',
  GET_MY_WORK: 'ostler:get-my-work',
  GET_HOME_PROGRESS: 'ostler:get-home-progress',
  GET_YEAR_IN_REVIEW: 'ostler:get-year-in-review',
  PRINT_YEAR_IN_REVIEW: 'ostler:print-year-in-review',
  GET_ASSIGNED_TASKS: 'ostler:get-assigned-tasks',
  GET_ASSIGNED_CHECKLIST_ITEMS: 'ostler:get-assigned-checklist-items',
  GET_WORKLOAD_TASKS: 'ostler:get-workload-tasks',
  GET_TEAM_OVERVIEW: 'ostler:get-team-overview',
  GET_TIMELINE_OVERVIEW: 'ostler:get-timeline-overview',
  GET_PLAN_MY_DAY: 'ostler:get-plan-my-day',
  ADD_TO_MY_DAY: 'ostler:add-to-my-day',
  MOVE_IN_MY_DAY: 'ostler:move-in-my-day',
  REMOVE_FROM_MY_DAY: 'ostler:remove-from-my-day',
  START_MY_DAY: 'ostler:start-my-day',
  LET_GO_MY_DAY: 'ostler:let-go-my-day',
  GET_TIME_BLOCKS: 'ostler:get-time-blocks',
  CREATE_TIME_BLOCK: 'ostler:create-time-block',
  UPDATE_TIME_BLOCK: 'ostler:update-time-block',
  REMOVE_TIME_BLOCK: 'ostler:remove-time-block',
  RESTORE_TIME_BLOCK: 'ostler:restore-time-block',
  REMOVE_TIME_BLOCKS: 'ostler:remove-time-blocks',
  PREVIEW_BLOCK_MOVES: 'ostler:preview-block-moves',
  APPLY_BLOCK_MOVES: 'ostler:apply-block-moves',
  PREVIEW_FILL_DAY: 'ostler:preview-fill-day',
  APPLY_FILL_DAY: 'ostler:apply-fill-day',
  PREVIEW_RESCHEDULE: 'ostler:preview-reschedule',
  APPLY_RESCHEDULE: 'ostler:apply-reschedule',
  PREVIEW_MOVE_DEPENDENTS: 'ostler:preview-move-dependents',
  PREVIEW_FIND_REPLACE: 'ostler:preview-find-replace',
  APPLY_FIND_REPLACE: 'ostler:apply-find-replace',
  REVERT_FIND_REPLACE: 'ostler:revert-find-replace',
  GET_NEEDS_YOU: 'ostler:get-needs-you',
  GET_WEEKLY_REVIEW: 'ostler:get-weekly-review',
  FINISH_WEEKLY_REVIEW: 'ostler:finish-weekly-review',
  GET_LAST_WEEKLY_REVIEW: 'ostler:get-last-weekly-review',
  GET_BRIEFING: 'ostler:get-briefing',
  WRITE_BRIEFING: 'ostler:write-briefing',
  GET_GETTING_STARTED: 'ostler:get-getting-started',
  RECORD_GETTING_STARTED: 'ostler:record-getting-started',
  DISMISS_GETTING_STARTED: 'ostler:dismiss-getting-started',
  GET_INBOX: 'ostler:get-inbox',
  SET_INBOX_READ: 'ostler:set-inbox-read',
  ARCHIVE_INBOX_ITEMS: 'ostler:archive-inbox-items',
  UNARCHIVE_INBOX_ITEMS: 'ostler:unarchive-inbox-items',
  MARK_ALL_INBOX_READ: 'ostler:mark-all-inbox-read',
  SNOOZE_INBOX_REMINDER: 'ostler:snooze-inbox-reminder',
  QUEUE_SCHEDULED_TASK_NOW: 'ostler:queue-scheduled-task-now',
  GET_PLANNING_RECURRENCE: 'ostler:get-planning-recurrence',
  SET_PLANNING_RECURRENCE: 'ostler:set-planning-recurrence',
  GET_PLANNING_REMINDERS: 'ostler:get-planning-reminders',
  ADD_PLANNING_REMINDER: 'ostler:add-planning-reminder',
  DELETE_PLANNING_REMINDER: 'ostler:delete-planning-reminder',
  STOP_PLANNING_REMINDER: 'ostler:stop-planning-reminder',
  GET_PLANNING_DECISIONS: 'ostler:get-planning-decisions',
  CREATE_PLANNING_DECISION: 'ostler:create-planning-decision',
  UPDATE_PLANNING_DECISION: 'ostler:update-planning-decision',
  DELETE_PLANNING_DECISION: 'ostler:delete-planning-decision',
  GET_PLANNING_WIP_LIMITS: 'ostler:get-planning-wip-limits',
  SET_PLANNING_WIP_LIMIT: 'ostler:set-planning-wip-limit',
  GET_PLANNING_COLUMN_SETTINGS: 'ostler:get-planning-column-settings',
  UPDATE_PLANNING_COLUMN_SETTINGS: 'ostler:update-planning-column-settings',
  SEARCH: 'ostler:search',
  ASK_OSTLER: 'ostler:ask-ostler',
  CANCEL_ASK_OSTLER: 'ostler:cancel-ask-ostler',
  LIST_SAVED_VIEWS: 'ostler:list-saved-views',
  CREATE_SAVED_VIEW: 'ostler:create-saved-view',
  UPDATE_SAVED_VIEW: 'ostler:update-saved-view',
  DELETE_SAVED_VIEW: 'ostler:delete-saved-view',
  RESTORE_SAVED_VIEW: 'ostler:restore-saved-view',
  GET_DEFAULT_SAVED_VIEW: 'ostler:get-default-saved-view',
  SET_DEFAULT_SAVED_VIEW: 'ostler:set-default-saved-view',
  LIST_SHARED_SAVED_VIEWS: 'ostler:list-shared-saved-views',
  CLEAR_DEFAULT_SAVED_VIEW: 'ostler:clear-default-saved-view',
  // Undo history: every change the person made, step by step
  CHANGE_HISTORY_LIST: 'ostler:change-history-list',
  CHANGE_HISTORY_DETAILS: 'ostler:change-history-details',
  CHANGE_HISTORY_HEAD: 'ostler:change-history-head',
  CHANGE_HISTORY_STATS: 'ostler:change-history-stats',
  CHANGE_HISTORY_UNDO: 'ostler:change-history-undo',
  CHANGE_HISTORY_REDO: 'ostler:change-history-redo',
  CHANGE_HISTORY_UNDO_LATEST: 'ostler:change-history-undo-latest',
  CHANGE_HISTORY_REDO_LATEST: 'ostler:change-history-redo-latest',
  CHANGE_HISTORY_DELETE: 'ostler:change-history-delete',
  CHANGE_HISTORY_CLEAR: 'ostler:change-history-clear',

  LIST_PINS: 'ostler:list-pins',
  CREATE_PIN: 'ostler:create-pin',
  DELETE_PIN: 'ostler:delete-pin',
  RESTORE_PIN: 'ostler:restore-pin',
  MOVE_PIN: 'ostler:move-pin',
  SET_PIN_COUNTDOWN: 'ostler:set-pin-countdown',
  LIST_COUNTDOWNS: 'ostler:list-countdowns',
  LIST_STATUS_UPDATES: 'ostler:list-status-updates',
  LATEST_STATUS_UPDATES: 'ostler:latest-status-updates',
  POST_STATUS_UPDATE: 'ostler:post-status-update',
  EDIT_STATUS_UPDATE: 'ostler:edit-status-update',
  DELETE_STATUS_UPDATE: 'ostler:delete-status-update',
  RESTORE_STATUS_UPDATE: 'ostler:restore-status-update',
  REVERT_STATUS_UPDATE: 'ostler:revert-status-update',
  DRAFT_STATUS_UPDATE: 'ostler:draft-status-update',
  GET_BUDGET: 'ostler:get-budget',
  SET_BUDGET: 'ostler:set-budget',
  GET_MONEY_SUMMARY: 'ostler:get-money-summary',
  LIST_COSTS: 'ostler:list-costs',
  LIST_COST_CATEGORIES: 'ostler:list-cost-categories',
  CREATE_COST: 'ostler:create-cost',
  UPDATE_COST: 'ostler:update-cost',
  MARK_COST_PAID: 'ostler:mark-cost-paid',
  DELETE_COST: 'ostler:delete-cost',
  RESTORE_COST: 'ostler:restore-cost',
  EXPORT_COSTS_CSV: 'ostler:export-costs-csv',
  LIST_SHOPPING: 'ostler:list-shopping',
  CREATE_SHOPPING_ITEM: 'ostler:create-shopping-item',
  UPDATE_SHOPPING_ITEM: 'ostler:update-shopping-item',
  DELETE_SHOPPING_ITEM: 'ostler:delete-shopping-item',
  RESTORE_SHOPPING_ITEM: 'ostler:restore-shopping-item',
  BUY_SHOPPING_ITEM: 'ostler:buy-shopping-item',
  UNBUY_SHOPPING_ITEM: 'ostler:unbuy-shopping-item',
  REBUY_SHOPPING_ITEM: 'ostler:rebuy-shopping-item',
  LIST_BASELINES: 'ostler:list-baselines',
  GET_BASELINE: 'ostler:get-baseline',
  CREATE_BASELINE: 'ostler:create-baseline',
  RENAME_BASELINE: 'ostler:rename-baseline',
  DELETE_BASELINE: 'ostler:delete-baseline',
  RESTORE_BASELINE: 'ostler:restore-baseline',
  COMPARE_BASELINE: 'ostler:compare-baseline',
  GET_BILLING_SETTINGS: 'ostler:get-billing-settings',
  SET_BILLING_SETTINGS: 'ostler:set-billing-settings',
  GET_TIME_REPORT: 'ostler:get-time-report',
  MARK_BILLED: 'ostler:mark-billed',
  UNMARK_BILLING: 'ostler:unmark-billing',
  RESTORE_BILLING: 'ostler:restore-billing',
  EXPORT_TIME_REPORT_CSV: 'ostler:export-time-report-csv',
  PRINT_TIME_REPORT: 'ostler:print-time-report',
  LIST_GOAL_CHECK_INS: 'ostler:list-goal-check-ins',
  GOAL_GLANCES: 'ostler:goal-glances',
  LIST_CONTACTS: 'ostler:list-contacts',
  CREATE_CONTACT: 'ostler:create-contact',
  UPDATE_CONTACT: 'ostler:update-contact',
  DELETE_CONTACT: 'ostler:delete-contact',
  RESTORE_CONTACT: 'ostler:restore-contact',
  CONTACT_TASKS: 'ostler:contact-tasks',
  TASK_CONTACTS: 'ostler:task-contacts',
  PROJECT_TASK_CONTACTS: 'ostler:project-task-contacts',
  LINK_TASK_CONTACT: 'ostler:link-task-contact',
  UNLINK_TASK_CONTACT: 'ostler:unlink-task-contact',
  RELINK_TASK_CONTACT: 'ostler:relink-task-contact',
  OPEN_CONTACT: 'ostler:open-contact',
  READ_VCARD_FILE: 'ostler:read-vcard-file',
  IMPORT_CONTACTS: 'ostler:import-contacts',
  RECORD_GOAL_CHECK_IN: 'ostler:record-goal-check-in',
  DELETE_GOAL_CHECK_IN: 'ostler:delete-goal-check-in',
  RESTORE_GOAL_CHECK_IN: 'ostler:restore-goal-check-in',
  LIST_PERSONAL_GOALS: 'ostler:list-personal-goals',
  CREATE_PERSONAL_GOAL: 'ostler:create-personal-goal',
  UPDATE_PERSONAL_GOAL: 'ostler:update-personal-goal',
  DELETE_PERSONAL_GOAL: 'ostler:delete-personal-goal',
  RESTORE_PERSONAL_GOAL: 'ostler:restore-personal-goal',
  RECORD_PERSONAL_GOAL_CHECK_IN: 'ostler:record-personal-goal-check-in',
  DELETE_PERSONAL_GOAL_CHECK_IN: 'ostler:delete-personal-goal-check-in',
  RESTORE_PERSONAL_GOAL_CHECK_IN: 'ostler:restore-personal-goal-check-in',
  SET_GOAL_COUNTS_TOWARDS: 'ostler:set-goal-counts-towards',
  LIST_GOALS_COUNTS_TOWARDS: 'ostler:list-goals-counts-towards',
  LIST_LINKABLE_PROJECT_GOALS: 'ostler:list-linkable-project-goals',
  QUEUE_PLANNING_WORK_ITEM: 'ostler:queue-planning-work-item',
  QUEUE_PLANNING_WORK_ITEMS: 'ostler:queue-planning-work-items',
  COPY_PLANNING_AGENT_HANDOFF: 'ostler:copy-planning-agent-handoff',
  BREAK_DOWN_PLANNING_GOAL: 'ostler:break-down-planning-goal',
  APPROVE_AI_PLANNING_DRAFT: 'ostler:approve-ai-planning-draft',
  GENERATE_AI_NEXT_TASKS: 'ostler:generate-ai-next-tasks',
  REVIEW_AI_MILESTONE: 'ostler:review-ai-milestone',
  GET_AI_MILESTONE_ADVISORY: 'ostler:get-ai-milestone-advisory',
  APPROVE_AI_NEXT_TASKS: 'ostler:approve-ai-next-tasks',
  FIND_TASKS_FROM_TEXT: 'ostler:find-tasks-from-text',
  FILTER_FROM_WORDS: 'ostler:filter-from-words',
  ADD_TASKS_FROM_TEXT: 'ostler:add-tasks-from-text',
  FIND_NOTE_ACTIONS: 'ostler:find-note-actions',
  ADD_NOTE_ACTIONS: 'ostler:add-note-actions',
  MAKE_LINE_TASKS: 'ostler:make-line-tasks',
  UNDO_LINE_TASKS: 'ostler:undo-line-tasks',
  IMPROVE_WRITING: 'ostler:improve-writing',
  POLISH_RELEASE_NOTES: 'ostler:polish-release-notes',
  SUMMARISE_COMMENTS: 'ostler:summarise-comments',
  ADD_COMMENT_SUMMARY: 'ostler:add-comment-summary',
  GENERATE_AI_PROJECT_BRIEF: 'ostler:generate-ai-project-brief',
  GET_AI_PROJECT_BRIEF: 'ostler:get-ai-project-brief',
  REVIEW_AI_PROJECT_BRIEF_ACTION: 'ostler:review-ai-project-brief-action',
  REGENERATE_AI_PROJECT_BRIEF_ACTION: 'ostler:regenerate-ai-project-brief-action',
  RECORD_AI_PROJECT_BRIEF_ACTION_CREATION: 'ostler:record-ai-project-brief-action-creation',
  UNDO_AI_PROJECT_BRIEF_ACTION_CREATION: 'ostler:undo-ai-project-brief-action-creation',
  IMPROVE_PLANNING_WORK_ITEM: 'ostler:improve-planning-work-item',
  DRAFT_AI_DECISION: 'ostler:draft-ai-decision',
  APPROVE_AI_DECISION: 'ostler:approve-ai-decision',

  // Agent Plan & Split workflow
  PROPOSE_AI_GOAL_FROM_LIBRARY: 'ostler:propose-ai-goal-from-library',
  GENERATE_AI_MASTER_PLAN: 'ostler:generate-ai-master-plan',
  APPROVE_AI_MASTER_PLAN: 'ostler:approve-ai-master-plan',
  START_AI_TASK_SPLIT: 'ostler:start-ai-task-split',
  GET_AI_TASK_SPLIT_JOB: 'ostler:get-ai-task-split-job',
  RETRY_AI_TASK_SPLIT_PHASE: 'ostler:retry-ai-task-split-phase',
  CANCEL_AI_TASK_SPLIT: 'ostler:cancel-ai-task-split',
  GET_AI_TASK_SPLIT_DRAFT: 'ostler:get-ai-task-split-draft',
  CREATE_AGENT_PLAN_TASKS: 'ostler:create-agent-plan-tasks',
  LIST_OPEN_BLOCKERS: 'ostler:list-open-blockers',
  REPORT_BLOCKER: 'ostler:report-blocker',
  RESOLVE_BLOCKER: 'ostler:resolve-blocker',
  REVIEW_TASK_STATUS: 'ostler:review-task-status',
  ACCEPT_TASK_STATUS_REVIEW: 'ostler:accept-task-status-review',

  // AI Task Review
  TASK_REVIEW_GET: 'ostler:task-review-get',
  TASK_REVIEW_REFRESH: 'ostler:task-review-refresh',
  TASK_REVIEW_ANNOTATE: 'ostler:task-review-annotate',
  TASK_REVIEW_ACCEPT: 'ostler:task-review-accept',
  TASK_REVIEW_DISMISS: 'ostler:task-review-dismiss',
  TASK_REVIEW_RESOLVE: 'ostler:task-review-resolve',

  // Config
  GET_CONFIG: 'ostler:get-config',
  UPDATE_CONFIG: 'ostler:update-config',
  CLEAR_AI_API_KEY: 'ostler:clear-ai-api-key',

  // Prompts and tokens (built in main, which holds the secrets)
  COPY_HARNESS_SESSION_PROMPT: 'ostler:copy-harness-session-prompt',
  COPY_AUTOMATION_TASK_PROMPT: 'ostler:copy-automation-task-prompt',
  COPY_PROJECT_CONNECTION: 'ostler:copy-project-connection',
  REVEAL_PROJECT_TOKEN: 'ostler:reveal-project-token',
  DESCRIBE_MCP_CONNECTION: 'ostler:describe-mcp-connection',
  COPY_MCP_CLIENT_CONFIG: 'ostler:copy-mcp-client-config',
  DESCRIBE_PROJECT_SETUP: 'ostler:describe-project-setup',

  // Diagnostics
  LOG_RENDERER_ERROR: 'ostler:log-renderer-error',
  COPY_DIAGNOSTICS: 'ostler:copy-diagnostics',
  REPORT_PROBLEM: 'ostler:report-problem',
  GET_APP_VERSION: 'ostler:get-app-version',
  GET_THIRD_PARTY_NOTICES: 'ostler:get-third-party-notices',

  // Updates (P10.1)
  GET_UPDATE_STATE: 'ostler:get-update-state',
  CHECK_FOR_UPDATES: 'ostler:check-for-updates',
  DOWNLOAD_UPDATE: 'ostler:download-update',
  RESTART_TO_UPDATE: 'ostler:restart-to-update',

  // System
  OPEN_IN_EXPLORER: 'ostler:open-in-explorer',
  OPEN_EXTERNAL_LINK: 'ostler:open-external-link',
  OPEN_PROJECT_FILE: 'ostler:open-project-file',
  GET_LOCALE: 'ostler:get-locale',
  OPEN_CHECKOUT: 'ostler:open-checkout',
  COPY_TEXT: 'ostler:copy-text',
  /** Off screen only, for the preload's paste key: the text in Ostler's own clipboard. */
  READ_OFF_SCREEN_CLIPBOARD: 'ostler:read-off-screen-clipboard',
  GET_DATABASE_STATS: 'ostler:get-database-stats',
  PRUNE_DATABASE: 'ostler:prune-database',

  // Backups
  LIST_BACKUPS: 'ostler:list-backups',
  CREATE_BACKUP: 'ostler:create-backup',
  RESTORE_BACKUP: 'ostler:restore-backup',
  DELETE_BACKUP: 'ostler:delete-backup',
  OPEN_BACKUPS_FOLDER: 'ostler:open-backups-folder',
  GET_BACKUP_COPY_STATUS: 'ostler:get-backup-copy-status',
  CHOOSE_BACKUP_COPY_FOLDER: 'ostler:choose-backup-copy-folder',
  STOP_BACKUP_COPY: 'ostler:stop-backup-copy',
  LIST_SECOND_PLACE_BACKUPS: 'ostler:list-second-place-backups',
  RESTORE_FROM_SECOND_PLACE: 'ostler:restore-from-second-place',

  // Sharing a project through a synced folder
  GET_SHARE_STATE: 'ostler:get-share-state',
  GET_MEMBERSHIP_HISTORY: 'ostler:get-membership-history',
  OPEN_SHARE_FOLDER: 'ostler:open-share-folder',
  SHARE_PROJECT: 'ostler:share-project',
  LIST_SYNC_PLACES: 'ostler:list-sync-places',
  COPY_SHARE_INVITE: 'ostler:copy-share-invite',
  EMAIL_SHARE_INVITE: 'ostler:email-share-invite',
  JOIN_SHARE: 'ostler:join-share',
  JOIN_SHARE_CHOOSE_FOLDER: 'ostler:join-share-choose-folder',
  LEAVE_SHARE: 'ostler:leave-share',
  SYNC_SHARE_NOW: 'ostler:sync-share-now',
  REMOVE_SHARE_MEMBER: 'ostler:remove-share-member',
  STOP_OLD_INVITES: 'ostler:stop-old-invites',
  REMOVE_SHARE_PERSON: 'ostler:remove-share-person',
  SET_SHARE_ROLE: 'ostler:set-share-role',
  GET_PERSON_LINKS: 'ostler:get-person-links',
  ANSWER_PERSON_LINK: 'ostler:answer-person-link',
  // The personal space: this person's devices (people and devices, D13, D16, D20)
  GET_PERSONAL_SPACE: 'ostler:get-personal-space',
  GET_R2_SYNC: 'ostler:get-r2-sync',
  SET_R2_SYNC: 'ostler:set-r2-sync',
  TEST_R2_SYNC: 'ostler:test-r2-sync',
  CLEAR_R2_SYNC: 'ostler:clear-r2-sync',
  R2_SYNC_NOW: 'ostler:r2-sync-now',
  EXPORT_R2_SETUP: 'ostler:export-r2-setup',
  IMPORT_R2_SETUP: 'ostler:import-r2-setup',
  CREATE_PERSONAL_SPACE: 'ostler:create-personal-space',
  REQUEST_PAIRING: 'ostler:request-pairing',
  CHOOSE_PERSONAL_SPACE: 'ostler:choose-personal-space',
  CANCEL_PAIRING: 'ostler:cancel-pairing',
  START_NEW_PERSONAL_SPACE: 'ostler:start-new-personal-space',
  ALLOW_DEVICE: 'ostler:allow-device',
  REMOVE_DEVICE: 'ostler:remove-device',
  LIST_ACCOUNTS: 'ostler:list-accounts',
  LIST_ACCOUNT_PROVIDERS: 'ostler:list-account-providers',
  CONNECT_ACCOUNT: 'ostler:connect-account',
  ADD_ACCOUNT_CAPABILITIES: 'ostler:add-account-capabilities',
  DISCONNECT_ACCOUNT: 'ostler:disconnect-account',
  SET_ACCOUNT_APP: 'ostler:set-account-app',
  REMOVE_ACCOUNT_APP: 'ostler:remove-account-app',
  ON_ACCOUNTS_CHANGE: 'ostler:on-accounts-change',
  LIST_ACCOUNT_CALENDARS: 'ostler:list-account-calendars',
  ADD_ACCOUNT_CALENDAR: 'ostler:add-account-calendar',
  READ_ACCOUNT_CONTACTS: 'ostler:read-account-contacts',
  READ_CLOUD_FILE: 'ostler:read-cloud-file',
  LIST_WEBHOOKS: 'ostler:list-webhooks',
  ADD_WEBHOOK: 'ostler:add-webhook',
  UPDATE_WEBHOOK: 'ostler:update-webhook',
  REMOVE_WEBHOOK: 'ostler:remove-webhook',
  TEST_WEBHOOK: 'ostler:test-webhook',
  GET_CALENDAR_WRITE_TARGET: 'ostler:get-calendar-write-target',
  SET_CALENDAR_WRITE_TARGET: 'ostler:set-calendar-write-target',
  LIST_TASK_LISTS: 'ostler:list-task-lists',
  GET_TASK_LIST_TARGET: 'ostler:get-task-list-target',
  SET_TASK_LIST_TARGET: 'ostler:set-task-list-target',
  GET_POLICY: 'ostler:get-policy',
  GET_SYNC_SERVER: 'ostler:get-sync-server',
  SET_SYNC_SERVER: 'ostler:set-sync-server',
  CLEAR_SYNC_SERVER: 'ostler:clear-sync-server',
  SHARE_PROJECT_ON_SERVER: 'ostler:share-project-on-server',
  SHARE_PROJECT_ON_DRIVE: 'ostler:share-project-on-drive',
  GET_DRIVE_SHARING_READY: 'ostler:get-drive-sharing-ready',
  GRANT_DRIVE_ACCESS: 'ostler:grant-drive-access',

  // Code workspace (embedded file browser/editor/command runner)
  CODE_LIST_DIRECTORY: 'ostler:code-list-directory',
  CODE_READ_FILE: 'ostler:code-read-file',
  CODE_WRITE_FILE: 'ostler:code-write-file',
  CODE_RUN_COMMAND: 'ostler:code-run-command',
  CODE_CANCEL_COMMAND: 'ostler:code-cancel-command',

  // Project Library
  LIBRARY_LIST_ITEMS: 'ostler:library-list-items',
  LIBRARY_GET_ITEM: 'ostler:library-get-item',
  LIBRARY_GET_ITEM_TEXT: 'ostler:library-get-item-text',
  LIBRARY_CREATE_ITEM: 'ostler:library-create-item',
  LIBRARY_UPDATE_ITEM: 'ostler:library-update-item',
  LIBRARY_SET_PRIMARY_BRIEF: 'ostler:library-set-primary-brief',
  LIBRARY_ARCHIVE_ITEM: 'ostler:library-archive-item',
  LIBRARY_UNARCHIVE_ITEM: 'ostler:library-unarchive-item',
  LIBRARY_DELETE_ITEM: 'ostler:library-delete-item',
  LIBRARY_LIST_REVISIONS: 'ostler:library-list-revisions',
  LIBRARY_RESTORE_REVISION: 'ostler:library-restore-revision',
  LIBRARY_IMPORT_FILES: 'ostler:library-import-files',
  LIBRARY_PICK_FILES: 'ostler:library-pick-files',
  LIBRARY_IMPORT_CLIPBOARD: 'ostler:library-import-clipboard',
  LIBRARY_OPEN_EXTERNALLY: 'ostler:library-open-externally',
  LIBRARY_ADD_WORK_ITEM_SOURCE: 'ostler:library-add-work-item-source',
  LIBRARY_REMOVE_WORK_ITEM_SOURCE: 'ostler:library-remove-work-item-source',
  LIBRARY_LIST_WORK_ITEM_SOURCES: 'ostler:library-list-work-item-sources',
  LIBRARY_LIST_CHANGED_SOURCE_WORK_ITEMS: 'ostler:library-list-changed-source-work-items',
  LIBRARY_COUNT_WORK_ITEM_ATTACHMENTS: 'ostler:library-count-work-item-attachments',
  LIBRARY_LIST_ITEM_WORK_ITEMS: 'ostler:library-list-item-work-items',
  LIBRARY_ATTACH_TO_WORK_ITEM: 'ostler:library-attach-to-work-item',
  LIBRARY_DETACH_FROM_WORK_ITEM: 'ostler:library-detach-from-work-item',
  LIBRARY_LIST_WORK_ITEM_ATTACHMENTS: 'ostler:library-list-work-item-attachments',
  LIBRARY_LIST_ITEM_ATTACHMENTS: 'ostler:library-list-item-attachments',
  LIBRARY_GET_AI_CONTEXT_SUMMARY: 'ostler:library-get-ai-context-summary',
  LIBRARY_TEXT_PROGRESS: 'ostler:library-text-progress',

  // Whiteboards (Library items of kind 'whiteboard')
  WHITEBOARD_CREATE: 'ostler:whiteboard-create',
  WHITEBOARD_GET: 'ostler:whiteboard-get',
  WHITEBOARD_SAVE: 'ostler:whiteboard-save',
  MAKE_WHITEBOARD_TASKS: 'ostler:make-whiteboard-tasks',
  UNDO_WHITEBOARD_TASKS: 'ostler:undo-whiteboard-tasks',
  SAVE_WHITEBOARD_IMAGE: 'ostler:save-whiteboard-image',
  EXPORT_WHITEBOARD_FILE: 'ostler:export-whiteboard-file',
  IMPORT_WHITEBOARD_FILE: 'ostler:import-whiteboard-file',
  PRINT_WHITEBOARD: 'ostler:print-whiteboard',

  // Subscriptions (main → renderer events)
  ON_WATCH_EVENT: 'ostler:on-watch-event',
  ON_AI_STREAM_CHUNK: 'ostler:on-ai-stream-chunk',
  ON_PROJECT_STATE_CHANGE: 'ostler:on-project-state-change',
  ON_NOTIFICATION: 'ostler:on-notification',
  ON_TASK_SPLIT_PROGRESS: 'ostler:on-task-split-progress',
  ON_ASK_OSTLER_PROGRESS: 'ostler:on-ask-ostler-progress',
  ON_TRY_RUN_CHANGED: 'ostler:on-try-run-changed',
  ON_CODE_COMMAND_OUTPUT: 'ostler:on-code-command-output',
  ON_WINDOWS_ACCENT_CHANGED: 'ostler:on-windows-accent-changed',
  ON_LOCALE_CHANGED: 'ostler:on-locale-changed',
  ON_NAVIGATE: 'ostler:on-navigate',
  ON_APP_COMMAND: 'ostler:on-app-command',
  ON_UPDATE_STATE: 'ostler:on-update-state',
  ON_TIME_CHANGE: 'ostler:on-time-change',
  ON_FOCUS_CHANGE: 'ostler:on-focus-change',
  ON_FLUSH_EDITS: 'ostler:on-flush-edits',
  ON_OPEN_IN_MAIN_WINDOW: 'ostler:on-open-in-main-window',
  NEW_TASK_WINDOW_OPEN: 'ostler:new-task-window-open',
  TASK_WINDOW_OPEN: 'ostler:task-window-open',
  NEW_TASK_WINDOW_TAKE: 'ostler:new-task-window-take',
  NEW_TASK_WINDOW_RETURN: 'ostler:new-task-window-return',
  NEW_TASK_WINDOW_TAKE_RETURNED: 'ostler:new-task-window-take-returned',
  ON_NEW_TASK_RETURNED: 'ostler:on-new-task-returned',

  // Windows integration (P8.2)
  SET_MENU_CONTEXT: 'ostler:set-menu-context',
  POPUP_APP_MENU: 'ostler:popup-app-menu',
  GET_WINDOW_CHROME: 'ostler:get-window-chrome',
  WINDOW_CONTROL: 'ostler:window-control',
  GET_WINDOW_STATE: 'ostler:get-window-state',
  ON_WINDOW_STATE: 'ostler:on-window-state',
  EDITS_FLUSHED: 'ostler:edits-flushed',

  // Pop out a view (N5.8a)
  POP_OUT_OPEN: 'ostler:pop-out-open',
  POP_OUT_GET: 'ostler:pop-out-get',
  POP_OUT_SET_REOPEN: 'ostler:pop-out-set-reopen',
  POP_OUT_OPEN_IN_MAIN: 'ostler:pop-out-open-in-main',
  STICKY_PIN: 'ostler:sticky-pin',
  STICKY_UNPIN: 'ostler:sticky-unpin',
  STICKY_GET: 'ostler:sticky-get',
  STICKY_RELEASE_FOCUS: 'ostler:sticky-release-focus',

  // Snip to task (N4.2a)
  SNIP_START: 'ostler:snip-start',
  SNIP_GET_PICTURE: 'ostler:snip-get-picture',
  SNIP_SELECT: 'ostler:snip-select',
  SNIP_CANCEL: 'ostler:snip-cancel',
  SNIP_SAVE: 'ostler:snip-save',
  SNIP_DISCARD: 'ostler:snip-discard',
  // Mark up a picture (N4.2b)
  SNIP_GET_FULL_PICTURE: 'ostler:snip-get-full-picture',
  SNIP_REPLACE: 'ostler:snip-replace',
  LIBRARY_GET_IMAGE: 'ostler:library-get-image',
  LIBRARY_SAVE_MARKED_UP_COPY: 'ostler:library-save-marked-up-copy',

  // Performance (P9.1)
  APP_FIRST_SCREEN: 'ostler:app-first-screen'
} as const

// ─── OstlerAPI Interface (exposed via contextBridge) ─────────────────────────

/**
 * The complete API surface exposed to the renderer via contextBridge.
 * Every method returns Result<T> — never throws across the IPC bridge.
 */
export interface OstlerAPI {
  // --- Projects ---
  getProjects(): Promise<Result<RendererProject[]>>
  getNewProjectDefaults(): Promise<Result<NewProjectDefaults>>
  checkNewProjectLocation(
    parentPath: string,
    folderName: string
  ): Promise<Result<NewProjectLocationCheck>>
  /**
   * Creates a project with no folder, an existing folder, or a new folder
   * (which it creates and may scaffold and `git init`) (D4).
   */
  createProject(request: NewProjectRequest): Promise<Result<NewProjectResult>>
  // --- Templates (P5.8) ---
  /** Built-in templates (the sample project among them), then saved ones. */
  listProjectTemplates(): Promise<Result<ProjectTemplateSummary[]>>
  /** "Save as template…": saved to `<dataDir>/templates/`. */
  saveProjectAsTemplate(
    projectId: string,
    input: SaveProjectTemplateInput
  ): Promise<Result<ProjectTemplateSummary>>
  renameProjectTemplate(templateId: string, name: string): Promise<Result<ProjectTemplateSummary>>
  /** Deletes a saved template; the package it returns is what Undo restores. */
  deleteProjectTemplate(templateId: string): Promise<Result<ProjectPackage>>
  restoreProjectTemplate(
    templateId: string,
    pkg: ProjectPackage
  ): Promise<Result<ProjectTemplateSummary>>
  /** Saves the template's package file where the person chooses; null when cancelled. */
  exportProjectTemplateFile(templateId: string): Promise<Result<string | null>>
  /** "Import template…": a package file the person picks, kept as a saved template; null when cancelled. */
  importTemplateFile(): Promise<Result<ProjectTemplateSummary | null>>
  // --- Import and export (P6.1) ---
  /** Main shows the picker and reads the file (or an export folder from an earlier version); null when cancelled. */
  pickImportFile(mode: 'file' | 'folder'): Promise<Result<ImportFileInfo | null>>
  /** Lets main drop a picked file it holds (the import dialog closed). */
  forgetImportFile(fileId: string): Promise<Result<void>>
  /** Opens a password-protected project file main holds (N45); a wrong password leaves it held. */
  unlockImportFile(fileId: string, password: string): Promise<Result<ImportFileInfo>>
  /** The dry run: mapping, the first 50 rows and every row's problems. Writes nothing. */
  previewCsvImport(
    fileId: string,
    options: CsvImportOptions,
    projectId: string | null
  ): Promise<Result<CsvImportPreview>>
  previewTrelloImport(
    fileId: string,
    options: TrelloImportOptions,
    projectId: string | null
  ): Promise<Result<TrelloImportPreview>>
  /** Imports in one transaction; a package always lands as a new project. */
  runImport(
    fileId: string,
    request: ImportRequest,
    target: ImportTarget
  ): Promise<Result<ImportResult>>
  /** Every import into a registered project, newest first (Settings › Data). */
  listImportBatches(): Promise<Result<ImportBatch[]>>
  /** What Undo import would move, and which tasks changed since. */
  checkUndoImport(batchId: string): Promise<Result<ImportUndoCheck>>
  /** Moves the import's tasks to the recycle bin; changed ones only with `includeChanged`. */
  undoImport(batchId: string, includeChanged: boolean): Promise<Result<ImportUndoResult>>
  /** Undoes Undo import: those tasks come back from the recycle bin. */
  restoreImport(batchId: string, taskIds: string[]): Promise<Result<ImportBatch>>
  // --- GitHub (R4.4, D40): read only, and only on the person's action ---
  /** Import tasks › From GitHub issues: reads the issues and holds them like a picked file. */
  loadGithubIssues(query: GithubIssueQuery): Promise<Result<ImportFileInfo>>
  /** The dry run: issues a task in the project already links are skipped. Writes nothing. */
  previewGithubImport(
    fileId: string,
    projectId: string | null
  ): Promise<Result<GithubImportPreview>>
  /** Fetches a task's links again (the drawer opened, or Refresh). */
  refreshGithubLinks(projectId: string, workItemId: string): Promise<Result<GithubLinksRefresh>>
  /** Links a task to a github.com URL, `owner/repo#12` or `#12`, and fetches it. */
  addGithubLink(
    projectId: string,
    workItemId: string,
    reference: string
  ): Promise<Result<GithubLinkAdded>>
  /** Removes a link; the result is what `restoreGithubLink` puts back. */
  removeGithubLink(projectId: string, linkId: string): Promise<Result<GithubLink>>
  restoreGithubLink(projectId: string, link: GithubLink): Promise<Result<GithubLink>>
  /** `owner/repo` when the linked folder's origin remote is on GitHub (read-only Git), else null. */
  suggestGithubRepository(projectId: string): Promise<Result<string | null>>
  /** Exports to a `<project>.ostler-project` file (a zip, D29) the person names; its path, or null. */
  exportProject(projectId: string, options: ProjectExportOptions): Promise<Result<string | null>>
  /** Tasks as CSV (UTF-8 with a BOM) to a file the person names; its path, or null. */
  exportTasksCsv(projectId: string, request: TaskCsvExportRequest): Promise<Result<string | null>>
  /**
   * Edit in Excel (N2.8): the tasks as CSV with their IDs, saved where the
   * person picks (Documents by default) and opened in the default app; null
   * when the save was cancelled.
   */
  editInExcel(
    projectId: string,
    request: TaskCsvExportRequest
  ): Promise<Result<EditInExcelFile | null>>
  /**
   * Bring changes back's preview: the file Edit in Excel wrote (`editId`), or
   * another the person picks (`null`; null back when they cancel). Writes nothing.
   */
  previewBringBack(
    projectId: string,
    editId: string | null
  ): Promise<Result<BringBackPreview | null>>
  /** Applies the ticked changes and new rows of a previewed file. */
  applyBringBack(
    projectId: string,
    fileId: string,
    request: CsvUpdateApplyRequest
  ): Promise<Result<CsvUpdateResult>>
  /** Bring changes back's undo: puts every task's old values back. */
  restoreTaskValues(projectId: string, restores: TaskValuesRestore[]): Promise<Result<number>>
  /** Due dates as an iCalendar `.ics` file the person names (D37); its path, or null. */
  exportCalendarFile(
    projectId: string,
    options: CalendarExportOptions
  ): Promise<Result<string | null>>
  /** The Timeline as PowerPoint slides (`.pptx`, N54) the person names; its path, or null. */
  exportTimelineSlides(
    projectId: string,
    options: TimelineSlidesExportOptions
  ): Promise<Result<string | null>>
  /** The project as one self-contained `.html` page the person names (D37); its path, or null. */
  exportShareReport(projectId: string, options: ShareReportOptions): Promise<Result<string | null>>
  /** Prints List, Overview or Timeline in full, or saves it as a PDF; the PDF's path, or null. */
  printProjectView(projectId: string, request: PrintRequest): Promise<Result<string | null>>
  /** Prints my week (Home's Today and Upcoming, N3.1b), or saves it as a PDF; the PDF's path, or null. */
  printMyWeek(request: MyWeekPrintRequest): Promise<Result<string | null>>
  /** Prints Your year (N3.6), or saves it as a PDF; the PDF's path, or null. */
  printYearInReview(request: YearInReviewPrintRequest): Promise<Result<string | null>>
  /** Prints the Timeline across projects (N5.4) with every row, or saves it as a PDF; the PDF's path, or null. */
  printTimelineOverview(request: TimelineOverviewPrintRequest): Promise<Result<string | null>>
  /** Prints Compare rounds (N5.7b) with every round and task, or saves it as a PDF; the PDF's path, or null. */
  printRoundComparison(request: RoundComparisonPrintRequest): Promise<Result<string | null>>
  /** Saves Compare rounds' table (N5.7b) as CSV where the person picks; its path, or null. */
  exportRoundComparisonCsv(
    request: Omit<RoundComparisonPrintRequest, 'output'>
  ): Promise<Result<string | null>>
  /** Links a folder to a project without one; refused if agent history came from another folder. */
  linkProjectFolder(id: string, path: string): Promise<Result<RendererProject>>
  /** Unlinks the project's folder; refused while agent work is queued, open or in review. */
  unlinkProjectFolder(id: string): Promise<Result<RendererProject>>
  removeProject(id: string): Promise<Result<ProjectRemoval>>
  getProjectRemovalInventory(id: string): Promise<Result<ProjectRemovalInventory>>
  /**
   * Writes the archive into the project's folder, or, for a project with no
   * folder, where the human picks in a save dialog (null when they cancel).
   */
  archiveProjectData(id: string): Promise<Result<ProjectRemovalArchive | null>>
  /** Irreversible: deletes every Ostler-held record and directory, then forgets the project. */
  purgeProjectData(id: string): Promise<Result<ProjectRemovalPurge>>
  /** The demo projects there are, and what the person added to them. */
  getDemoProjects(): Promise<Result<DemoProjectsStatus>>
  /** Irreversible: removes every demo project, as Remove permanently does, with no backup. Returns how many. */
  removeDemoProjects(): Promise<Result<number>>
  /** This project's own backups (project files under the data folder), newest first. */
  listProjectBackups(id: string): Promise<Result<ProjectBackupEntry[]>>
  /** Writes a project file of this project under the data folder, with a checksum file. */
  createProjectBackup(id: string): Promise<Result<ProjectBackupEntry>>
  deleteProjectBackup(id: string, backupId: string): Promise<Result<void>>
  /** Checks a backup against its checksum file. */
  verifyProjectBackup(id: string, backupId: string): Promise<Result<ChecksumVerdict>>
  writeProjectBackupChecksum(id: string, backupId: string): Promise<Result<ProjectBackupEntry>>
  /** Shows the backup in File Explorer. */
  showProjectBackup(id: string, backupId: string): Promise<Result<void>>
  /** Opens a backup as a new project beside this one; nothing in this project changes. */
  openProjectBackup(id: string, backupId: string): Promise<Result<ImportResult>>
  /** Writes `<file>.sha256` beside a file the person picks; null when they cancel. */
  writeChecksumFile(): Promise<Result<ChecksumWritten | null>>
  /** Checks a file the person picks against the `.sha256` beside it; null when they cancel. */
  verifyChecksumFile(): Promise<Result<{ filePath: string; verdict: ChecksumVerdict } | null>>
  /** Read-only: SQLite's check of the database file and this project's broken records. */
  checkProjectRecords(id: string): Promise<Result<ProjectRecordsCheck>>
  /** Backs everything up, then fixes this project's broken records and rebuilds the indexes. */
  repairProjectRecords(id: string): Promise<Result<ProjectRecordsRepair>>
  updateProject(id: string, updates: RendererProjectUpdate): Promise<Result<RendererProject>>
  /**
   * Saves the sidebar order: the named projects take that order in
   * config.projects; projects left out keep their places.
   */
  reorderProjects(orderedIds: string[]): Promise<Result<RendererProject[]>>
  /** The areas (N5.1) in their order. */
  getAreas(): Promise<Result<ProjectArea[]>>
  /**
   * Saves every area, in order (new ones may leave out `id`). A project in an
   * area that is left out moves to "No area"; `assignments` sets projects'
   * areas in the same save (Undo of a removal).
   */
  saveAreas(
    areas: Array<{ id?: string; name: string }>,
    assignments?: Record<string, string | null>
  ): Promise<Result<ProjectArea[]>>
  browseForFolder(title?: string): Promise<Result<string | null>>

  // --- Watcher ---
  getWatcherStatus(): Promise<Result<WatcherStatus>>
  pauseWatcher(projectId: string): Promise<Result<void>>
  resumeWatcher(projectId: string): Promise<Result<void>>

  // --- Events ---
  getRecentEvents(options: EventQuery): Promise<Result<WatchEvent[]>>
  getEventStats(projectId: string, windowMs: number): Promise<Result<EventStats>>
  exportEvents(options: ExportOptions): Promise<Result<string>>

  // --- Git ---
  getGitState(projectId: string): Promise<Result<GitProjectState>>
  getGitLog(projectId: string, limit: number): Promise<Result<GitCommit[]>>
  getGitFileDiff(
    projectId: string,
    commitHash: string,
    filePath: string
  ): Promise<Result<string | null>>
  getGitBranchGraph(projectId: string, maxCount: number): Promise<Result<GitBranchGraph>>

  // --- Harness ---
  getHarnessState(projectId: string): Promise<Result<HarnessProjectState>>
  /** Starts a sandboxed session and atomically claims the selected queued task. */
  startHarnessTaskSession(
    projectId: string,
    taskId: string
  ): Promise<Result<RendererHarnessSession>>
  /**
   * Manual trigger for an Ostler-managed embedded (opencode-backed) session:
   * provisions a slot exactly like `startHarnessTaskSession`, then starts a
   * headless opencode process inside it instead of waiting for an external
   * agent to connect. Additive - never replaces `startHarnessTaskSession`.
   */
  startHarnessEmbeddedSession(
    projectId: string,
    taskId: string
  ): Promise<Result<RendererHarnessSession>>
  updateHarnessSession(
    projectId: string,
    sessionId: string,
    note: string,
    done: boolean
  ): Promise<Result<HarnessSession>>
  addHarnessTask(
    projectId: string,
    title: string,
    details: string,
    priority?: PlanningPriority,
    /** The model and effort for this run (D42); left out, the project's default. */
    runChoice?: AgentRunChoice
  ): Promise<Result<HarnessTask>>
  updateHarnessTask(
    projectId: string,
    taskId: string,
    action: 'claim' | 'release' | 'complete',
    sessionId: string
  ): Promise<Result<HarnessTask>>
  getHarnessReport(projectId: string): Promise<Result<HarnessReport>>
  answerHarnessQuestion(
    projectId: string,
    questionId: string,
    answer: string
  ): Promise<Result<HarnessQuestion>>
  /** A run's plan as it stands, with every version kept for it (N9.3b). */
  getHarnessSessionPlan(projectId: string, sessionId: string): Promise<Result<SessionPlanView>>
  /** Approves a run's waiting plan; already decided, it returns the decision (N9.3b). */
  approveHarnessPlan(projectId: string, sessionId: string): Promise<Result<HarnessPlan>>
  /** Asks for changes to a run's waiting plan, with a note (N9.3b). */
  requestHarnessPlanChanges(
    projectId: string,
    sessionId: string,
    note: string
  ): Promise<Result<HarnessPlan>>
  /** Every plan kept with a task, oldest first (N9.3b). */
  listWorkItemPlans(workItemId: string): Promise<Result<TaskPlanRecord[]>>
  /** Sends the person's message to a running run (D41), labelled as theirs. */
  sendHarnessGuidance(
    projectId: string,
    sessionId: string,
    text: string
  ): Promise<Result<HarnessGuidance>>
  generateAutomationToken(projectId: string): Promise<Result<RendererProject>>
  revokeAutomationToken(projectId: string): Promise<Result<RendererProject>>
  /**
   * Builds the external-agent prompt for a started session (with its token),
   * copies it to the clipboard, and returns the prompt with the token masked.
   */
  copyHarnessSessionPrompt(projectId: string, sessionId: string): Promise<Result<string>>
  /** The Agent Task Prompt card: builds, copies, and returns the masked preview. */
  copyAutomationTaskPrompt(projectId: string, task: string): Promise<Result<string>>
  /** Copies a token's connection text (base URL, token, /help); returns it masked. */
  copyProjectConnection(projectId: string, kind: ProjectTokenKind): Promise<Result<string>>
  /** One token, on demand, for an explicit Reveal action. */
  revealProjectToken(projectId: string, kind: ProjectTokenKind): Promise<Result<string>>
  /** How to connect an AI assistant over MCP (D39), with the token masked. */
  describeMcpConnection(projectId: string): Promise<Result<McpConnection>>
  /** Copies an MCP client configuration; returns it masked. */
  copyMcpClientConfig(projectId: string, form: McpClientForm): Promise<Result<string>>
  /** What a new workspace's setup would run for this project's folder (Automatic mode); read-only. */
  describeProjectSetup(projectId: string): Promise<Result<ResolvedSetup>>
  cancelHarnessTask(projectId: string, taskId: string): Promise<Result<HarnessTaskPlanningUpdate>>
  reorderHarnessTasks(projectId: string, orderedTaskIds: string[]): Promise<Result<HarnessTask[]>>
  setHarnessTaskPriority(
    projectId: string,
    taskId: string,
    priority: PlanningPriority
  ): Promise<Result<HarnessTaskPlanningUpdate>>
  setHarnessTaskAutoContinue(
    projectId: string,
    taskId: string,
    enabled: boolean
  ): Promise<Result<HarnessTaskPlanningUpdate>>
  /**
   * Stop: ends a running agent, keeps its work so it can be brought back, and
   * puts its task back in the queue (simplify pass §3.3).
   */
  stopHarnessSession(projectId: string, sessionId: string): Promise<Result<HarnessSession>>
  /**
   * Apply (§3.2): brings the task up to date, saves the person's edits, makes
   * a restore point, and adds the work to the project folder as one entry per
   * task. `onCurrentVersion` answers "Apply to the current version" when the
   * folder switched versions since the task started (§4).
   */
  applyHarnessTaskWork(
    projectId: string,
    sessionId: string,
    onCurrentVersion?: boolean
  ): Promise<Result<HarnessApplyResult>>
  /** Discard (§3.3): deletes the copy, keeps its work for Bring back. */
  discardHarnessTaskWork(projectId: string, sessionId: string): Promise<Result<HarnessSession>>
  /** Try it (N9.4): a session's run, or null when it has none. */
  getTryRun(projectId: string, sessionId: string): Promise<Result<TryRun | null>>
  /**
   * Runs the project's try command in a finished task's copy, after its setup
   * when that has not finished. `acknowledged` says the person accepted the
   * warning just now; the first run in a project is refused without it.
   */
  startTryRun(projectId: string, sessionId: string, acknowledged: boolean): Promise<Result<TryRun>>
  /** Stops the run and everything still running from the copy. */
  stopTryRun(projectId: string, sessionId: string): Promise<Result<TryRun | null>>
  /** Puts back only the files the run changed. */
  undoTryLeftFiles(projectId: string, sessionId: string): Promise<Result<TryRun>>
  /** Keeps the files the run changed, and stops listing them. */
  keepTryLeftFiles(projectId: string, sessionId: string): Promise<Result<TryRun>>
  /** Opens a local address from Try it's output in the default browser; any other is refused. */
  openTryAddress(url: string): Promise<Result<void>>
  /** Triage (N4.3a): Accept, with the fields set first; Backlog unless a status is given. */
  acceptTriagedWorkItem(
    projectId: string,
    workItemId: string,
    fields?: TriageAcceptFields
  ): Promise<Result<PlanningWorkItem>>
  /** Accepts every task waiting in To triage into the Backlog; returns how many. */
  acceptAllTriagedWorkItems(projectId: string): Promise<Result<number>>
  /** Moves a task in To triage to another project's To triage, Library attachments too. */
  moveTriagedWorkItem(
    projectId: string,
    workItemId: string,
    toProjectId: string
  ): Promise<Result<TriageMoveResult>>
  /** Undoes a move: `projectId` is the original's project. */
  undoTriageMove(projectId: string, move: TriageMoveResult): Promise<Result<PlanningWorkItem>>
  /** To triage in one call: the waiting tasks, oldest first, and each one's first picture. */
  getTriage(projectId: string): Promise<Result<TriageList>>
  /**
   * What each project holds that its views care about: which views earn a tab,
   * and whether To triage is offered with the setting off.
   */
  getProjectUsage(): Promise<Result<ProjectUsage>>
  /**
   * Suggest (N4.3b): a priority, labels and likely duplicates for a task in
   * To triage, from Ostler AI over candidates Ostler's search found. Saves nothing.
   */
  suggestTriage(projectId: string, workItemId: string): Promise<Result<TriageSuggestion>>
  /** Send back (§3.3): the task returns to its agent with a note, in the same copy. */
  sendBackHarnessTaskWork(
    projectId: string,
    sessionId: string,
    reason: string,
    disposition: HarnessTaskRejection['disposition'],
    /** "Run again with…" (D42): the next run's model and effort. Only with `retry`. */
    runAgainWith?: AgentRunChoice
  ): Promise<Result<HarnessSession>>
  /**
   * Keeps draft line comments with a session in review (N9.2a), replacing the
   * list. Send back carries them; Apply, Discard and Stop drop them.
   */
  saveHarnessReviewDrafts(
    projectId: string,
    sessionId: string,
    drafts: HarnessReviewComment[]
  ): Promise<Result<HarnessSession>>
  /**
   * Ask a reviewer (N9.5b): starts a review of a session in review, a second
   * run queued ahead of other work that changes nothing. Refused for a review
   * run, work not in review, or one already being reviewed.
   */
  startHarnessReview(projectId: string, sessionId: string): Promise<Result<HarnessTask>>
  /** Dismisses one of the reviewer's findings on a session, or brings it back (N9.5b). */
  dismissHarnessReviewFinding(
    projectId: string,
    sessionId: string,
    findingId: string,
    dismissed: boolean
  ): Promise<Result<HarnessSession>>
  /** Bring back (§3.3): recreates discarded work's copy and puts it up for review again. */
  bringBackHarnessTaskWork(projectId: string, sessionId: string): Promise<Result<HarnessSession>>
  /** The History view (§3.5). */
  getProjectHistory(
    projectId: string,
    filter?: ProjectHistoryFilter
  ): Promise<Result<ProjectHistory>>
  /** Undo entries as one new entry; refused with the later entries that changed the same lines. */
  undoHistoryEntries(projectId: string, entryIds: string[]): Promise<Result<ProjectUndoResult>>
  /** Sets the project folder back to how it was at an entry, as a new entry. */
  restoreHistoryEntry(projectId: string, entryId: string): Promise<Result<ProjectHistoryEntry>>
  /** Space agent copies and kept history use (Settings › Data). */
  getAgentStorage(): Promise<Result<AgentStorageUsage>>
  /** Deletes the files kept from the agent setup before the update (Settings › Data). */
  removeLegacyAgentFiles(): Promise<Result<AgentStorageUsage>>
  /** Runs the move from the old agent setup again for a project whose move needs attention (§6). */
  retryLegacyMigration(projectId: string): Promise<Result<void>>
  /** Read-only: the changes in a task's copy, and whether the folder switched versions. */
  getHarnessSessionDiff(projectId: string, sessionId: string): Promise<Result<HarnessSessionDiff>>
  getProjectAutoDispatchConfig(projectId: string): Promise<Result<ProjectAutoDispatchConfig>>
  /** The guided agent setup's checks: Git, Ostler AI and the bundled agent runtime (P7.2). */
  checkAgentRequirements(): Promise<Result<AgentRequirements>>
  /** The Agents view's Recent runs: finished agent runs, newest first. */
  listRecentAgentRuns(projectId: string): Promise<Result<RecentAgentRun[]>>
  /** The Agents view's History (R5.3): runs that pass the filter, totals and a breakdown by model. */
  getAgentRunHistory(projectId: string, filter: AgentRunFilter): Promise<Result<AgentRunHistory>>
  /** Saves the filtered history as CSV; the file's path, or null when the person cancelled. */
  exportAgentRunHistory(projectId: string, filter: AgentRunFilter): Promise<Result<string | null>>
  /** How much of each token limit the built-in agent has used (D43). */
  getAgentUsage(projectId: string): Promise<Result<AgentUsageStatus>>
  updateProjectAutoDispatchConfig(
    projectId: string,
    updates: Partial<ProjectAutoDispatchConfig>
  ): Promise<Result<ProjectAutoDispatchConfig>>
  setHarnessTaskHold(projectId: string, taskId: string, hold: boolean): Promise<Result<HarnessTask>>
  /**
   * The model and effort for a queued task's run (D42); '' is the default.
   * Refused once a run has taken the task, and checked as Settings checks it.
   */
  setHarnessTaskRunModel(
    projectId: string,
    taskId: string,
    choice: AgentRunChoice
  ): Promise<Result<HarnessTask>>
  getHarnessSessionTranscript(
    projectId: string,
    sessionId: string
  ): Promise<Result<SessionTranscriptEntry[]>>

  // --- AI Chat ---
  sendMessage(
    conversationId: string,
    message: string,
    projectScope: string | null,
    /** Library items attached to this message (project notes chat only). */
    selectedItemIds?: string[]
  ): Promise<Result<void>>
  getConversations(): Promise<Result<AIConversation[]>>
  getConversation(id: string): Promise<Result<AIConversation | null>>
  createConversation(title?: string, projectId?: string | null): Promise<Result<AIConversation>>
  deleteConversation(id: string): Promise<Result<void>>
  /** Saves an AI-authored project status note outside the watched project directory. */
  saveProjectStatusNote(projectId: string, content: string): Promise<Result<string>>
  /** Tests the saved settings, or a connection being set up (`draft`). */
  testAIConnection(draft?: AIConnectionDraft): Promise<Result<AIConnectionTest>>
  /** Asks the provider which models the key can use: the saved settings, or `draft`. */
  listAIModels(draft?: AIConnectionDraft): Promise<Result<AIModelInfo[]>>
  /** The effort levels the model takes, from its provider; may send one-word test requests. */
  getAIModelEffortSupport(draft?: AIConnectionDraft): Promise<Result<AIModelEffortSupport>>
  /**
   * "Find it": asks a local provider (Ollama, LM Studio) at its one default
   * address which models it has. Only on this call; nothing scans by itself.
   */
  findLocalAI(presetId: string): Promise<Result<LocalAiDetection>>
  /** Opens a provider's official download or key page (its preset's https link) in the browser. */
  openAIProviderPage(presetId: string): Promise<Result<void>>
  /** "Ostler AI can read this project" and its profile (Auto, Software, General). */
  getProjectAISettings(projectId: string): Promise<Result<ProjectAiSettings>>
  updateProjectAISettings(
    projectId: string,
    updates: { access?: boolean; profileSetting?: ProjectAiSettings['profileSetting'] }
  ): Promise<Result<ProjectAiSettings>>
  /**
   * Cancels every in-flight AI request, ends every running embedded agent
   * session, and holds automatic dispatch off until `resumeAI`.
   */
  emergencyStopAI(): Promise<Result<AIHaltState>>
  resumeAI(): Promise<Result<AIHaltState>>
  getAIHaltState(): Promise<Result<AIHaltState>>

  // --- Planning ---
  getPlanningGoals(projectId: string): Promise<Result<PlanningGoal[]>>
  createPlanningGoal(
    projectId: string,
    input: CreatePlanningGoalInput
  ): Promise<Result<PlanningGoal>>
  updatePlanningGoal(
    goalId: string,
    updates: UpdatePlanningGoalInput
  ): Promise<Result<PlanningGoal>>
  deletePlanningGoal(goalId: string): Promise<Result<void>>
  getPlanningMilestones(projectId: string): Promise<Result<PlanningMilestone[]>>
  createPlanningMilestone(
    projectId: string,
    input: CreatePlanningMilestoneInput
  ): Promise<Result<PlanningMilestone>>
  updatePlanningMilestone(
    milestoneId: string,
    updates: UpdatePlanningMilestoneInput
  ): Promise<Result<PlanningMilestone>>
  /** Archived tasks are left without the milestone; live ones too with `detachTasks`, else it refuses. */
  deletePlanningMilestone(
    milestoneId: string,
    options?: { detachTasks?: boolean }
  ): Promise<Result<void>>
  /** Repeat this round (N5.7a): sets the schedule, or with null stops repeating. */
  setMilestoneRepeat(
    milestoneId: string,
    input: MilestoneRepeatInput | null
  ): Promise<Result<PlanningMilestone>>
  /** What the next round would be with this schedule (N5.7a). */
  previewMilestoneRound(
    milestoneId: string,
    input: MilestoneRepeatInput
  ): Promise<Result<MilestoneRoundPreview>>
  /** Start next round now (N5.7a): returns the new round. */
  startNextMilestoneRound(milestoneId: string): Promise<Result<PlanningMilestone>>
  /** A project's iterations (R6.1, D44), oldest first. */
  getPlanningIterations(projectId: string): Promise<Result<PlanningIteration[]>>
  createPlanningIteration(
    projectId: string,
    input: CreatePlanningIterationInput
  ): Promise<Result<PlanningIteration>>
  updatePlanningIteration(
    iterationId: string,
    updates: UpdatePlanningIterationInput
  ): Promise<Result<PlanningIteration>>
  /** Makes it the active iteration; refused while another is active. */
  startPlanningIteration(iterationId: string): Promise<Result<PlanningIteration>>
  /** Finishes the active iteration, moving unfinished tasks to the next one or to none. */
  finishPlanningIteration(
    iterationId: string,
    carryOver: PlanningIterationCarryOver
  ): Promise<Result<PlanningIterationFinish>>
  /** Deletes it; its tasks keep everything but the iteration. Pass the result to restore. */
  deletePlanningIteration(iterationId: string): Promise<Result<PlanningIterationDeletion>>
  restorePlanningIteration(deletion: PlanningIterationDeletion): Promise<Result<PlanningIteration>>
  /** A project's task types (N2.7a, N22), in its order. */
  getPlanningTaskTypes(projectId: string): Promise<Result<PlanningTaskType[]>>
  createPlanningTaskType(
    projectId: string,
    input: CreatePlanningTaskTypeInput
  ): Promise<Result<PlanningTaskType>>
  updatePlanningTaskType(
    typeId: string,
    updates: UpdatePlanningTaskTypeInput
  ): Promise<Result<PlanningTaskType>>
  /** Puts every one of the project's types in this order. */
  reorderPlanningTaskTypes(
    projectId: string,
    typeIds: string[]
  ): Promise<Result<PlanningTaskType[]>>
  /** Deletes it and clears it from its tasks. Pass the result to restore. */
  deletePlanningTaskType(typeId: string): Promise<Result<PlanningTaskTypeDeletion>>
  restorePlanningTaskType(deletion: PlanningTaskTypeDeletion): Promise<Result<PlanningTaskType>>
  /** A project's workstreams (sub-projects), archived ones included, in their order. */
  listSubprojects(projectId: string): Promise<Result<PlanningSubproject[]>>
  /** Adds a workstream; its colour defaults to the project's. */
  createSubproject(
    projectId: string,
    input: CreatePlanningSubprojectInput
  ): Promise<Result<PlanningSubproject>>
  updateSubproject(
    id: string,
    input: UpdatePlanningSubprojectInput
  ): Promise<Result<PlanningSubproject>>
  /** Moves it one place earlier (-1) or later (1); returns the project's list. */
  moveSubproject(id: string, direction: -1 | 1): Promise<Result<PlanningSubproject[]>>
  archiveSubproject(id: string, archived: boolean): Promise<Result<PlanningSubproject>>
  /** Deletes it; its tasks and milestones go to the top level of the project. */
  deleteSubproject(id: string): Promise<Result<PlanningSubproject>>
  /** A project's rules (R6.2, D45), oldest first: the order they run in. */
  getPlanningRules(projectId: string): Promise<Result<PlanningRule[]>>
  createPlanningRule(
    projectId: string,
    input: CreatePlanningRuleInput
  ): Promise<Result<PlanningRule>>
  /** Any of name, enabled (the on and off switch), trigger, conditions and actions. */
  updatePlanningRule(
    ruleId: string,
    updates: UpdatePlanningRuleInput
  ): Promise<Result<PlanningRule>>
  /** Deletes a rule; what it already did stays. Pass the result to restore. */
  deletePlanningRule(ruleId: string): Promise<Result<PlanningRuleDeletion>>
  restorePlanningRule(deletion: PlanningRuleDeletion): Promise<Result<PlanningRule>>
  /** "Try it on a task…": what these conditions and actions would do to one task, doing nothing. */
  previewPlanningRule(
    projectId: string,
    rule: Pick<CreatePlanningRuleInput, 'conditions' | 'actions'>,
    workItemId: string
  ): Promise<Result<PlanningRulePreview>>
  /** Task templates (N2.1) this project can use: its own and every project's, by name. */
  getTaskTemplates(projectId: string): Promise<Result<TaskTemplate[]>>
  /** Every task template, for Settings › Projects. */
  getAllTaskTemplates(): Promise<Result<TaskTemplate[]>>
  /** "Save as task template…": the task and its subtasks. A name clash is refused unless `replace`. */
  saveTaskTemplateFromWorkItem(
    workItemId: string,
    input: SaveTaskTemplateFromWorkItemInput
  ): Promise<Result<TaskTemplate>>
  /** Rename, or change scope (`projectId` null for every project). */
  updateTaskTemplate(
    templateId: string,
    updates: UpdateTaskTemplateInput
  ): Promise<Result<TaskTemplate>>
  deleteTaskTemplate(templateId: string): Promise<Result<TaskTemplateDeletion>>
  restoreTaskTemplate(deletion: TaskTemplateDeletion): Promise<Result<TaskTemplate>>
  /** Makes the task and its subtasks in one go, dates counted from today; `overrides` win. */
  useTaskTemplate(
    projectId: string,
    templateId: string,
    overrides?: TaskTemplateOverrides
  ): Promise<Result<TaskTemplateUse>>
  /**
   * Run playbook (N9.6b): makes the task from a playbook and queues it for
   * agents in one step; `input` may change the title and the agent part.
   */
  runPlaybook(
    projectId: string,
    templateId: string,
    input?: RunPlaybookInput
  ): Promise<Result<PlaybookRun>>
  /**
   * The Board's tasks by default: live and not in To triage. Pass 'triage'
   * for To triage, 'archived' or 'deleted' for the archive and recycle bin.
   */
  getPlanningWorkItems(
    projectId: string,
    scope?: PlanningWorkItemScope
  ): Promise<Result<PlanningWorkItem[]>>
  getPlanningWorkItemMetrics(workItemId: string): Promise<Result<PlanningWorkItemMetrics>>
  /** The commits whose messages name a task's ID, newest first (N9.8b). */
  getWorkItemCommits(projectId: string, workItemId: string): Promise<Result<TaskCommit[]>>
  /** Every live task's metrics in a project, by task id, in one call (P9.1). */
  getPlanningProjectWorkItemMetrics(
    projectId: string
  ): Promise<Result<Record<string, PlanningWorkItemMetrics>>>
  getPlanningStatusTransitions(workItemId: string): Promise<Result<PlanningStatusTransition[]>>
  /**
   * When each of a project's work items last changed status, in one call.
   *
   * The board needs exactly this timestamp per card for its aging colour.
   * Asking `getPlanningStatusTransitions` per item meant one IPC round trip
   * and one query for every work item, repeated on every poll.
   */
  getPlanningLatestStatusChanges(projectId: string): Promise<Result<Record<string, number>>>
  getPlanningMilestoneMetrics(milestoneId: string): Promise<Result<PlanningAggregateMetrics>>
  getPlanningReadiness(milestoneId: string): Promise<Result<PlanningReadinessReport>>
  getPlanningProjectMetrics(projectId: string): Promise<Result<PlanningAggregateMetrics>>
  /** The project dashboard for a range (P6.2); the same report as `GET /reports`. */
  getProjectReport(projectId: string, range: ReportRange): Promise<Result<ProjectReport>>
  /** Compare rounds (N5.7b): the series a milestone belongs to; the same as `GET /milestones/:id/rounds`. */
  getRoundComparison(projectId: string, milestoneId: string): Promise<Result<RoundComparison>>
  createPlanningWorkItem(
    projectId: string,
    input: CreatePlanningWorkItemInput
  ): Promise<Result<PlanningWorkItem>>
  /**
   * Creates every task of a plan in one transaction: any refused row creates
   * nothing, and the error names the first refusal.
   */
  createPlanningWorkItemBatch(
    projectId: string,
    rows: PlanningWorkItemBatchRow[]
  ): Promise<Result<PlanningWorkItem[]>>
  /** Checks a plan without writing: every refused row, or an empty list when it would be created. */
  checkPlanningWorkItemBatch(
    projectId: string,
    rows: PlanningWorkItemBatchRow[]
  ): Promise<Result<PlanningWorkItemBatchRowError[]>>
  updatePlanningWorkItem(
    workItemId: string,
    updates: UpdatePlanningWorkItemInput
  ): Promise<Result<PlanningWorkItem>>
  /**
   * Moves a task in the manual order (D31): before or after another task, or
   * to the start or end of a status, and to `placement.status` when given.
   */
  movePlanningWorkItem(
    workItemId: string,
    placement: PlanningWorkItemPlacement
  ): Promise<Result<PlanningWorkItem>>
  /** Moves the item to the recycle bin; it is purged for good after 30 days. */
  deletePlanningWorkItem(workItemId: string): Promise<Result<void>>
  archivePlanningWorkItem(workItemId: string): Promise<Result<PlanningWorkItem>>
  unarchivePlanningWorkItem(workItemId: string): Promise<Result<PlanningWorkItem>>
  /** Closes a task as won't do (N1.2), with its open subtasks when asked. */
  closePlanningWorkItemAsWontDo(
    workItemId: string,
    options: WontDoOptions
  ): Promise<Result<WontDoResult>>
  /** Takes an item out of the recycle bin, back to the Board (or archive). */
  restorePlanningWorkItem(workItemId: string): Promise<Result<PlanningWorkItem>>
  deletePlanningWorkItemForever(workItemId: string): Promise<Result<void>>
  /** A task's links besides waits-on (N2.4), read from its end. */
  getPlanningWorkItemLinks(workItemId: string): Promise<Result<PlanningTaskLink[]>>
  /** The current titles of the items a text links to (N4.4a): one call per rendered text. */
  resolveItemLinks(refs: ItemLinkRef[]): Promise<Result<ItemLinkInfo[]>>
  /** The tasks that task IDs written in a project's text (BRI-26) name; IDs no task has are left out. */
  resolveTaskKeys(
    projectId: string,
    keys: string[]
  ): Promise<Result<Array<{ key: string; id: string }>>>
  /** The texts that link to an item (N4.4a): its Linked from list. */
  getLinkedFrom(kind: LinkTargetKind, id: string): Promise<Result<LinkedFromEntry[]>>
  /**
   * What the live lists in one text show (N4.4c): each `ostler-tasks` block's
   * text, in order, answered in one call per text.
   */
  queryLiveLists(projectId: string, blocks: string[]): Promise<Result<LiveListResult[]>>
  /** A task's earlier descriptions (N2.6), newest first, with their text. */
  getPlanningDescriptionVersions(workItemId: string): Promise<Result<PlanningDescriptionVersion[]>>
  /** Makes a version's text the description, as a change of its own (N2.6). */
  restorePlanningDescriptionVersion(
    workItemId: string,
    versionId: number
  ): Promise<Result<PlanningWorkItem>>
  /** Links this task to another of its project; never affects dates or agents. */
  addPlanningWorkItemLink(
    workItemId: string,
    toWorkItemId: string,
    kind: PlanningLinkKind
  ): Promise<Result<PlanningTaskLink>>
  removePlanningWorkItemLink(workItemId: string, linkId: string): Promise<Result<void>>
  /** Links the task to its original and closes it as won't do, "Duplicate of …" (N2.4). */
  markPlanningWorkItemDuplicate(
    workItemId: string,
    originalId: string
  ): Promise<Result<MarkDuplicateResult>>
  /** Copies a task into Backlog with a "copied from" link back (N2.4). */
  copyPlanningWorkItem(workItemId: string): Promise<Result<CopyWorkItemResult>>
  /** Ticks or unticks one checklist item; the task's status never changes with it. */
  setPlanningChecklistItemChecked(
    workItemId: string,
    criterionText: string,
    checked: boolean
  ): Promise<Result<PlanningWorkItem>>
  /** Sets or clears one checklist item's due date and person (N2.2); a field left out keeps its value. */
  setPlanningChecklistItemDetails(
    workItemId: string,
    criterionText: string,
    details: PlanningChecklistDetailInput
  ): Promise<Result<PlanningWorkItem>>
  /** Renames one checklist item, carrying its tick, due date and person to the new text. */
  renamePlanningChecklistItem(
    workItemId: string,
    from: string,
    to: string
  ): Promise<Result<PlanningWorkItem>>
  /** Every label used in the project, with its colour. */
  getPlanningLabels(projectId: string): Promise<Result<PlanningLabel[]>>
  setPlanningLabelColor(
    projectId: string,
    name: string,
    color: string
  ): Promise<Result<PlanningLabel>>
  /** Renames the label on every task in the project. */
  renamePlanningLabel(projectId: string, from: string, to: string): Promise<Result<PlanningLabel>>
  /** Removes the label from every task; the result is what `restorePlanningLabel` puts back. */
  deletePlanningLabel(projectId: string, name: string): Promise<Result<PlanningLabelDeletion>>
  restorePlanningLabel(
    projectId: string,
    deletion: PlanningLabelDeletion
  ): Promise<Result<PlanningLabel[]>>
  /** The project's custom fields, in order (R2.2). */
  getPlanningFields(projectId: string): Promise<Result<PlanningFieldDefinition[]>>
  createPlanningField(
    projectId: string,
    input: CreatePlanningFieldInput
  ): Promise<Result<PlanningFieldDefinition>>
  /** Renames a field or replaces its options; the type never changes. */
  updatePlanningField(
    projectId: string,
    fieldId: string,
    input: UpdatePlanningFieldInput
  ): Promise<Result<PlanningFieldDefinition>>
  reorderPlanningFields(
    projectId: string,
    fieldIds: string[]
  ): Promise<Result<PlanningFieldDefinition[]>>
  /** Deletes a field and its values; the result is what `restorePlanningField` puts back. */
  deletePlanningField(projectId: string, fieldId: string): Promise<Result<PlanningFieldDeletion>>
  restorePlanningField(
    projectId: string,
    deletion: PlanningFieldDeletion
  ): Promise<Result<PlanningFieldDefinition>>
  /**
   * AI fields (N8.4): Ostler AI's answer for one task's AI field. Saves
   * nothing; `applyAiFieldFills` saves it when the person asked to fill.
   */
  suggestAiFieldValue(
    projectId: string,
    workItemId: string,
    fieldId: string
  ): Promise<Result<AiFieldSuggestion>>
  /** Saves Ostler AI's values for one AI field on the person's Fill with AI: one undo. */
  applyAiFieldFills(
    projectId: string,
    fieldId: string,
    fills: AiFieldFillInput[],
    options?: { replacePersonValues?: boolean }
  ): Promise<Result<AiFieldFillResult>>
  /** Undoes `applyAiFieldFills` with its `before`. */
  restoreAiFieldFills(projectId: string, undo: AiFieldFillUndo): Promise<Result<string[]>>
  /** A task's time entries, newest first (R2.3). */
  getTaskTimeEntries(projectId: string, workItemId: string): Promise<Result<TimeEntry[]>>
  /** Seconds logged per task in a project, finished entries only: one call for every card. */
  getTimeTotals(projectId: string): Promise<Result<TimeTotals>>
  /** Entries that started in a range, across projects (the Timesheet). */
  listTimeEntries(query: TimeEntryQuery): Promise<Result<TimeEntry[]>>
  createTimeEntry(projectId: string, input: CreateTimeEntryInput): Promise<Result<TimeEntry>>
  updateTimeEntry(
    projectId: string,
    entryId: string,
    input: UpdateTimeEntryInput
  ): Promise<Result<TimeEntry>>
  /** Deletes an entry; the result is what `restoreTimeEntry` puts back. */
  deleteTimeEntry(projectId: string, entryId: string): Promise<Result<TimeEntry>>
  restoreTimeEntry(projectId: string, entry: TimeEntry): Promise<Result<TimeEntry>>
  /** Saves entries in a range as CSV where the person chooses; null when they cancel. */
  exportTimeCsv(query: TimeEntryQuery): Promise<Result<string | null>>
  getTimer(): Promise<Result<TimerState>>
  /** Starts a timer on a task; a timer already running stops (D33). */
  startTimer(projectId: string, workItemId: string): Promise<Result<TimerStart>>
  stopTimer(): Promise<Result<TimeEntry | null>>
  /** Undoes a start: the new entry goes and the stopped timer runs on. */
  undoTimerStart(startedId: string, stoppedId: string | null): Promise<Result<TimerState>>
  /** Keeps a timer found running at start, or stops it at the time Ostler closed (D33). */
  resolveInterruptedTimer(choice: 'keep' | 'stop'): Promise<Result<TimerState>>
  /** The focus (N3.5), or null. */
  getFocus(): Promise<Result<FocusState | null>>
  /** Starts a focus: the task's timer (a running one stops, for undo) and the countdown. */
  startFocus(
    projectId: string,
    workItemId: string,
    minutes: number
  ): Promise<Result<{ focus: FocusState; timer: TimerStart }>>
  /** Stops the focus, and the task's timer with it. */
  stopFocus(): Promise<Result<FocusState | null>>
  /** Once focus ended: a break, keep going, or stop at the moment it ended. */
  chooseFocusEnd(choice: FocusChoice): Promise<Result<FocusState | null>>
  /** A task's comments, changes, status moves and agent runs, newest first (P5.2). */
  getPlanningActivity(
    projectId: string,
    workItemId: string,
    query?: ActivityQuery
  ): Promise<Result<ActivityPage>>
  /** The same across the project, for Overview's Recent activity. */
  getPlanningProjectActivity(
    projectId: string,
    query?: ActivityQuery
  ): Promise<Result<ActivityPage>>
  /** How many comments each of a project's tasks has, for the cards. */
  getPlanningCommentCounts(projectId: string): Promise<Result<Record<string, number>>>
  addPlanningComment(workItemId: string, body: string): Promise<Result<PlanningComment>>
  updatePlanningComment(commentId: string, body: string): Promise<Result<PlanningComment>>
  /** Soft delete; `restorePlanningComment` is the undo. */
  deletePlanningComment(commentId: string): Promise<Result<PlanningComment>>
  restorePlanningComment(commentId: string): Promise<Result<PlanningComment>>
  /** Pins a comment to the top of its task's feed, or takes the pin off. */
  pinPlanningComment(commentId: string, pinned: boolean): Promise<Result<PlanningComment>>
  /**
   * People to assign work to: the address book and every project's own people
   * (`projectId`). Archived people only with `includeArchived`.
   */
  getPeople(options?: { includeArchived?: boolean }): Promise<Result<Person[]>>
  createPerson(input: CreatePersonInput): Promise<Result<Person>>
  updatePerson(personId: string, updates: UpdatePersonInput): Promise<Result<Person>>
  archivePerson(personId: string): Promise<Result<Person>>
  unarchivePerson(personId: string): Promise<Result<Person>>
  /** Where a person's work is, for the warning before deleting them. */
  getPersonUsage(personId: string): Promise<Result<PersonUsage>>
  /** Irreversible: deletes a person, handing their tasks on or leaving them unassigned. */
  deletePerson(personId: string, options: DeletePersonOptions): Promise<Result<void>>
  /** Whether Me follows the task (prompt 15). */
  getTaskFollow(taskId: string): Promise<Result<boolean>>
  /** Follows or unfollows the task; returns the new state. */
  setTaskFollow(projectId: string, taskId: string, following: boolean): Promise<Result<boolean>>
  /** Sign-offs asked of a task, decision or milestone, newest first (prompt 16). */
  listSignOffsForItem(item: SignOffItem): Promise<Result<SignOff[]>>
  /** Asks a named person to sign the item off. */
  requestSignOff(input: RequestSignOffInput): Promise<Result<SignOff>>
  /** Approves a sign-off addressed to Me. */
  approveSignOff(id: string): Promise<Result<SignOff>>
  /** Sends a sign-off addressed to Me back, with a note. */
  sendBackSignOff(id: string, note: string): Promise<Result<SignOff>>
  /** Withdraws a sign-off that is still waiting (the requester or an Owner). */
  cancelSignOff(id: string): Promise<Result<void>>
  /** The sign-offs waiting for Me, across projects. */
  listSignOffsWaitingForMe(): Promise<Result<SignOff[]>>
  /** Every sign-off of a project, for the Board's badges. */
  listSignOffsForProject(projectId: string): Promise<Result<SignOff[]>>
  /** Teams (D1): the person's own groups of people. Archived ones only with `includeArchived`. */
  listTeams(options?: { includeArchived?: boolean }): Promise<Result<Team[]>>
  createTeam(input: CreateTeamInput): Promise<Result<Team>>
  updateTeam(teamId: string, updates: UpdateTeamInput): Promise<Result<Team>>
  /** Makes exactly these people the team's members. */
  setTeamMembers(teamId: string, personIds: string[]): Promise<Result<Team>>
  archiveTeam(teamId: string): Promise<Result<Team>>
  restoreTeam(teamId: string): Promise<Result<Team>>
  /** Irreversible; the people in the team are not touched. */
  deleteTeam(teamId: string): Promise<Result<void>>
  /** Makes this person Me; whoever was Me before no longer is. */
  setMe(personId: string): Promise<Result<Person>>
  /** Days off (N3.2, global): bank holidays for everyone and people's leave. */
  getDaysOff(query?: DaysOffQuery): Promise<Result<DayOff[]>>
  /** Other people's away dates shared with the projects here (D6); never names. */
  getSharedAway(query: SharedAwayQuery): Promise<Result<SharedAwaySpan[]>>
  /** Whether Me shows their away dates to the people in this project. */
  getAwaySharing(projectId: string): Promise<Result<boolean>>
  setAwaySharing(projectId: string, shared: boolean): Promise<Result<boolean>>
  createDayOff(input: CreateDayOffInput): Promise<Result<DayOff>>
  updateDayOff(dayOffId: string, updates: UpdateDayOffInput): Promise<Result<DayOff>>
  /** Removes a day off and returns it; `restoreDaysOff` is the undo. */
  removeDayOff(dayOffId: string): Promise<Result<DayOff>>
  restoreDaysOff(days: DayOff[]): Promise<Result<DayOff[]>>
  /** Shows the open dialog for a holiday calendar file (.ics); null when cancelled. */
  chooseDaysOffFile(): Promise<Result<DaysOffFile | null>>
  previewDaysOffImport(input: DaysOffImportInput): Promise<Result<DaysOffImportPreview>>
  /**
   * Adds the file's days off, replacing those from an earlier load of the
   * same file for the same person (or for everyone again); a load for
   * someone else is kept.
   */
  importDaysOff(input: DaysOffImportInput): Promise<Result<DaysOffImportResult>>
  /**
   * Removes the days off that came from this file and returns them, for the
   * undo: one load of it (a person, or null for everyone's), or every load
   * when `personId` is left out.
   */
  removeDaysOffFile(fileName: string, personId?: string | null): Promise<Result<DayOff[]>>
  /** Outside calendars (N3.3a, global): .ics files shown read-only beside tasks. */
  getOutsideCalendars(): Promise<Result<OutsideCalendar[]>>
  /** Shows the open dialog for a calendar file and reads it; null when cancelled. */
  chooseCalendarFile(): Promise<Result<ChosenCalendarFile | null>>
  /** Adds a calendar from a file chosen with `chooseCalendarFile`. */
  addCalendarFile(input: AddCalendarFileInput): Promise<Result<OutsideCalendar>>
  /** Reads the calendar's file again and replaces its events. */
  reloadOutsideCalendar(calendarId: string): Promise<Result<OutsideCalendar>>
  updateOutsideCalendar(
    calendarId: string,
    updates: UpdateCalendarInput
  ): Promise<Result<OutsideCalendar>>
  /** Removes a calendar; `restoreOutsideCalendar` is the undo, until Ostler next starts. */
  removeOutsideCalendar(calendarId: string): Promise<Result<OutsideCalendar>>
  restoreOutsideCalendar(calendarId: string): Promise<Result<OutsideCalendar>>
  /**
   * Subscribes to a calendar link (N3.3b): main fetches it once, then on its
   * schedule. The link is stored encrypted and never comes back.
   */
  addCalendarLink(input: AddCalendarLinkInput): Promise<Result<OutsideCalendar>>
  /** Fetches a link calendar now. A failure is recorded on the calendar, not returned as an error. */
  refreshCalendarLink(calendarId: string): Promise<Result<OutsideCalendar>>
  /** Replaces a link calendar's address; kept only if the new one can be fetched. */
  replaceCalendarLink(calendarId: string, link: string): Promise<Result<OutsideCalendar>>
  /** The shown calendars' events between two dates, in the person's time zone. */
  getCalendarEvents(query: CalendarEventsQuery): Promise<Result<CalendarOccurrence[]>>
  /** Home's Today and Upcoming across every enabled project; `today` is `YYYY-MM-DD`. */
  getMyWork(today: string): Promise<Result<MyWork>>
  /** Home's progress card (N3.6): this week, eight weeks and the streak, in one query. */
  getHomeProgress(query: HomeProgressQuery): Promise<Result<HomeProgress>>
  /** Your year (N3.6) across every enabled project. */
  getYearInReview(query: YearInReviewQuery): Promise<Result<YearInReview>>
  /** My work (R3.1): every live task assigned to a person, across the enabled projects. */
  getAssignedTasks(query: AssignedTasksQuery): Promise<Result<AssignedTask[]>>
  /** My work's dated checklist items for the person (N2.2); the query's other fields are ignored. */
  getAssignedChecklistItems(
    query: AssignedChecklistItemsQuery
  ): Promise<Result<HomeChecklistItem[]>>
  /** Workload (R3.2): every unfinished task that can count in the weeks shown, in one call. */
  getWorkloadTasks(query: WorkloadTasksQuery): Promise<Result<AssignedTask[]>>
  /** The Team view: each person's open, late, blocked and logged work across projects, in one call. */
  getTeamOverview(query: TeamOverviewQuery): Promise<Result<TeamOverviewRow[]>>
  /** The Timeline across projects (N5.4): every enabled project's milestones and date span, in one call. */
  getTimelineOverview(): Promise<Result<TimelineOverviewProject[]>>
  /** Plan my day (N1.4): today's list, what was left from the last list, and what to pick from. */
  getPlanMyDay(today: string): Promise<Result<PlanMyDayCandidates>>
  /** Adds a task to a day's My day; a hidden task is brought back first, and the result says so. */
  addToMyDay(workItemId: string, placement: MyDayPlacement): Promise<Result<MyDayAddResult>>
  /** Moves a task within a day's My day; its place on the Board does not change. */
  moveInMyDay(workItemId: string, placement: MyDayPlacement): Promise<Result<void>>
  /** Removes a task from a day's My day; whether it was there. */
  removeFromMyDay(workItemId: string, date: string): Promise<Result<boolean>>
  /** Start my day: the day's list becomes exactly these tasks, in this order. */
  startMyDay(date: string, workItemIds: string[]): Promise<Result<MyDayTask[]>>
  /** Let them go: a past day's unfinished tasks are not offered again (only these when named). */
  letGoMyDay(date: string, workItemIds?: string[]): Promise<Result<number>>
  /** Time blocks (N3.4a) from one date to another, in one call. */
  getTimeBlocks(query: TimeBlocksQuery): Promise<Result<TimeBlock[]>>
  /** Blocks time for a task; without a length, its estimate in hours or an hour. */
  createTimeBlock(input: CreateTimeBlockInput): Promise<Result<TimeBlock>>
  /** Moves a block or changes its length. */
  updateTimeBlock(blockId: string, updates: UpdateTimeBlockInput): Promise<Result<TimeBlock>>
  /** Removes a block and returns it, for undo. */
  removeTimeBlock(blockId: string): Promise<Result<TimeBlock>>
  /** Undo of Remove: the same block back. */
  restoreTimeBlock(block: TimeBlock): Promise<Result<TimeBlock>>
  /** Removes several blocks in one call (undo of Fill my day, N3.4b); returns those removed. */
  removeTimeBlocks(blockIds: string[]): Promise<Result<TimeBlock[]>>
  /** Where blocks would go at the next free time (N3.4b), changing nothing. */
  previewBlockMoves(blockIds: string[]): Promise<Result<BlockMovePlan>>
  /** Moves blocks as a preview showed; when time moved on, nothing moves and a new plan comes back. */
  applyBlockMoves(plan: BlockMovePlan): Promise<Result<PlanApplyResult<BlockMovePlan>>>
  /** Fill my day's preview (N3.4b): My day's unfinished tasks placed into the day's free time. */
  previewFillDay(date: string): Promise<Result<FillDayPlan>>
  /** Places them: the preview's blocks in one call; when time moved on, a new plan comes back. */
  applyFillDay(plan: FillDayPlan): Promise<Result<PlanApplyResult<FillDayPlan>>>
  /** Reschedule (N1.3): the new dates for overdue tasks, changing nothing. */
  previewReschedule(query: RescheduleQuery): Promise<Result<ReschedulePlan>>
  /**
   * Applies a plan's changes in one transaction; a task whose dates changed
   * since the preview is skipped. Undo sends `undoChanges(result.changed)`.
   */
  applyReschedule(changes: RescheduleChange[]): Promise<Result<RescheduleResult>>
  /**
   * Move what waits on it (N7.1): after date changes, the tasks that wait on
   * them and now start too early, with their new dates, changing nothing.
   * Apply the entries with `applyReschedule` (one transaction, one undo).
   */
  previewMoveDependents(moves: TaskDateMove[]): Promise<Result<DependentMovePlan>>
  /**
   * Find and replace (N2.5): every match of a plain text in a project's task
   * titles, descriptions and checklists, changing nothing.
   */
  previewFindReplace(
    projectId: string,
    request: FindReplaceRequest
  ): Promise<Result<FindReplacePreview>>
  /**
   * Replaces the chosen matches in one transaction; a task changed since the
   * preview is skipped. Undo sends `undoTextChanges(result.changed)` to
   * `revertFindReplace`.
   */
  applyFindReplace(
    projectId: string,
    replace: string,
    matches: FindReplaceChoice[]
  ): Promise<Result<FindReplaceResult>>
  /** Puts replaced text back; a task edited again since is skipped, never overwritten. */
  revertFindReplace(
    projectId: string,
    changes: FindReplaceChange[]
  ): Promise<Result<FindReplaceResult>>
  /** Blocked tasks, and while agents are on, their questions and reviews. */
  getNeedsYou(): Promise<Result<NeedsYouEntry[]>>
  /** Weekly review (N1.5): every step's list across the enabled projects, for `today`. */
  getWeeklyReview(today: string): Promise<Result<WeeklyReview>>
  /** Records a finished review with each step's counts; it clears the reminder's Inbox entry. */
  finishWeeklyReview(steps: WeeklyReviewRecord['steps']): Promise<Result<WeeklyReviewRecord>>
  /** The last finished review, or null when there is none yet. */
  getLastWeeklyReview(): Promise<Result<WeeklyReviewRecord | null>>
  /**
   * Since you were last here (N1.6): what happened from `since` to now across
   * the enabled projects, from Ostler's own records.
   */
  getBriefing(since: number): Promise<Result<Briefing>>
  /** Ostler AI's paragraph about the same briefing; it is sent titles and counts only. */
  writeBriefing(since: number, until: number): Promise<Result<BriefingWriteUp>>
  /** Home's getting-started checklist (P8.1), worked out from real state in main. */
  getGettingStarted(): Promise<Result<GettingStarted>>
  /** Ticks something the person did: tried a view, searched, saw the backups. */
  recordGettingStarted(activity: GettingStartedActivity): Promise<Result<GettingStarted>>
  dismissGettingStarted(): Promise<Result<GettingStarted>>
  getInbox(): Promise<Result<InboxList>>
  setInboxRead(keys: string[], read: boolean): Promise<Result<InboxList>>
  /** `unarchiveInboxItems` is the undo. */
  archiveInboxItems(keys: string[]): Promise<Result<InboxList>>
  unarchiveInboxItems(keys: string[]): Promise<Result<InboxList>>
  markAllInboxRead(): Promise<Result<InboxList>>
  /** A reminder item comes back unread in an hour, or tomorrow at 09:00. */
  snoozeInboxReminder(key: string, until: InboxSnooze): Promise<Result<InboxList>>
  /**
   * Queue it now, on the Inbox note of a repeating task's occurrence its
   * schedule could not queue for agents: the normal queue path's checks, and
   * the plain reason when it is still refused.
   */
  queueScheduledTaskNow(workItemId: string): Promise<Result<InboxList>>
  getPlanningRecurrence(workItemId: string): Promise<Result<PlanningRecurrence | null>>
  /** Null stops the task repeating. */
  setPlanningRecurrence(
    workItemId: string,
    input: PlanningRecurrenceInput | null
  ): Promise<Result<PlanningRecurrence | null>>
  /** A task's reminders still to come, and any that keeps reminding now (N1.7). */
  getPlanningReminders(workItemId: string): Promise<Result<PlanningReminder[]>>
  /** "Remind me…": `remindAt` is the instant in ms; it may keep reminding (N1.7). */
  addPlanningReminder(
    workItemId: string,
    remindAt: number,
    options?: PlanningReminderOptions
  ): Promise<Result<PlanningReminder>>
  deletePlanningReminder(workItemId: string, reminderId: string): Promise<Result<void>>
  /** Stop reminding (N1.7): a reminder that keeps reminding stops coming back. */
  stopPlanningReminder(workItemId: string, reminderId: string): Promise<Result<PlanningReminder>>
  getPlanningDecisions(projectId: string): Promise<Result<PlanningDecision[]>>
  createPlanningDecision(
    projectId: string,
    input: CreatePlanningDecisionInput
  ): Promise<Result<PlanningDecision>>
  updatePlanningDecision(
    decisionId: string,
    updates: UpdatePlanningDecisionInput
  ): Promise<Result<PlanningDecision>>
  deletePlanningDecision(decisionId: string): Promise<Result<void>>
  getPlanningWipLimits(projectId: string): Promise<Result<PlanningWipLimits>>
  setPlanningWipLimit(
    projectId: string,
    status: PlanningWorkItemStatus,
    limit: number | null
  ): Promise<Result<PlanningWipLimits>>
  /** Every project's column names and hidden columns (R2.4), by project id; a project with standard columns is left out. */
  getPlanningColumnSettings(): Promise<Result<Record<string, PlanningColumnSettings>>>
  /** Renames or hides a project's columns, with D34's refusals. */
  updatePlanningColumnSettings(
    projectId: string,
    change: UpdatePlanningColumnSettingsInput
  ): Promise<Result<PlanningColumnSettings>>
  /** Content search across tasks, comments, decisions, milestones, goals and the Library (P5.7). */
  search(query: string, options?: SearchOptions): Promise<Result<SearchResult[]>>
  /**
   * Ask Ostler (N8.3a): a question answered by Ostler AI from what Ostler's own
   * search finds across every enabled project. `askId` names the ask for
   * `cancelAskOstler` and its progress events.
   */
  askOstler(
    askId: string,
    question: string,
    options: AskOstlerOptions
  ): Promise<Result<AskOstlerAnswer>>
  /** Stops an ask; its answer, if one still arrives, is dropped. */
  cancelAskOstler(askId: string): Promise<Result<void>>
  /** A project's saved views, defaults included; with no project, every project's named views. */
  listSavedViews(projectId?: string): Promise<Result<SavedView[]>>
  /** The named views for all projects (projectId null), of one type or every type. */
  listSharedSavedViews(viewType?: SavedViewType): Promise<Result<SavedView[]>>
  /** A named view in a project, or for all projects when `projectId` is null. */
  createSavedView(projectId: string | null, input: CreateSavedViewInput): Promise<Result<SavedView>>
  updateSavedView(viewId: string, updates: UpdateSavedViewInput): Promise<Result<SavedView>>
  /** Returns the deleted view for undo (`restoreSavedView`). */
  deleteSavedView(viewId: string): Promise<Result<SavedView>>
  restoreSavedView(view: SavedView): Promise<Result<SavedView>>
  /**
   * What a project's view opens with, or null before it was first kept; with
   * a null project, the default for all projects.
   */
  getDefaultSavedView(
    projectId: string | null,
    viewType: SavedViewType
  ): Promise<Result<SavedView | null>>
  setDefaultSavedView(
    projectId: string | null,
    viewType: SavedViewType,
    config: SavedViewConfig
  ): Promise<Result<SavedView>>
  /** Reset to default: removes a kept default view and returns it, or null. */
  clearDefaultSavedView(
    projectId: string | null,
    viewType: SavedViewType
  ): Promise<Result<SavedView | null>>
  /** Undo history, newest first: every change made in a window, step by step. */
  listChangeHistory(query?: ChangeHistoryQuery): Promise<Result<ChangeHistoryPage>>
  /** Every value one step changed, before and after. */
  getChangeHistoryDetails(entryId: string): Promise<Result<ChangeDetail[]>>
  /** The steps the toolbar's Undo and Redo would act on now. */
  getChangeHistoryHead(): Promise<Result<ChangeHistoryHead>>
  getChangeHistoryStats(): Promise<Result<ChangeHistoryStats>>
  /** Undoes one step, keeping whatever changed after it. */
  undoChange(entryId: string): Promise<Result<ChangeUndoResult>>
  /** Puts an undone step back (undoes its undo). */
  redoChange(entryId: string): Promise<Result<ChangeUndoResult>>
  /** Undoes the newest step still in force. */
  undoLatestChange(): Promise<Result<ChangeUndoResult>>
  /** Puts back the newest undone step. */
  redoLatestChange(): Promise<Result<ChangeUndoResult>>
  /** Forgets a step and its undos; what it changed stays. Returns how many entries went. */
  deleteChangeHistoryEntry(entryId: string): Promise<Result<number>>
  /** Forgets every step, or the older ones, or one project's. */
  clearChangeHistory(options?: ChangeHistoryClear): Promise<Result<number>>
  /** The sidebar's pins, or a project's Overview's, in order, with current titles (N5.2a). */
  listPins(query: ListPinsQuery): Promise<Result<PinView[]>>
  /** Pins an item; pinning one already pinned there returns that pin. */
  createPin(input: CreatePinInput): Promise<Result<PinView>>
  /** Unpins; returns the pin for undo (`restorePin`). The item is not touched. */
  deletePin(pinId: string): Promise<Result<Pin>>
  restorePin(pin: Pin): Promise<Result<PinView>>
  movePin(pinId: string, input: MovePinInput): Promise<Result<PinView>>
  /** Turns a pin's countdown on or off (N5.2b); at most three at once. */
  setPinCountdown(pinId: string, input: SetPinCountdownInput): Promise<Result<PinView>>
  /** Every countdown, in pin order, worded (N5.2b). */
  listCountdowns(): Promise<Result<PinView[]>>
  /** A project's status updates (N5.5), newest first: the diary. */
  listStatusUpdates(projectId: string): Promise<Result<StatusUpdate[]>>
  /** Each project's latest status update, by project id, in one call (Home's cards). */
  latestStatusUpdates(): Promise<Result<Record<string, StatusUpdate>>>
  /** Posts a status update as Me. */
  postStatusUpdate(projectId: string, input: StatusUpdateInput): Promise<Result<StatusUpdate>>
  /** Edits one; returns it as it was, for undo (`revertStatusUpdate`). */
  editStatusUpdate(
    updateId: string,
    input: StatusUpdateInput
  ): Promise<Result<{ before: StatusUpdate; after: StatusUpdate }>>
  /** Deletes one; `restoreStatusUpdate` brings it back. */
  deleteStatusUpdate(updateId: string): Promise<Result<StatusUpdate>>
  restoreStatusUpdate(updateId: string): Promise<Result<StatusUpdate>>
  revertStatusUpdate(updateId: string, before: StatusUpdate): Promise<Result<StatusUpdate>>
  /** Draft from activity: Ostler AI suggests a health and note. Nothing is posted. */
  draftStatusUpdate(projectId: string): Promise<Result<StatusUpdateDraft>>
  /** A project's budget and currency (N6.3a); amounts are minor units. */
  getBudget(projectId: string): Promise<Result<ProjectBudget>>
  /** Sets the budget's amount (null for none) and currency; a field left out keeps its value. */
  setBudget(
    projectId: string,
    input: { amount?: number | null; currency?: string }
  ): Promise<Result<ProjectBudget>>
  /** Budget, paid, planned and left, by category and milestone, in one call (the Overview). */
  getMoneySummary(projectId: string): Promise<Result<MoneySummary>>
  /** A project's costs, by date, filtered. */
  listCosts(projectId: string, query?: CostQuery): Promise<Result<Cost[]>>
  /** The categories the project's costs use, most used first. */
  listCostCategories(projectId: string): Promise<Result<string[]>>
  createCost(projectId: string, input: CostInput): Promise<Result<Cost>>
  updateCost(
    projectId: string,
    costId: string,
    input: CostInput
  ): Promise<Result<{ before: Cost; after: Cost }>>
  /** Mark as paid, with the paid date and amount when they differ from the plan. */
  markCostPaid(
    projectId: string,
    costId: string,
    input?: { date?: string; amount?: number }
  ): Promise<Result<Cost>>
  /** Deletes a cost; `restoreCost` with what it returns brings it back. */
  deleteCost(projectId: string, costId: string): Promise<Result<Cost>>
  restoreCost(projectId: string, cost: Cost): Promise<Result<Cost>>
  /** Export costs to CSV: asks where to save; null when cancelled. */
  exportCostsCsv(projectId: string, query?: CostQuery): Promise<Result<string | null>>
  /** The project's shopping list (N6.3b) in order, with suppliers' names and what bought items cost. */
  listShopping(projectId: string): Promise<Result<ShoppingItem[]>>
  createShoppingItem(projectId: string, input: ShoppingInput): Promise<Result<ShoppingItem>>
  /** Changes or moves an item (`afterId` / `beforeId`); returns it as it was and is. */
  updateShoppingItem(
    projectId: string,
    itemId: string,
    input: ShoppingInput
  ): Promise<Result<{ before: ShoppingItem; after: ShoppingItem }>>
  /** Deletes an item; `restoreShoppingItem` with what it returns brings it back. */
  deleteShoppingItem(projectId: string, itemId: string): Promise<Result<ShoppingItem>>
  restoreShoppingItem(projectId: string, item: ShoppingItem): Promise<Result<ShoppingItem>>
  /** Ticks an item as bought: a paid cost with the price and date, in one transaction. */
  buyShoppingItem(
    projectId: string,
    itemId: string,
    input: ShoppingBuyInput
  ): Promise<Result<{ item: ShoppingItem; cost: Cost }>>
  /** Unticks an item: deletes its paid cost; `rebuyShoppingItem` with that cost undoes it. */
  unbuyShoppingItem(
    projectId: string,
    itemId: string
  ): Promise<Result<{ item: ShoppingItem; cost: Cost }>>
  rebuyShoppingItem(projectId: string, itemId: string, cost: Cost): Promise<Result<ShoppingItem>>
  /** The project's baselines (N7.4), newest first, without their entries. */
  listBaselines(projectId: string): Promise<Result<Baseline[]>>
  /** A baseline with every task's and milestone's dates as they were. */
  getBaseline(projectId: string, baselineId: string): Promise<Result<BaselineWithEntries>>
  /** Saves a baseline of the live plan's dates; at ten, `replaceId` names the one to delete. */
  createBaseline(projectId: string, input: BaselineCreateInput): Promise<Result<Baseline>>
  renameBaseline(
    projectId: string,
    baselineId: string,
    name: string
  ): Promise<Result<{ before: Baseline; after: Baseline }>>
  /** Deletes a baseline; `restoreBaseline` with what it returns brings it back. */
  deleteBaseline(projectId: string, baselineId: string): Promise<Result<BaselineWithEntries>>
  restoreBaseline(projectId: string, baseline: BaselineWithEntries): Promise<Result<Baseline>>
  /** How the live plan compares with a baseline (`compareBaseline`). */
  compareBaseline(projectId: string, baselineId: string): Promise<Result<BaselineComparison>>
  /** A project's hourly rate and "New time is billable" (N6.4). */
  getBillingSettings(projectId: string): Promise<Result<BillingSettings>>
  /** Sets the rate (minor units per hour, null for none) and the default; a field left out keeps its value. */
  setBillingSettings(
    projectId: string,
    input: { hourlyRate?: number | null; newTimeBillable?: boolean }
  ): Promise<Result<BillingSettings>>
  /** The Time report for local days `from` to `to` (`YYYY-MM-DD`, inclusive), in one call. */
  getTimeReport(projectId: string, from: string, to: string): Promise<Result<TimeReport>>
  /** Mark as billed: the range's unbilled billable time joins a new billing and is locked. */
  markBilled(projectId: string, range: { from: string; to: string }): Promise<Result<Billing>>
  /** Unmark a billing; `restoreBilling` with what it returns undoes it. */
  unmarkBilling(projectId: string, billingId: string): Promise<Result<UnmarkedBilling>>
  restoreBilling(projectId: string, unmarked: UnmarkedBilling): Promise<Result<Billing>>
  /** The Time report as CSV: asks where to save; null when cancelled. */
  exportTimeReportCsv(projectId: string, from: string, to: string): Promise<Result<string | null>>
  /** Prints the Time report (A4) or saves it as a PDF; the PDF's path, or null. */
  printTimeReport(request: {
    projectId: string
    from: string
    to: string
    output: 'printer' | 'pdf'
  }): Promise<Result<string | null>>
  /** Every check-in of a project's goals (N5.6a), by goal id, oldest first, in one call. */
  listGoalCheckIns(projectId: string): Promise<Result<Record<string, GoalCheckIn[]>>>
  /** Each project's active goals with a measure and their progress, by project id (Home's cards). */
  goalGlances(): Promise<Result<Record<string, GoalGlance[]>>>
  /** Contacts (N6.5), shared by every project, by name; `query` matches name, organisation, role, emails and phones. */
  listContacts(query?: string): Promise<Result<Contact[]>>
  createContact(input: ContactInput): Promise<Result<Contact>>
  /** A field left out keeps its value. */
  updateContact(contactId: string, input: ContactInput): Promise<Result<Contact>>
  /** Deletes a contact and its links to tasks; `restoreContact` with what it returns undoes it. */
  deleteContact(contactId: string): Promise<Result<DeletedContact>>
  restoreContact(deleted: DeletedContact): Promise<Result<Contact>>
  /** The tasks that name a contact, across projects, with their roles. */
  contactTasks(contactId: string): Promise<Result<ContactTask[]>>
  /** A task's contacts, with the contacts themselves. */
  taskContacts(projectId: string, workItemId: string): Promise<Result<TaskContact[]>>
  /** Which contacts each of a project's tasks names, in one call (the Contact filter and cards). */
  projectTaskContacts(projectId: string): Promise<Result<TaskContactMarks>>
  linkTaskContact(
    projectId: string,
    workItemId: string,
    contactId: string,
    role: TaskContactRole
  ): Promise<Result<TaskContact>>
  /** Takes a contact off a task; `relinkTaskContact` with what it returns undoes it. */
  unlinkTaskContact(
    projectId: string,
    workItemId: string,
    linkId: string
  ): Promise<Result<TaskContactLink>>
  relinkTaskContact(
    projectId: string,
    workItemId: string,
    link: TaskContactLink
  ): Promise<Result<TaskContact[]>>
  /**
   * Call, Email or Open website: main builds the address from the contact's
   * stored field (`index` picks the phone or email) and hands it to Windows.
   */
  openContact(
    contactId: string,
    how: { kind: 'call' | 'email' | 'website'; index?: number }
  ): Promise<Result<void>>
  /**
   * Import contacts…: asks for a `.vcf` file and reads it. Each card comes
   * with the contact its email matches, if any. Null when cancelled.
   */
  readVCardFile(): Promise<
    Result<{
      fileName: string
      cards: { card: VCardContact; match: Contact | null }[]
      skipped: number
      tooManyCards: boolean
    } | null>
  >
  /** Imports the chosen cards: new contacts, or updates to the ones named by `updateId`. */
  importContacts(
    choices: { card: VCardContact; updateId: string | null }[]
  ): Promise<Result<{ created: Contact[]; updated: Contact[] }>>
  /** Checks in as Me; one already on that day is replaced and returned for Undo. */
  recordGoalCheckIn(goalId: string, input: GoalCheckInInput): Promise<Result<GoalCheckInResult>>
  /** Removes the day's check-in; `restoreGoalCheckIn` puts it back. */
  deleteGoalCheckIn(goalId: string, date: string): Promise<Result<GoalCheckIn>>
  restoreGoalCheckIn(goalId: string, checkIn: GoalCheckIn): Promise<Result<GoalCheckIn>>
  /** Goals of one's own (N5.6b), with their check-ins, links and progress, in one call. */
  listPersonalGoals(): Promise<Result<PersonalGoalView[]>>
  createPersonalGoal(input: CreatePersonalGoalInput): Promise<Result<PersonalGoalView>>
  updatePersonalGoal(id: string, input: UpdatePersonalGoalInput): Promise<Result<PersonalGoalView>>
  /** Deletes it with its check-ins and links; `restorePersonalGoal` puts it all back. */
  deletePersonalGoal(id: string): Promise<Result<DeletedPersonalGoal>>
  restorePersonalGoal(deleted: DeletedPersonalGoal): Promise<Result<PersonalGoalView>>
  recordPersonalGoalCheckIn(
    id: string,
    input: GoalCheckInInput
  ): Promise<Result<{ checkIn: PersonalGoalCheckIn; replaced: PersonalGoalCheckIn | null }>>
  deletePersonalGoalCheckIn(id: string, date: string): Promise<Result<PersonalGoalCheckIn>>
  restorePersonalGoalCheckIn(
    id: string,
    checkIn: PersonalGoalCheckIn
  ): Promise<Result<PersonalGoalCheckIn>>
  /** Makes a project goal count towards a goal of one's own, or (null) none. */
  setGoalCountsTowards(
    goalId: string,
    personalGoalId: string | null
  ): Promise<Result<SetCountsTowardsResult>>
  /** What each of a project's goals counts towards, by goal id. */
  listGoalsCountsTowards(projectId: string): Promise<Result<Record<string, GoalCountsTowards>>>
  /** Every project goal with a measure in a project that is on: Add a project goal. */
  listLinkableProjectGoals(): Promise<Result<LinkableProjectGoal[]>>
  /** Explicit human action: creates or returns the one harness task linked to this work item. */
  queuePlanningWorkItem(
    projectId: string,
    workItemId: string,
    /** The model and effort for this run (D42); left out, the project's default. */
    runChoice?: AgentRunChoice
  ): Promise<Result<PlanningHarnessHandoff>>
  /**
   * Queues a whole selection in dependency order, skipping what is not yet
   * dispatchable, and reports both halves so the board can say what it did.
   */
  queuePlanningWorkItems(
    projectId: string,
    workItemIds: string[]
  ): Promise<Result<PlanningBulkQueueResult>>
  /** Builds a queued work item's agent handoff, copies it, and returns it with the token masked. */
  copyPlanningAgentHandoff(projectId: string, workItemId: string): Promise<Result<string>>
  breakDownPlanningGoal(
    projectId: string,
    goalId: string,
    selectedItemIds?: string[]
  ): Promise<Result<AIPlanningDraft>>
  approveAIPlanningDraft(
    projectId: string,
    goalId: string,
    suggestions: AIPlanningSuggestionApproval[]
  ): Promise<Result<PlanningWorkItem[]>>
  generateAINextTasks(
    projectId: string,
    selectedItemIds?: string[]
  ): Promise<Result<AINextTasksDraft>>
  reviewAIMilestone(
    projectId: string,
    milestoneId: string,
    selectedItemIds?: string[]
  ): Promise<Result<AIMilestoneAdvisory>>
  getAIMilestoneAdvisory(
    projectId: string,
    milestoneId: string
  ): Promise<Result<AIMilestoneAdvisory | null>>
  approveAINextTasks(
    projectId: string,
    draftId: string,
    suggestions: AINextTaskApproval[]
  ): Promise<Result<PlanningWorkItem[]>>
  /** Tasks from text or a photo (N4.1a): sends the text and photo to Ostler AI; creates nothing. */
  findTasksFromText(
    projectId: string,
    request: TasksFromTextRequest
  ): Promise<Result<TasksFromTextDraft>>
  /** Describe it (N8.1): sends the words and the project's names to Ostler AI; returns a filter. */
  filterFromWords(
    projectId: string,
    request: FilterFromWordsRequest
  ): Promise<Result<FilterFromWordsResult>>
  /** Adds the ticked suggestions as `ai-approved` tasks, keeping the photo when asked. */
  addTasksFromText(
    projectId: string,
    input: AddTasksFromTextInput
  ): Promise<Result<PlanningWorkItem[]>>
  /** Find actions and decisions (N4.1b): sends one AI-readable Library note to Ostler AI; creates nothing. */
  findNoteActions(projectId: string, request: NoteActionsRequest): Promise<Result<NoteActionsDraft>>
  /** Improve writing (N8.2): sends one text box's text (or its selected part) to Ostler AI; changes nothing. */
  improveWriting(
    projectId: string,
    request: ImproveWritingRequest
  ): Promise<Result<ImprovedWriting>>
  /** Polish with AI (N9.9): sends the release notes draft main builds to Ostler AI; stores nothing. */
  polishReleaseNotes(
    projectId: string,
    request: PolishReleaseNotesRequest
  ): Promise<Result<PolishedReleaseNotes>>
  /** Summarise comments (N8.2): sends one task's comments to Ostler AI; stores nothing. */
  summariseComments(projectId: string, workItemId: string): Promise<Result<CommentSummary>>
  /** Adds a summary as a comment by Ostler AI; `deletePlanningComment` is the undo. */
  addCommentSummary(
    projectId: string,
    workItemId: string,
    summary: string
  ): Promise<Result<PlanningComment>>
  /** Adds the ticked tasks and decisions, each linked back to the note. */
  addNoteActions(
    projectId: string,
    input: AddNoteActionsInput
  ): Promise<Result<AddNoteActionsResult>>
  /** Make a task from a line (N4.4b): makes the tasks and turns their lines into links. */
  makeLineTasks(projectId: string, input: MakeLineTasksInput): Promise<Result<MakeLineTasksResult>>
  /** The one undo for makeLineTasks: deletes its tasks and puts the note's text back. */
  undoLineTasks(projectId: string, input: UndoLineTasksInput): Promise<Result<LibraryItem>>
  generateAIProjectBrief(
    projectId: string,
    selectedItemIds?: string[]
  ): Promise<Result<AIProjectBrief>>
  getAIProjectBrief(projectId: string): Promise<Result<AIProjectBrief | null>>
  reviewAIProjectBriefAction(
    projectId: string,
    actionId: string,
    reviewStatus: 'approved' | 'rejected',
    reviewNotes: string
  ): Promise<Result<AIProjectBrief>>
  regenerateAIProjectBriefAction(
    projectId: string,
    actionId: string,
    reviewNotes: string
  ): Promise<Result<AIProjectBrief>>
  recordAIProjectBriefActionCreation(
    projectId: string,
    actionId: string,
    type: 'goal' | 'milestone' | 'work-item',
    recordId: string
  ): Promise<Result<AIProjectBrief>>
  undoAIProjectBriefActionCreation(
    projectId: string,
    actionId: string
  ): Promise<Result<AIProjectBrief>>
  improvePlanningWorkItem(
    projectId: string,
    workItemId: string,
    selectedItemIds?: string[]
  ): Promise<Result<AIWorkItemImprovement>>
  draftAIDecision(projectId: string, workItemId?: string): Promise<Result<AIDecisionDraft>>
  approveAIDecision(
    projectId: string,
    draftId: string,
    approval: AIDecisionApproval
  ): Promise<Result<PlanningDecision>>

  // --- Agent Plan & Split workflow ---
  /** One AI call proposing a goal from library items. Creates nothing. */
  proposeAIGoalFromLibrary(
    projectId: string,
    selectedItemIds: string[]
  ): Promise<Result<AILibraryGoalProposal>>
  generateAIMasterPlan(
    projectId: string,
    goalId: string,
    selectedItemIds?: string[]
  ): Promise<Result<AIMasterPlanDraft>>
  approveAIMasterPlan(
    projectId: string,
    goalId: string,
    draftId: string,
    approval: AIMasterPlanApproval
  ): Promise<Result<AIMasterPlanDraft>>
  /** Starts the split in the background and returns immediately with the initial job. */
  startAITaskSplit(
    projectId: string,
    goalId: string,
    masterPlanDraftId: string,
    selectedItemIds?: string[]
  ): Promise<Result<TaskSplitJob>>
  /** The split job for a goal, if one has run this session. Null when there is none. */
  getAITaskSplitJob(projectId: string, goalId: string): Promise<Result<TaskSplitJob | null>>
  retryAITaskSplitPhase(jobId: string, phaseCode: string): Promise<Result<TaskSplitJob>>
  cancelAITaskSplit(jobId: string): Promise<Result<TaskSplitJob>>
  getAITaskSplitDraft(projectId: string, draftId: string): Promise<Result<AITaskSplitDraft>>
  createAgentPlanTasks(
    projectId: string,
    goalId: string,
    taskSplitDraftId: string,
    milestoneId: string | null,
    approval: AITaskSplitApproval
  ): Promise<Result<PlanningWorkItem[]>>
  listOpenBlockers(projectId: string): Promise<Result<PlanningBlockerWithWorkItem[]>>
  reportBlocker(
    workItemId: string,
    description: string,
    resolutionOptions: string[]
  ): Promise<Result<PlanningBlocker>>
  resolveBlocker(blockerId: string, choice: string, note: string): Promise<Result<PlanningBlocker>>
  reviewTaskStatus(projectId: string, workItemIds: string[]): Promise<Result<TaskStatusReviewDraft>>
  acceptTaskStatusReview(
    workItemId: string,
    verificationStatus: PlanningWorkItem['verificationStatus'],
    verificationNotes: string
  ): Promise<Result<PlanningWorkItem>>

  // --- AI Task Review ---
  getTaskReviews(workItemId: string): Promise<Result<TaskReview[]>>
  refreshTaskReview(projectId: string, workItemId: string): Promise<Result<TaskReview>>
  annotateTaskReview(
    reviewId: string,
    workItemId: string,
    humanComment: string
  ): Promise<Result<TaskReview>>
  /** Human-confirmed: creates a new work item from the review's proposal and marks the review accepted. */
  acceptTaskReview(
    reviewId: string,
    workItemId: string
  ): Promise<Result<{ review: TaskReview; createdWorkItem: PlanningWorkItem }>>
  dismissTaskReview(reviewId: string, workItemId: string): Promise<Result<TaskReview>>
  /**
   * Human-confirmed: has the AI draft a new task aimed at resolving this
   * review's diagnosis and downstream effects, creates it, marks the review
   * accepted, and immediately queues the new task for the harness.
   */
  resolveTaskReview(
    reviewId: string,
    workItemId: string,
    includeComment: boolean
  ): Promise<Result<{ review: TaskReview; createdWorkItem: PlanningWorkItem }>>

  // --- Config ---
  getConfig(): Promise<Result<RendererConfig>>
  /** A missing or empty `ai.apiKey` keeps the saved key. */
  updateConfig(updates: RendererConfigUpdate): Promise<Result<RendererConfig>>
  clearAiApiKey(): Promise<Result<RendererConfig>>
  /** Saves a GitHub token, encrypted in main; the renderer never gets it back (R4.4). */
  setGithubToken(token: string): Promise<Result<RendererConfig>>
  clearGithubToken(): Promise<Result<RendererConfig>>
  /**
   * Saves the email server (MOP-4), its password encrypted in main; an empty
   * password keeps the saved one. The renderer never gets the password back.
   */
  setEmailSettings(settings: EmailSettingsInput): Promise<Result<RendererConfig>>
  clearEmailSettings(): Promise<Result<RendererConfig>>
  /** Sends a test email to the from address, through the saved server. */
  sendTestEmail(): Promise<Result<void>>

  // --- Diagnostics ---
  /** Forwards a renderer error to main.log (rate-limited and size-capped in main). */
  logRendererError(report: RendererErrorReport): Promise<Result<void>>
  /** Copies redacted diagnostics text for a bug report to the clipboard. */
  copyDiagnostics(): Promise<Result<void>>
  /**
   * Help › Report a problem: copies the same diagnostics, then opens the
   * repository's new-issue page. The person decides whether to paste them.
   */
  reportProblem(): Promise<Result<void>>
  /** The running version, for About and What's new. */
  getAppVersion(): Promise<Result<string>>
  /** Settings › About › Open source licences (P10.2): THIRD_PARTY_NOTICES.md as text. */
  getThirdPartyNotices(): Promise<Result<string>>

  // --- Updates (P10.1) ---
  /** Where updating stands; `off` in development and portable builds. */
  getUpdateState(): Promise<Result<UpdateState>>
  /** "Check for updates": resolves once the check has answered. */
  checkForUpdates(): Promise<Result<UpdateState>>
  /** Downloads a found update when automatic downloads are off. */
  downloadUpdate(): Promise<Result<UpdateState>>
  /** Restarts into the downloaded update, now or once no agent is working. Never automatic. */
  restartToUpdate(mode: RestartToUpdateMode): Promise<Result<UpdateState>>

  // --- Windows integration (P8.2) ---
  /** Where the person is: the menu's Go list, enabled items and deep links follow it. */
  setMenuContext(context: MenuContext): Promise<Result<void>>
  /** The title bar's menu button: pops up the application menu below it, at window coordinates. */
  popupAppMenu(position: { x: number; y: number }): Promise<Result<void>>
  /** Whether this window draws its own title bar (the setting applies when the window opens). */
  getWindowChrome(): Promise<Result<{ customTitleBar: boolean }>>
  /** The custom title bar's buttons: minimise, maximise or restore, or close this window. */
  windowControl(control: WindowControl): Promise<Result<void>>
  /** Whether this window is maximised or full screen: the Maximise button's icon. */
  getWindowState(): Promise<Result<WindowState>>
  /** The window has saved the edits main asked for with `onFlushEdits` (R1.5). */
  editsFlushed(requestId: number): Promise<Result<void>>

  // --- Pop out a view (N5.8a) ---
  /**
   * Open in new window: Home (`/home`) or one project view
   * (`/projects/<id>/<view>`) in a window of its own. With eight open it opens
   * nothing and names the oldest; `closeOldest` closes that one first.
   */
  openInNewWindow(route: string, closeOldest?: boolean): Promise<Result<PopOutOpenResult>>
  /** This window's pop-out route and Reopen at start, or null in the main window. */
  getPopOut(): Promise<Result<PopOutInfo | null>>
  /** Ticks or clears this pop-out's Reopen at start. */
  setPopOutReopenAtStart(reopen: boolean): Promise<Result<void>>
  /** A link in a pop-out to somewhere else: opens in the main window and brings it forward ('/' only brings it forward). */
  openInMainWindow(path: string): Promise<Result<void>>

  // --- Sticky task on the desktop (N5.8b) ---
  /**
   * Pin to desktop: the task in a small window that stays on top. With five
   * pinned it pins nothing and names the oldest; `unpinOldest` unpins that
   * one first. Pinning a pinned task shows its window again.
   */
  pinTaskToDesktop(
    projectId: string,
    taskId: string,
    unpinOldest?: boolean
  ): Promise<Result<StickyPinResult>>
  /** Unpin: closes this sticky window, which does not reopen at start. */
  unpinStickyTask(): Promise<Result<void>>
  /** The task this sticky window shows, or null in any other window. */
  getStickyTask(): Promise<Result<StickyTaskRef | null>>
  /** Opens one task in a window of its own (MOP-12), or brings its open window forward. */
  openTaskWindow(projectId: string, taskId: string): Promise<Result<TaskWindowResult>>
  /** Moves a half-written New task into a window of its own, with its draft. */
  openNewTaskWindow(projectId: string, draft: NewTaskDraft): Promise<Result<NewTaskWindowResult>>
  /** In a New task window: the draft it opened with, once. */
  takeNewTaskDraft(): Promise<Result<NewTaskDraft | null>>
  /** In a New task window: hands the draft back to the main window and closes. */
  returnNewTaskToMain(draft: NewTaskDraft): Promise<Result<void>>
  /** In the main window: the draft a New task window handed back for a project, once. */
  takeReturnedNewTask(projectId: string): Promise<Result<NewTaskDraft | null>>
  /** A New task window handed a draft back: the project it belongs to. */
  onNewTaskReturned(callback: (projectId: string) => void): () => void
  /** Esc in a sticky window: the focus goes back to the app before it, and the window stays. */
  releaseStickyFocus(): Promise<Result<void>>

  // --- Snip to task (N4.2a) ---
  /** The command palette's Snip to task: hides this window, then captures every display. */
  startSnip(): Promise<Result<void>>
  /** The overlay's frozen picture of the display it covers. */
  getSnipPicture(displayId: number): Promise<Result<SnipOverlayPicture>>
  /** The overlay's choice; false when it was too small to be a snip and the overlays stay. */
  selectSnip(selection: SnipSelection): Promise<Result<boolean>>
  /** Esc or a right click on an overlay: every overlay closes and nothing is kept. */
  cancelSnip(): Promise<Result<void>>
  /** Quick add's Add: stores the waiting snip in the project's Library, When selected, and attaches it. */
  saveSnipToTask(
    projectId: string,
    workItemId: string,
    snipId: string
  ): Promise<Result<LibraryItem>>
  /** Quick add's Cancel: the waiting snip is dropped, unsaved. */
  discardSnip(snipId: string): Promise<Result<void>>
  /** Mark up (N4.2b): the waiting snip at its full resolution, as PNG bytes. */
  getSnipFullPicture(snipId: string): Promise<Result<PictureBytes>>
  /** Mark up's Use this picture: the marked-up PNG replaces the waiting snip; its new preview. */
  replaceSnip(snipId: string, png: Uint8Array): Promise<Result<SnipPreview>>
  /** Mark up a copy (N4.2b): a Library image's stored bytes, for the editor's canvas. */
  getLibraryImage(projectId: string, itemId: string): Promise<Result<PictureBytes>>
  /**
   * Mark up a copy (N4.2b): saves the marked-up PNG as a new Library image with
   * the original's AI access, attached to the task named (from the Library,
   * with no task, it starts unattached). The original is never changed.
   */
  saveMarkedUpCopy(
    projectId: string,
    itemId: string,
    workItemId: string | null,
    png: Uint8Array
  ): Promise<Result<LibraryItem>>

  // --- Performance (P9.1) ---
  /** The first screen (Home or a project view) has rendered: start-up work that waited may run. */
  reportFirstScreen(): Promise<Result<void>>

  // --- System ---
  openInExplorer(path: string): Promise<Result<void>>
  /** Opens an http or https link in the browser (a user guide link); anything else is refused. */
  openExternalLink(url: string): Promise<Result<void>>
  /** A file link in a text: opens or shows a file inside the project's linked folder. */
  openProjectFile(
    projectId: string,
    path: string
  ): Promise<Result<{ opened: 'opened' | 'shown' | 'held' }>>
  /** The interface language and formatting locale now (P11.1): a reloaded window checks its own. */
  getLocale(): Promise<Result<LocaleInfo>>
  openCheckout(path: string, mode: 'vscode' | 'other'): Promise<Result<void>>
  copyText(text: string): Promise<Result<void>>
  getDatabaseStats(): Promise<Result<DatabaseStats>>
  /** The background pass reading Library files for search (N4.5); null when it is not running. */
  getLibraryTextProgress(): Promise<Result<LibraryTextProgress | null>>
  pruneDatabase(olderThanDays: number): Promise<Result<{ deletedCount: number }>>

  // --- Backups ---
  /** Every backup in the data folder, newest first. */
  listBackups(): Promise<Result<BackupEntry[]>>
  /** Backs up now (a `manual` backup, never deleted automatically). */
  createBackup(): Promise<Result<BackupEntry>>
  /** Saves the current data as a backup, then restarts Ostler and restores `backupId`. */
  restoreBackup(backupId: string): Promise<Result<void>>
  deleteBackup(backupId: string): Promise<Result<void>>
  openBackupsFolder(): Promise<Result<void>>
  /** Where backups are also copied (N6.1), when the last copy was made, and any sync service. */
  getBackupCopyStatus(): Promise<Result<BackupCopyStatus>>
  /**
   * Asks for a folder to also copy backups to. Null when the person cancels.
   * Refuses a folder inside the data folder or a read-only one.
   */
  chooseBackupCopyFolder(): Promise<Result<BackupCopyStatus | null>>
  /** Stops copying backups to the second place; copies already there stay. */
  stopBackupCopy(): Promise<Result<BackupCopyStatus>>
  /** The backups Ostler copied to the second place, newest first. */
  listSecondPlaceBackups(): Promise<Result<BackupEntry[]>>
  /** Copies a backup from the second place into the backups folder, then restores it as restoreBackup does. */
  restoreFromSecondPlace(backupId: string): Promise<Result<void>>

  // --- Sharing a project through a synced folder ---
  /** How the project's sharing stands on this PC; null when it isn't shared. */
  getShareState(projectId: string): Promise<Result<ShareState | null>>
  /** Who joined, left, was removed or changed role in the shared project, newest first; empty when it isn't shared. */
  getMembershipHistory(projectId: string): Promise<Result<MembershipEvent[]>>
  /** Shows the project's shared folder in Explorer (the folder it is synced through). */
  openShareFolder(projectId: string): Promise<Result<void>>
  /** The sync apps' folders on this PC that a project can be shared through. */
  listSyncPlaces(): Promise<Result<SyncPlaceView[]>>
  /**
   * Shares the project through a new folder in `place`, one of `listSyncPlaces`, or,
   * without one, a folder the person picks in main's picker; then puts the invite on
   * the clipboard. Null when the person cancels.
   */
  shareProject(projectId: string, place?: string): Promise<Result<ShareState | null>>
  /**
   * Shares the project through the sync server (phase 7) and puts the invite on
   * the clipboard; whoever joins needs no folder.
   */
  shareProjectOnServer(projectId: string): Promise<Result<ShareState | null>>
  /** Shares a project through a new folder in this PC's Google Drive (mobile plan, phase 3). */
  shareProjectOnDrive(projectId: string): Promise<Result<ShareState | null>>
  /** Whether a Google account with Drive sync is connected, so a project can be shared through Drive. */
  getDriveSharingReady(): Promise<Result<boolean>>
  /**
   * Gives a person access to the project's Google Drive folder: Google emails them a link.
   * Viewers get read access, Owners and Editors write access. Only the project's Owner may.
   */
  grantDriveAccess(projectId: string, email: string, role: ShareRole): Promise<Result<void>>
  /**
   * Puts the project's invite message on the clipboard, giving the joiner `role` (an
   * Editor by default): the steps to get the shared folder and the join link. Only an
   * Owner may. The invite never comes back to the renderer.
   */
  copyShareInvite(projectId: string, role?: ShareRole): Promise<Result<void>>
  /** Emails the same invite message to one address, through the saved email server (MOP-4). */
  emailShareInvite(projectId: string, role: ShareRole, to: string): Promise<Result<void>>
  /**
   * Joins a shared project from a pasted invite, or from the invite a join link
   * left in main (`inviteId`): finds the shared folder on this PC by itself, adds the
   * project to the list and loads it. `waiting` when the folder is not here yet; null
   * when the person cancels.
   */
  joinShare(invite: string): Promise<Result<JoinShareResult | null>>
  /** Joins the same way, but asks the person to choose the folder (the old dialog). */
  joinShareChooseFolder(invite: string): Promise<Result<JoinShareResult | null>>
  /** Stops sharing the project on this PC; it stays here with everything it has. */
  leaveShare(projectId: string): Promise<Result<void>>
  /** Sends and reads the project's changes now. */
  syncShareNow(projectId: string): Promise<Result<ShareState | null>>
  /**
   * Removes another member: the project moves to a new key they never get.
   * They keep what they already had.
   */
  removeShareMember(projectId: string, memberId: string): Promise<Result<ShareState | null>>
  /**
   * Owner only: every invite sent so far stops working; later invites do. No one is removed.
   * Refused until every member's PC understands it.
   */
  stopOldInvites(projectId: string): Promise<Result<ShareState | null>>
  /** Removes every device of one person (their `personKey`) from a shared project. */
  removeSharePerson(
    projectId: string,
    personKey: string,
    /** A person to give their open tasks in this project to first; null leaves them with nobody; omitted leaves them as they are. */
    giveOpenTasksTo?: string | null
  ): Promise<Result<ShareState | null>>
  /** Changes a person's role in a shared project (Owner, Editor or Viewer). Only an Owner may. */
  setShareRole(
    projectId: string,
    personKey: string,
    role: ShareRole
  ): Promise<Result<ShareState | null>>
  /** "Is this Bob?": the people in a shared project this PC may merge with a member (D12). */
  getPersonLinks(projectId: string): Promise<Result<PersonLinkCandidate[]>>
  /** Answers one. Yes merges the two people; No is not asked again. Returns what is left to ask. */
  answerPersonLink(
    projectId: string,
    personKey: string,
    candidatePersonId: string,
    answer: 'yes' | 'no'
  ): Promise<Result<PersonLinkCandidate[]>>

  // --- The personal space: this person's devices (people and devices, D13, D16, D20) ---
  /** This PC's personal space: its devices, and the devices asking to join with their codes. */
  getPersonalSpace(): Promise<Result<PersonalSpaceState>>
  // --- Advanced sync: the personal space copied to a Cloudflare R2 bucket ---
  getR2Sync(): Promise<Result<R2SyncState>>
  /** Saves the bucket and the schedule (a blank secret keeps the saved one) and restarts copying. */
  setR2Sync(input: SetR2SyncInput): Promise<Result<R2SyncState>>
  /** Tries the bucket with these settings (or the saved ones); an error says what failed. */
  testR2Sync(input?: SetR2SyncInput): Promise<Result<true>>
  clearR2Sync(): Promise<Result<R2SyncState>>
  /** Copies both ways now, whatever the schedule. */
  r2SyncNow(): Promise<Result<R2SyncState>>
  /** A sealed setup code with the saved bucket, and its passphrase, for a phone or another PC. */
  exportR2Setup(): Promise<Result<R2SetupCodeView>>
  /** Saves the bucket from a setup code and turns copying on. */
  importR2Setup(code: string, passphrase: string): Promise<Result<R2SyncState>>
  /**
   * Makes this PC's personal space in `place`, one of the state's `places` or
   * `DRIVE_PLACE_CHOICE` (Google Drive, when the state's `driveReady`), or, without one, in a
   * folder the person picks in main's picker. Null when the person cancels.
   */
  createPersonalSpace(
    deviceName?: string,
    place?: string
  ): Promise<Result<PersonalSpaceState | null>>
  /** Asks the personal space found on this PC to let this PC join. The same code shows on both screens. */
  requestPairing(deviceName?: string): Promise<Result<PersonalSpaceState>>
  /**
   * Asks to join the personal space in a folder the person picks in main's picker (the space's
   * folder, or one it is somewhere inside). Null when the person cancels.
   */
  choosePersonalSpace(deviceName?: string): Promise<Result<PersonalSpaceState | null>>
  /** Stops waiting to join; the request stays in the space, harmless, until a device answers it. */
  cancelPairing(): Promise<Result<PersonalSpaceState>>
  /**
   * For a space no device can let this one into: moves the found space's own folders aside (into
   * "Old personal space …" in the same place; nothing deleted) and makes this PC's new space there.
   */
  startNewPersonalSpace(deviceName?: string): Promise<Result<PersonalSpaceState>>
  /** Lets a device that asked to join in, once its code matches on both screens. */
  allowDevice(deviceId: string): Promise<Result<PersonalSpaceState>>
  /** Removes one of this person's devices from the personal space and from the shared projects. */
  removeDevice(deviceId: string): Promise<Result<PersonalSpaceState>>

  // --- Connected accounts ---
  listAccounts(): Promise<Result<ConnectedAccount[]>>
  listAccountProviders(): Promise<Result<AccountProviderInfo[]>>
  /** OAuth opens the system browser; CalDAV checks the server and password. */
  connectAccount(input: ConnectAccountInput): Promise<Result<ConnectedAccount>>
  /** Signs in again asking for more (writing back, tasks). */
  addAccountCapabilities(
    id: string,
    capabilities: AccountCapability[]
  ): Promise<Result<ConnectedAccount>>
  disconnectAccount(id: string): Promise<Result<void>>
  setAccountApp(input: AccountAppInput): Promise<Result<AccountProviderInfo[]>>
  removeAccountApp(provider: AccountProvider): Promise<Result<AccountProviderInfo[]>>
  onAccountsChange(callback: () => void): () => void
  /** The calendars a connected account has, and which are already added. */
  listAccountCalendars(accountId: string): Promise<Result<AccountCalendarChoice[]>>
  addAccountCalendar(input: AddAccountCalendarInput): Promise<Result<OutsideCalendar>>
  /** A To Do or Google Tasks account's lists (phase 6). */
  listTaskLists(accountId: string): Promise<Result<AccountTaskList[]>>
  /** The list my open tasks are copied into, or null. */
  getTaskListTarget(): Promise<Result<TaskListTarget | null>>
  /** What your organisation's policy sets (phase 7); no client IDs. */
  getPolicy(): Promise<Result<PolicySummary>>
  /** The sync server projects can be shared through (phase 7). */
  getSyncServer(): Promise<Result<SyncServerState | null>>
  /** Saves the sync server; an access key comes in once and never comes back. */
  setSyncServer(input: SetSyncServerInput): Promise<Result<SyncServerState | null>>
  /** Forgets the sync server and its key; projects shared through it stop syncing. */
  clearSyncServer(): Promise<Result<SyncServerState | null>>
  /** Copies my open tasks into this list from now on; null stops and deletes the open copies. */
  setTaskListTarget(input: SetTaskListTargetInput | null): Promise<Result<TaskListTarget | null>>
  /** The calendar time blocks are copied into (phase 6), or null. */
  getCalendarWriteTarget(): Promise<Result<CalendarWriteTarget | null>>
  /** Copies time blocks into this calendar from now on; null stops and deletes the copies. */
  setCalendarWriteTarget(
    input: SetCalendarWriteTargetInput | null
  ): Promise<Result<CalendarWriteTarget | null>>
  /** A project's webhooks to Teams, Slack, Discord or any https endpoint (phase 4). */
  listWebhooks(projectId: string): Promise<Result<ProjectWebhook[]>>
  addWebhook(input: AddWebhookInput): Promise<Result<ProjectWebhook>>
  updateWebhook(id: string, input: UpdateWebhookInput): Promise<Result<ProjectWebhook>>
  removeWebhook(id: string): Promise<Result<void>>
  /** Posts a test message now; the webhook afterwards, with any failure. */
  testWebhook(id: string): Promise<Result<ProjectWebhook>>
  /** A cloud file link's current name through a connected account; null for other links. */
  readCloudFile(url: string): Promise<Result<CloudFileRead | null>>
  /** Reads a connected account's contacts for Import contacts, matched like a `.vcf` file. */
  readAccountContacts(accountId: string): Promise<
    Result<{
      fileName: string
      cards: { card: VCardContact; match: Contact | null }[]
      skipped: number
      tooManyCards: boolean
    }>
  >

  // --- Code workspace ---
  listCodeDirectory(
    projectId: string,
    rootPath: string,
    relativePath: string
  ): Promise<Result<CodeDirEntry[]>>
  readCodeFile(projectId: string, rootPath: string, relativePath: string): Promise<Result<string>>
  writeCodeFile(
    projectId: string,
    rootPath: string,
    relativePath: string,
    content: string
  ): Promise<Result<void>>
  runCodeCommand(
    projectId: string,
    rootPath: string,
    runId: string,
    command: string
  ): Promise<Result<void>>
  cancelCodeCommand(runId: string): Promise<Result<void>>

  // --- Project Library ---
  listLibraryItems(projectId: string, query?: LibraryQuery): Promise<Result<LibraryItem[]>>
  getLibraryItem(projectId: string, itemId: string): Promise<Result<LibraryItem>>
  /** Extracted text for documents, the body for everything else. */
  getLibraryItemText(projectId: string, itemId: string): Promise<Result<string>>
  createLibraryItem(projectId: string, input: CreateLibraryItemInput): Promise<Result<LibraryItem>>
  /** Bumps the revision and stores one when title, summary or body change. */
  updateLibraryItem(
    projectId: string,
    itemId: string,
    updates: UpdateLibraryItemInput
  ): Promise<Result<LibraryItem>>
  /** Makes the brief primary; null clears the project's primary brief. */
  setPrimaryBrief(projectId: string, itemId: string | null): Promise<Result<LibraryItem | null>>
  archiveLibraryItem(projectId: string, itemId: string): Promise<Result<LibraryItem>>
  unarchiveLibraryItem(projectId: string, itemId: string): Promise<Result<LibraryItem>>
  /** Permanent: removes the item, its revisions, links and stored files. */
  deleteLibraryItem(projectId: string, itemId: string): Promise<Result<void>>
  listLibraryRevisions(projectId: string, itemId: string): Promise<Result<LibraryRevision[]>>
  restoreLibraryRevision(
    projectId: string,
    itemId: string,
    revision: number
  ): Promise<Result<LibraryItem>>
  /** Bytes from drop or paste; no path ever crosses IPC. */
  importLibraryFiles(
    projectId: string,
    files: ImportLibraryFileInput[]
  ): Promise<Result<ImportLibraryResult[]>>
  /**
   * Main opens the file picker and imports what is chosen; empty when
   * cancelled. With `only: 'image'` the picker offers pictures alone and is
   * titled "Insert pictures".
   */
  pickLibraryFiles(
    projectId: string,
    options?: { only?: 'image' }
  ): Promise<Result<ImportLibraryResult[]>>
  /**
   * Main keeps what the clipboard holds: a picture, a copied file, a web
   * address as a link or text as a note; with `only: 'image'`, a picture
   * alone. Null when the clipboard holds nothing it can keep.
   */
  importLibraryFromClipboard(
    projectId: string,
    options?: { only?: 'image' }
  ): Promise<Result<ImportLibraryResult | null>>
  /** Documents and images open their stored copy; links open in the browser (http/https). */
  openLibraryItemExternally(projectId: string, itemId: string): Promise<Result<void>>
  addWorkItemSource(
    projectId: string,
    workItemId: string,
    itemId: string
  ): Promise<Result<WorkItemSource[]>>
  removeWorkItemSource(
    projectId: string,
    workItemId: string,
    itemId: string
  ): Promise<Result<WorkItemSource[]>>
  listWorkItemSources(projectId: string, workItemId: string): Promise<Result<WorkItemSource[]>>
  listItemWorkItems(projectId: string, itemId: string): Promise<Result<LibraryItemSourceLink[]>>
  /** Ids of work items with a source edited since it was linked (the board marker). */
  listWorkItemsWithChangedSources(projectId: string): Promise<Result<string[]>>
  /** Agent attachment counts per work item id (the board's "N attached" chip). */
  countWorkItemAttachments(projectId: string): Promise<Result<Record<string, number>>>
  attachToWorkItem(
    projectId: string,
    workItemId: string,
    itemId: string,
    attachedBy: LibraryAttachedBy
  ): Promise<Result<WorkItemAttachment[]>>
  detachFromWorkItem(
    projectId: string,
    workItemId: string,
    itemId: string
  ): Promise<Result<WorkItemAttachment[]>>
  listWorkItemAttachments(
    projectId: string,
    workItemId: string
  ): Promise<Result<WorkItemAttachment[]>>
  listItemAttachments(
    projectId: string,
    itemId: string
  ): Promise<Result<LibraryItemAttachmentLink[]>>
  /** What a library context holds; `use` picks the chat's budget (default) or a planning action's. */
  getLibraryAiContextSummary(
    projectId: string,
    selectedItemIds?: string[],
    use?: LibraryContextUse
  ): Promise<Result<LibraryAiContextSummary>>

  // --- Whiteboards (Library items of kind 'whiteboard') ---
  /** Makes a whiteboard, with any first objects; the Library lists change. */
  createWhiteboard(
    projectId: string,
    input: CreateWhiteboardInput
  ): Promise<Result<WhiteboardDocument>>
  /** A whiteboard and its objects, back to front. */
  getWhiteboard(projectId: string, whiteboardId: string): Promise<Result<WhiteboardDocument>>
  /** One save from the editor; no Library broadcast, so the editor does not reload itself. */
  saveWhiteboard(
    projectId: string,
    whiteboardId: string,
    input: WhiteboardSaveInput
  ): Promise<Result<WhiteboardSaveResult>>
  /**
   * Make tasks from whiteboard objects (prompt 13, D17): one task per object, in an optional
   * milestone, with the whiteboard as each task's source. The editor links the objects.
   */
  makeWhiteboardTasks(
    projectId: string,
    input: MakeWhiteboardTasksInput
  ): Promise<Result<MakeWhiteboardTasksResult>>
  /** The one undo for makeWhiteboardTasks: deletes its tasks and clears the links to them. */
  undoWhiteboardTasks(projectId: string, input: UndoWhiteboardTasksInput): Promise<Result<void>>
  /**
   * Export (prompt 16, D15): main asks where to save a PNG or SVG the renderer drew of the board
   * and writes its bytes; the path, or null when cancelled.
   */
  saveWhiteboardImage(
    projectId: string,
    input: SaveWhiteboardImageInput
  ): Promise<Result<string | null>>
  /** Saves the stored board as a `.whiteboard.json` file with its pictures, where the person chooses. */
  exportWhiteboardFile(
    projectId: string,
    whiteboardId: string
  ): Promise<Result<ExportWhiteboardFileResult>>
  /** Main's open dialog; the chosen whiteboard file becomes a new whiteboard. Null when cancelled. */
  importWhiteboardFile(projectId: string): Promise<Result<LibraryItem | null>>
  /**
   * Print… or Save as PDF… (prompt 17, D15): main draws the board in its print window. For a PDF,
   * the saved file's path; null when printed, or when the save dialog is cancelled.
   */
  printWhiteboard(request: WhiteboardPrintRequest): Promise<Result<string | null>>

  // --- Subscriptions (returns unsubscribe function) ---
  onWatchEvent(callback: (event: WatchEvent) => void): () => void
  onAIStreamChunk(callback: (chunk: AIStreamChunk) => void): () => void
  onProjectStateChange(callback: (state: ProjectStateUpdate) => void): () => void
  onNotification(callback: (notification: OstlerNotification) => void): () => void
  onTaskSplitProgress(callback: (job: TaskSplitJob) => void): () => void
  onAskOstlerProgress(callback: (progress: AskOstlerProgress) => void): () => void
  /** A Try it run changed: its state, output or leftover files (N9.4). */
  onTryRunChanged(callback: (run: TryRun) => void): () => void
  onCodeCommandOutput(callback: (event: CodeCommandOutputEvent) => void): () => void
  /** Windows' accent colour (`#RRGGBB`) whenever the user changes it. */
  onWindowsAccentChanged(callback: (color: string | null) => void): () => void
  /** The interface language or formatting locale changed (P11.1). */
  onLocaleChanged(callback: (locale: LocaleInfo) => void): () => void
  /** Main asks the window to open something: a clicked notification (P5.6). */
  onNavigate(callback: (request: NavigateRequest) => void): () => void
  /** A command from the application menu, the title bar's menu button or the tray (P8.2). */
  onAppCommand(callback: (command: AppCommand) => void): () => void
  /** This window was maximised, restored, or went in or out of full screen. */
  onWindowState(callback: (state: WindowState) => void): () => void
  /** Updating moved on: checking, downloading, ready to restart (P10.1). */
  onUpdateState(callback: (state: UpdateState) => void): () => void
  /** A time entry or the timer changed, from any surface (R2.3). */
  onTimeChange(callback: (change: { projectId: string }) => void): () => void
  /** The focus started, ended, finished or its break changed, from any surface (N3.5). */
  onFocusChange(callback: (change: FocusChange) => void): () => void
  /**
   * Ostler is quitting: save edits still waiting for their pause, then answer
   * with `editsFlushed(requestId)` (R1.5, D30).
   */
  onFlushEdits(callback: (requestId: number) => void): () => void
  /** The main window: a pop-out asked to open this path here (N5.8a). */
  onOpenInMainWindow(callback: (path: string) => void): () => void

  // --- Values ---
  /**
   * The appearance main started this window with (theme, density, accent),
   * read-only. Applied before React renders, so there is no flash of the
   * wrong theme. Null if the window was opened without it.
   */
  readonly initialAppearance: Readonly<InitialAppearance> | null
  /** The language and formatting locale the window opened in (P11.1). */
  readonly initialLocale: Readonly<LocaleInfo> | null
}
