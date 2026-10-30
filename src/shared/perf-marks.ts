/**
 * The names of the `performance.mark`s Ostler sets at its key moments (P9.1).
 * The perf suite (`tests/perf/`) reads them from the main process and the
 * window; `docs/performance.md` says what each budget measures from them.
 * Marks cost next to nothing, so they are set in every build.
 */
export const PERF_MARKS = {
  /** Main: the first line of `main.ts` ran. */
  mainStart: 'ostler:main-start',
  /** Main: every service is constructed (the data folder was prepared first). */
  servicesCreated: 'ostler:services-created',
  /** Main: the window was created. */
  windowCreated: 'ostler:window-created',
  /** Main: the start-up work deferred until Home rendered has run. */
  deferredStartup: 'ostler:deferred-startup',
  /** Window: Home's Today, Upcoming and Needs you lists have their first data. */
  homeRendered: 'ostler:home-rendered',
  /** Window: a project view has its project's tasks and has painted. Set on every switch. */
  projectViewRendered: 'ostler:project-view-rendered',
  /** Window: My work (R3.1) has its tasks and has painted. Set on every load. */
  myWorkRendered: 'ostler:my-work-rendered',
  /** Window: Workload (R3.2) has its tasks and has painted. Set on every load. */
  workloadRendered: 'ostler:workload-rendered',
  /** Window: the Timeline across projects (N5.4) has its projects' milestones and has painted. Set on every load. */
  timelineOverviewRendered: 'ostler:timeline-overview-rendered',
  /**
   * Window: a whiteboard open on the Plan has its objects drawn and has painted
   * (plan `docs/plans/whiteboards/`, prompt 19a). detail.key is the board's id.
   */
  whiteboardRendered: 'ostler:whiteboard-rendered',
  /** Window: a search request was sent, after typing settled (detail.key is the query). */
  searchStarted: 'ostler:search-started',
  /** Window: search results for a query are on screen. Set for every query. */
  searchResultsShown: 'ostler:search-results-shown'
} as const

export type PerfMark = (typeof PERF_MARKS)[keyof typeof PERF_MARKS]
