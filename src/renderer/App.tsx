import React, { Suspense, lazy, type ReactNode } from 'react'
import { MemoryRouter, Navigate, Routes, Route } from 'react-router-dom'
import { OstlerProvider } from './context/OstlerContext'
import { ColumnsProvider } from './context/ColumnsContext'
import { DaysOffProvider } from './context/DaysOffContext'
import { CalendarsProvider } from './context/CalendarsContext'
import { PeopleProvider } from './context/PeopleContext'
import { AppShell } from './shell/AppShell'
import { PopOutShell } from './shell/PopOutShell'
import { NewTaskWindow } from './shell/NewTaskWindow'
import { TaskWindow } from './shell/TaskWindow'
import type { TaskWindowRef } from '@shared/task-window'
import { StickyTaskWindow } from './sticky/StickyTaskWindow'
import type { StickyTaskRef } from '@shared/sticky-task'
import { HomeView } from './views/home/HomeView'
import { ProjectWorkspace } from './views/workspace/ProjectWorkspace'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './ui/theme/ThemeProvider'
import { AnnouncerProvider, ConfirmProvider, ToastProvider } from './ui'
import { MoveDependentsProvider } from './components/move-dependents/MoveDependentsProvider'
import { LessonOfferHost } from './views/planning/RememberLesson'
import { FeaturesProvider } from './navigation/features'
import { homePath } from './navigation/paths'
import { GLOBAL_VIEWS } from './navigation/registry'
import { FirstRunGate } from './welcome/FirstRunGate'
import { LanguageBoundary, LocaleProvider } from './i18n/LocaleProvider'
import { DemoLanguageOffer } from './components/DemoLanguageOffer'
import { lazyNamed } from './lib/lazy-named'
import { Spinner } from './ui'
import './styles/ostler-theme.css'
import { t } from '@shared/i18n'

// The component gallery (/dev/ui) exists in development builds only: the
// dynamic import sits behind import.meta.env.DEV, so production drops it.
const UiGallery = import.meta.env.DEV
  ? lazy(() => import('./views/dev/UiGallery').then((module) => ({ default: module.UiGallery })))
  : null

// Home and the project workspace load with the app; the other pages load
// when first opened (P9.1). Settings and the user guide are the big ones.
const SettingsView = lazyNamed(() => import('./views/SettingsView'), 'SettingsView')
const InboxView = lazyNamed(() => import('./views/inbox/InboxView'), 'InboxView')
// My work's code is the registry's, warmed after the first screen like the project views'.
const MyWorkView = GLOBAL_VIEWS.find((view) => view.id === 'my-work')!.element!
const SearchView = lazyNamed(() => import('./views/search/SearchView'), 'SearchView')
const TimesheetView = lazyNamed(() => import('./views/timesheet/TimesheetView'), 'TimesheetView')
// Workload's code is the registry's too (R3.2).
const WorkloadView = GLOBAL_VIEWS.find((view) => view.id === 'workload')!.element!
const TeamView = GLOBAL_VIEWS.find((view) => view.id === 'team')!.element!
// So is the weekly review's (N1.5).
const WeeklyReviewView = GLOBAL_VIEWS.find((view) => view.id === 'weekly-review')!.element!
// And the Timeline across projects' (N5.4).
const TimelineOverviewView = GLOBAL_VIEWS.find((view) => view.id === 'timeline-overview')!.element!
// And Contacts' (N6.5).
const ContactsView = GLOBAL_VIEWS.find((view) => view.id === 'contacts')!.element!
// And the undo history's.
const UndoHistoryView = GLOBAL_VIEWS.find((view) => view.id === 'undo-history')!.element!
// And Goals' (N5.6b).
const GoalsView = GLOBAL_VIEWS.find((view) => view.id === 'goals')!.element!
const HelpView = lazyNamed(() => import('./views/help/HelpView'), 'HelpView')

/** A page that loads on first use, with a spinner while it does. */
function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="ostler-workspace-loading">
          <Spinner label={t('navigation:app.loading')} />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

/**
 * Where the app opens: `/` (which goes to Home), or the internal path in the
 * page's hash (`index.html#/projects/…`). The hash is how the end-to-end
 * tests open an old link, and where P8.2's deep links can land.
 */
function startPath(popOutRoute: string | null, sticky: boolean): string {
  if (popOutRoute) return popOutRoute
  if (sticky) return '/'
  const hash = window.location.hash.slice(1)
  return hash.startsWith('/') ? hash : '/'
}

/**
 * The app. In a pop-out window (N5.8a) `popOutRoute` is the one view it shows,
 * under the pop-out's own slim shell instead of the sidebar and status bar.
 * In a sticky window (N5.8b) `stickyTask` is the one task it shows, alone.
 */
export function App({
  popOutRoute = null,
  stickyTask = null,
  newTask = null,
  taskWindow = null
}: {
  popOutRoute?: string | null
  stickyTask?: StickyTaskRef | null
  newTask?: { projectId: string } | null
  taskWindow?: TaskWindowRef | null
} = {}) {
  const ownWindow = stickyTask !== null || newTask !== null || taskWindow !== null
  return (
    <LocaleProvider>
      <ErrorBoundary scope="app">
        <ThemeProvider>
          <AnnouncerProvider>
            <ToastProvider>
              <ConfirmProvider>
                <MoveDependentsProvider>
                  <LessonOfferHost />
                  <OstlerProvider>
                    <FeaturesProvider>
                      <ColumnsProvider>
                        <PeopleProvider>
                          <DaysOffProvider>
                            <CalendarsProvider>
                              <MemoryRouter initialEntries={[startPath(popOutRoute, ownWindow)]}>
                                {!popOutRoute && !ownWindow && <DemoLanguageOffer />}
                                <LanguageBoundary>
                                  {stickyTask ? (
                                    <StickyTaskWindow taskRef={stickyTask} />
                                  ) : newTask ? (
                                    <NewTaskWindow projectId={newTask.projectId} />
                                  ) : taskWindow ? (
                                    <TaskWindow taskRef={taskWindow} />
                                  ) : (
                                    <FirstRunGate>
                                      <Routes>
                                        <Route
                                          path="/"
                                          element={
                                            popOutRoute ? (
                                              <PopOutShell route={popOutRoute} />
                                            ) : (
                                              <AppShell />
                                            )
                                          }
                                        >
                                          {/* Paths from navigation/paths.ts. */}
                                          <Route path="home" element={<HomeView />} />
                                          <Route
                                            path="inbox"
                                            element={
                                              <Page>
                                                <InboxView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="my-work"
                                            element={
                                              <Page>
                                                <MyWorkView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="search"
                                            element={
                                              <Page>
                                                <SearchView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="timesheet"
                                            element={
                                              <Page>
                                                <TimesheetView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="workload"
                                            element={
                                              <Page>
                                                <WorkloadView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="team"
                                            element={
                                              <Page>
                                                <TeamView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="weekly-review"
                                            element={
                                              <Page>
                                                <WeeklyReviewView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="timeline"
                                            element={
                                              <Page>
                                                <TimelineOverviewView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="contacts"
                                            element={
                                              <Page>
                                                <ContactsView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="undo-history"
                                            element={
                                              <Page>
                                                <UndoHistoryView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="goals"
                                            element={
                                              <Page>
                                                <GoalsView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="projects/:projectId/*"
                                            element={<ProjectWorkspace />}
                                          />
                                          <Route
                                            path="help"
                                            element={
                                              <Page>
                                                <HelpView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="help/:page"
                                            element={
                                              <Page>
                                                <HelpView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="settings"
                                            element={
                                              <Page>
                                                <SettingsView />
                                              </Page>
                                            }
                                          />
                                          <Route
                                            path="settings/:section"
                                            element={
                                              <Page>
                                                <SettingsView />
                                              </Page>
                                            }
                                          />
                                          {UiGallery && (
                                            <Route
                                              path="dev/ui"
                                              element={
                                                <Suspense fallback={null}>
                                                  <UiGallery />
                                                </Suspense>
                                              }
                                            />
                                          )}
                                          {/* `/` and any unknown path open Home. */}
                                          <Route
                                            index
                                            element={<Navigate to={homePath()} replace />}
                                          />
                                          <Route
                                            path="*"
                                            element={<Navigate to={homePath()} replace />}
                                          />
                                        </Route>
                                      </Routes>
                                    </FirstRunGate>
                                  )}
                                </LanguageBoundary>
                              </MemoryRouter>
                            </CalendarsProvider>
                          </DaysOffProvider>
                        </PeopleProvider>
                      </ColumnsProvider>
                    </FeaturesProvider>
                  </OstlerProvider>
                </MoveDependentsProvider>
              </ConfirmProvider>
            </ToastProvider>
          </AnnouncerProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </LocaleProvider>
  )
}
