// First: saved view settings move from before the rename, so nothing reads the old keys.
import './lib/legacy-storage'
// Then: sets the theme on <html> before anything renders (no flash).
import './ui/theme/bootstrap'
import { applyInitialLocale } from './i18n/LocaleProvider'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import {
  parseMyWeekHash,
  parsePrintHash,
  parseRoundsHash,
  parseTimeReportHash,
  parseTimelineOverviewHash,
  parseWhiteboardHash,
  parseYearInReviewHash
} from '@shared/print-route'
import { parseSnipHash } from '@shared/snip'
import { parsePopOutHash } from '@shared/pop-out'
import { parseNewTaskHash } from '@shared/new-task-window'
import { parseTaskWindowHash } from '@shared/task-window'
import { parseStickyTaskHash } from '@shared/sticky-task'
import { App } from './App'
import { lazyNamed } from './lib/lazy-named'
import './styles/global.css'
import { forwardRendererErrors } from './lib/report-renderer-errors'

forwardRendererErrors()

// Before anything renders: the language the window opened in (P11.1).
applyInitialLocale()

// Main's offscreen print window (P6.1) opens the same page on the print
// route: the view alone, without the app around it.
const printRoute = parsePrintHash(window.location.hash.slice(1))
const myWeekRoute = parseMyWeekHash(window.location.hash.slice(1))
const timelineOverviewRoute = parseTimelineOverviewHash(window.location.hash.slice(1))
const roundsRoute = parseRoundsHash(window.location.hash.slice(1))
const timeReportRoute = parseTimeReportHash(window.location.hash.slice(1))
const yearInReviewRoute = parseYearInReviewHash(window.location.hash.slice(1))
const whiteboardRoute = parseWhiteboardHash(window.location.hash.slice(1))
// Snip to task's overlays (N4.2a) open the same page on the snip route.
const snipRoute = parseSnipHash(window.location.hash.slice(1))
// A pop-out window (N5.8a) opens the same page on the pop-out route: one view, no sidebar.
const popOutRoute = parsePopOutHash(window.location.hash.slice(1))
// A sticky task (N5.8b) opens the same page on the sticky route: one task, on top.
const stickyTask = parseStickyTaskHash(window.location.hash.slice(1))
// New task in a window of its own opens the same page on the new-task route: the form alone.
const newTask = parseNewTaskHash(window.location.hash.slice(1))
// A task in a window of its own (MOP-12) opens the same page on the task-window route: its drawer alone.
const taskWindow = parseTaskWindowHash(window.location.hash.slice(1))

// Only the print window needs the print page, so it loads only there.
const PrintPage = lazyNamed(() => import('./views/print/PrintPage'), 'PrintPage')
const MyWeekPrintPage = lazyNamed(() => import('./views/print/MyWeekPrintPage'), 'MyWeekPrintPage')
const TimelineOverviewPrintPage = lazyNamed(
  () => import('./views/print/TimelineOverviewPrintPage'),
  'TimelineOverviewPrintPage'
)
const RoundsPrintPage = lazyNamed(() => import('./views/print/RoundsPrintPage'), 'RoundsPrintPage')
const ShoppingPrintPage = lazyNamed(
  () => import('./views/print/ShoppingPrintPage'),
  'ShoppingPrintPage'
)
const TimeReportPrintPage = lazyNamed(
  () => import('./views/print/TimeReportPrintPage'),
  'TimeReportPrintPage'
)
const YearInReviewPrintPage = lazyNamed(
  () => import('./views/print/YearInReviewPrintPage'),
  'YearInReviewPrintPage'
)
const WhiteboardPrintPage = lazyNamed(
  () => import('./views/print/WhiteboardPrintPage'),
  'WhiteboardPrintPage'
)

const SnipOverlay = lazyNamed(() => import('./views/snip/SnipOverlay'), 'SnipOverlay')

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    {snipRoute ? (
      <Suspense fallback={null}>
        <SnipOverlay displayId={snipRoute.displayId} />
      </Suspense>
    ) : printRoute ? (
      <Suspense fallback={null}>
        {printRoute.view === 'shopping' ? (
          <ShoppingPrintPage route={printRoute} />
        ) : (
          <PrintPage route={printRoute} />
        )}
      </Suspense>
    ) : myWeekRoute ? (
      <Suspense fallback={null}>
        <MyWeekPrintPage route={myWeekRoute} />
      </Suspense>
    ) : timelineOverviewRoute ? (
      <Suspense fallback={null}>
        <TimelineOverviewPrintPage route={timelineOverviewRoute} />
      </Suspense>
    ) : roundsRoute ? (
      <Suspense fallback={null}>
        <RoundsPrintPage route={roundsRoute} />
      </Suspense>
    ) : timeReportRoute ? (
      <Suspense fallback={null}>
        <TimeReportPrintPage route={timeReportRoute} />
      </Suspense>
    ) : yearInReviewRoute ? (
      <Suspense fallback={null}>
        <YearInReviewPrintPage route={yearInReviewRoute} />
      </Suspense>
    ) : whiteboardRoute ? (
      <Suspense fallback={null}>
        <WhiteboardPrintPage route={whiteboardRoute} />
      </Suspense>
    ) : (
      <App
        popOutRoute={popOutRoute}
        stickyTask={stickyTask}
        newTask={newTask}
        taskWindow={taskWindow}
      />
    )}
  </StrictMode>
)
