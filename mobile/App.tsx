import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  AppState,
  BackHandler,
  Linking,
  Pressable,
  RefreshControl,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { Inbox, type InboxTarget } from './src/screens/Inbox'
import { NeedsYou } from './src/screens/NeedsYou'
import { WeeklyReview } from './src/screens/WeeklyReview'
import { Timesheet } from './src/screens/Timesheet'
import { Team } from './src/screens/Team'
import { Contacts } from './src/screens/Contacts'
import { LibraryReader } from './src/screens/ProjectLibrary'
import { QuickCapture } from './src/screens/QuickCapture'
import { projectName } from './src/data/project-display'
import { RunningTimerBar } from './src/screens/TaskTime'
import { Join } from './src/screens/Join'
import { Pairing } from './src/screens/Pairing'
import { MyDay } from './src/screens/MyDay'
import { Project, type ProjectView } from './src/screens/Project'
import { Projects } from './src/screens/Projects'
import { Search } from './src/screens/Search'
import { Settings } from './src/screens/Settings'
import { TaskDetail } from './src/screens/TaskDetail'
import { TopBar } from './src/screens/TopBar'
import { useIsDark, useTheme } from './src/theme'
import { BRAND } from '../src/shared/brand'
import { findInvite } from '../src/shared/deep-link'
import { itemLinkTarget } from '../src/shared/item-links'
import type { ItemLinkRef } from '@shared/ostler-api'
import { t } from '@shared/i18n/index'
import {
  LATEST_SCHEMA_VERSION,
  migrate,
  openDatabase,
  readSchemaVersion,
  type OstlerDatabase
} from './src/db/database'
import { currentAccount } from './src/google/account'
import { inboxList } from './src/data/inbox'
import { needsYou } from './src/data/needs-you'
import { today } from './src/data/queries'
import type { PhonePairing } from './src/sync/phone-pairing'
import type { PhoneSync } from './src/sync/phone-sync'
import { createPhoneSync } from './src/sync/phone-sync-runtime'
import { loadR2Setup, onR2SetupChanged } from './src/sync/r2-phone-settings'
import type { R2Setup } from '../electron/services/sync/r2-setup-code'
import type { R2Changes } from '../electron/services/sync/r2-transport'

interface Check {
  fileVersion: number
  latestVersion: number
  migratedFrom: number
}

/** Brings the open database up to date with the desktop's migrations and reports versions. */
function checkDatabase(db: OstlerDatabase): Check {
  const { from } = migrate(db)
  return {
    fileVersion: readSchemaVersion(db),
    latestVersion: LATEST_SCHEMA_VERSION,
    migratedFrom: from
  }
}

/** The full-page screens. */
type Screen =
  | 'home'
  | 'settings'
  | 'join'
  | 'pairing'
  | 'project'
  | 'task'
  | 'search'
  | 'weeklyReview'
  | 'timesheet'
  | 'team'
  | 'contacts'
  | 'library'

/** The screens a task can be opened from, where Back returns. */
type TaskOrigin = 'project' | 'home' | 'search' | 'weeklyReview' | 'timesheet' | 'team' | 'contacts'

export default function App() {
  const [check, setCheck] = useState<Check | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const theme = useTheme()
  const dark = useIsDark()
  const [screen, setScreen] = useState<Screen>('home')
  const [tab, setTab] = useState<'projects' | 'myDay' | 'inbox' | 'needsYou'>('projects')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  // The Library item being read, and the screen Back returns to from it.
  const [libraryItemId, setLibraryItemId] = useState<string | null>(null)
  const [libraryFrom, setLibraryFrom] = useState<'project' | 'task' | 'home'>('project')
  // Where Back from a task goes: the project it was opened from, Search, or the home lists.
  const [taskFrom, setTaskFrom] = useState<TaskOrigin>('home')
  // The tasks a parent or subtask was opened from, newest last: Back steps through them first.
  const [taskTrail, setTaskTrail] = useState<string[]>([])
  // Where Back from a project goes: Search when it was found there, the task whose link opened
  // it, else the home lists.
  const [projectFrom, setProjectFrom] = useState<'home' | 'search' | 'task' | 'weeklyReview'>(
    'home'
  )
  // The view a project opens on: a link to a milestone or decision opens that list.
  const [projectView, setProjectView] = useState<ProjectView>('tasks')
  // An item link that opened the app (`<scheme>://task/…`), opened once the database is ready.
  const [incomingItem, setIncomingItem] = useState<ItemLinkRef | null>(null)
  // The words in Search, kept while a result is open so Back returns to them.
  const [searchQuery, setSearchQuery] = useState('')
  const [db, setDb] = useState<OstlerDatabase | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [sync, setSync] = useState<PhoneSync | null>(null)
  const [pairing, setPairing] = useState<PhonePairing | null>(null)
  // Advanced sync: the R2 bucket from a setup code; undefined until the secure store has answered.
  const [r2Setup, setR2Setup] = useState<R2Setup | null | undefined>(undefined)
  const [r2Changes, setR2Changes] = useState<R2Changes | null>(null)
  // A setup code that arrived as a link (`<scheme>://r2-setup/<code>`), for Settings to fill in.
  const [incomingSetupCode, setIncomingSetupCode] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [pendingInvite, setPendingInvite] = useState<string | null>(null)
  // Quick capture is open on the home screen; what was captured last, said for a few seconds.
  const [capturing, setCapturing] = useState(false)
  const [captured, setCaptured] = useState<string | null>(null)
  useEffect(() => {
    if (captured === null) return
    const timer = setTimeout(() => setCaptured(null), 4000)
    return () => clearTimeout(timer)
  }, [captured])
  const dbRef = useRef<OstlerDatabase | null>(null)

  // The database stays open for the life of the app: the sync loop writes to it. It is never
  // closed here: a fast refresh re-runs effects, and the other effects still hold this handle.
  useEffect(() => {
    try {
      const opened = dbRef.current ?? openDatabase()
      dbRef.current = opened
      const result = checkDatabase(opened)
      setDb(opened)
      console.log(
        `OSTLER07 schema file=${result.fileVersion} latest=${result.latestVersion} from=${result.migratedFrom}`
      )
      setCheck(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`OSTLER07 FAIL ${message}`)
      setFailure(message)
    }
  }, [])

  // Whether Google still holds this phone's sign-in; asked again whenever the person leaves Settings.
  useEffect(() => {
    if (screen === 'settings') return
    let alive = true
    void currentAccount().then((account) => {
      if (alive) setSignedIn(account !== null)
    })
    return () => {
      alive = false
    }
  }, [screen])

  useEffect(() => {
    void loadR2Setup().then(setR2Setup)
    return onR2SetupChanged(setR2Setup)
  }, [])

  // The sync loop exists while signed in to Google or set up with an R2 bucket, and runs only
  // while the app is in the foreground.
  useEffect(() => {
    if (db === null || r2Setup === undefined || (!signedIn && r2Setup === null)) return
    const {
      sync: created,
      pairing: pairingCreated,
      r2Changes: changes
    } = createPhoneSync(db, () => setVersion((n) => n + 1), { drive: signedIn, r2: r2Setup })
    setSync(created)
    setPairing(pairingCreated)
    setR2Changes(changes)
    if (AppState.currentState === 'active') created.start()
    // With a bucket, joining the person's other devices needs nothing from them: ask straight away
    // (a PC that allows devices by itself answers within a minute).
    if (r2Setup && pairingCreated.state().phase !== 'paired') void pairingCreated.start()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') created.start()
      else void created.stop()
    })
    return () => {
      subscription.remove()
      setSync(null)
      setPairing(null)
      setR2Changes(null)
      changes?.stop()
      pairingCreated.cancel()
      void created.dispose()
    }
  }, [db, signedIn, r2Setup])

  // An invite link (`<scheme>://join/<invite>`) opens the Join screen and joins; an item link
  // (`<scheme>://task/<project>/<task>`, and milestones and decisions) opens that item.
  const openLink = useCallback((url: string | null | undefined) => {
    const setupCode = url == null ? null : /^[a-z][a-z0-9+.-]*:\/\/r2-setup\/(.+)$/i.exec(url)?.[1]
    if (setupCode) {
      setIncomingSetupCode(decodeURIComponent(setupCode))
      setScreen('settings')
      return
    }
    const item = url == null ? null : itemLinkTarget(url, BRAND.urlScheme)
    if (item !== null) {
      setIncomingItem(item)
      return
    }
    const invite = url == null ? null : findInvite(url, BRAND.urlScheme)
    if (invite === null) return
    setPendingInvite(invite)
    setScreen('join')
  }, [])
  useEffect(() => {
    void Linking.getInitialURL().then(openLink)
    const subscription = Linking.addEventListener('url', ({ url }) => openLink(url))
    return () => subscription.remove()
  }, [openLink])
  const inviteUsed = useCallback(() => setPendingInvite(null), [])

  // Join and Set up from my other device open from Settings, and go back to it.
  const goBack = useCallback(() => {
    if (screen === 'task' && taskTrail.length > 0) {
      setTaskId(taskTrail[taskTrail.length - 1])
      setTaskTrail(taskTrail.slice(0, -1))
    } else if (screen === 'task') setScreen(taskFrom)
    else if (screen === 'project') setScreen(projectFrom)
    else if (screen === 'library') setScreen(libraryFrom)
    else if (screen === 'join' || screen === 'pairing') setScreen('settings')
    else setScreen('home')
  }, [screen, taskFrom, projectFrom, libraryFrom, taskTrail])
  // The phone's Back button steps out of a screen instead of closing the app.
  useEffect(() => {
    if (screen === 'home') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack()
      return true
    })
    return () => subscription.remove()
  }, [screen, goBack])

  // An edit made on this phone: push it to Drive soon, and re-read what the screens show.
  const edited = useCallback(() => {
    sync?.noteLocalWrite()
    setVersion((n) => n + 1)
  }, [sync])

  // Sync now (pull down on a home tab, or the ⋮ menu): push and pull every share, look for R2
  // changes, then re-read. The spinner stays until the round trip is done.
  const [refreshing, setRefreshing] = useState(false)
  const syncNow = useCallback(async () => {
    setRefreshing(true)
    try {
      await sync?.syncAll()
      await r2Changes?.check().catch(() => false)
    } finally {
      setRefreshing(false)
      setVersion((n) => n + 1)
    }
  }, [sync, r2Changes])

  const openProject = useCallback(
    (
      id: string,
      from: 'home' | 'search' | 'task' | 'weeklyReview' = 'home',
      view: ProjectView = 'tasks'
    ) => {
      setProjectId(id)
      setProjectFrom(from)
      setProjectView(view)
      setScreen('project')
    },
    []
  )
  const openTask = useCallback((id: string, from: TaskOrigin) => {
    setTaskId(id)
    setTaskFrom(from)
    setTaskTrail([])
    setScreen('task')
  }, [])
  const openRelatedTask = useCallback(
    (id: string) => {
      if (taskId !== null) setTaskTrail((trail) => [...trail, taskId])
      setTaskId(id)
    },
    [taskId]
  )
  // A link in a task's text: a task opens on the trail (Back returns), a milestone or decision
  // opens its project on that list, and a Library item opens to read.
  const openLibraryItem = useCallback((id: string, from: 'project' | 'task' | 'home') => {
    setLibraryItemId(id)
    setLibraryFrom(from)
    setScreen('library')
  }, [])
  const openItem = useCallback(
    (ref: ItemLinkRef) => {
      if (ref.kind === 'task') openRelatedTask(ref.id)
      else if (ref.kind === 'library') openLibraryItem(ref.id, 'task')
      else
        openProject(
          ref.projectId,
          'task',
          ref.kind === 'milestone' ? 'milestones' : ref.kind === 'decision' ? 'decisions' : 'tasks'
        )
    },
    [openProject, openRelatedTask, openLibraryItem]
  )
  useEffect(() => {
    if (incomingItem === null || db === null) return
    setIncomingItem(null)
    if (incomingItem.kind === 'task') openTask(incomingItem.id, 'home')
    else if (incomingItem.kind === 'library') openLibraryItem(incomingItem.id, 'home')
    else
      openProject(
        incomingItem.projectId,
        'home',
        incomingItem.kind === 'milestone'
          ? 'milestones'
          : incomingItem.kind === 'decision'
            ? 'decisions'
            : 'tasks'
      )
  }, [incomingItem, db, openTask, openProject, openLibraryItem])

  // An Inbox item or a search result opens its task, or its project.
  const openTarget = useCallback(
    (target: InboxTarget, from: 'home' | 'search') => {
      if (target.kind === 'task') openTask(target.taskId, from)
      else openProject(target.projectId, from)
    },
    [openProject, openTask]
  )

  // The Inbox tab shows how many items are unread.
  const unread = useMemo(() => {
    if (db === null || version < 0) return 0
    try {
      return inboxList(db).unreadCount
    } catch {
      return 0
    }
  }, [db, version])

  // The Needs you tab shows how many asks wait on an answer.
  const asks = useMemo(() => {
    if (db === null || version < 0) return 0
    try {
      return needsYou(db, today()).count
    } catch {
      return 0
    }
  }, [db, version])
  // A link in a Needs you card opens from the home lists, like the card's own task.
  const openItemFromHome = useCallback(
    (ref: ItemLinkRef) => {
      if (ref.kind === 'task') openTask(ref.id, 'home')
      else if (ref.kind === 'library') openLibraryItem(ref.id, 'home')
      else
        openProject(
          ref.projectId,
          'home',
          ref.kind === 'milestone' ? 'milestones' : ref.kind === 'decision' ? 'decisions' : 'tasks'
        )
    },
    [openProject, openTask, openLibraryItem]
  )

  // Every screen sits below the status bar on the theme's background, under its own top bar.
  const padded = [
    styles.page,
    { backgroundColor: theme.bg, paddingTop: NativeStatusBar.currentHeight ?? 0 }
  ]
  const home = () => setScreen('home')
  const page = (content: ReactNode) => (
    <View style={padded}>
      {content}
      <StatusBar style={dark ? 'light' : 'dark'} />
    </View>
  )
  if (screen === 'settings') {
    return page(
      <Settings
        check={check}
        onBack={home}
        onJoin={() => setScreen('join')}
        onPairing={() => setScreen('pairing')}
        r2={{
          setup: r2Setup ?? null,
          lastSyncedAt: sync?.lastSyncedAt() ?? null,
          incomingCode: incomingSetupCode,
          onCodeUsed: () => setIncomingSetupCode(null),
          onSyncNow: syncNow
        }}
      />
    )
  }
  if (screen === 'pairing') return page(<Pairing pairing={pairing} onBack={goBack} />)
  if (screen === 'join') {
    return page(
      <Join
        sync={sync}
        version={version}
        invite={pendingInvite}
        onInviteUsed={inviteUsed}
        onBack={goBack}
      />
    )
  }
  if (screen === 'project' && db !== null && projectId !== null) {
    return page(
      <Project
        key={`${projectId}:${projectView}`}
        db={db}
        projectId={projectId}
        initialView={projectView}
        version={version}
        onBack={goBack}
        onOpenTask={(id) => openTask(id, 'project')}
        onOpenLibraryItem={(id) => openLibraryItem(id, 'project')}
        onEdited={edited}
      />
    )
  }
  if (screen === 'search' && db !== null) {
    return page(
      <Search
        db={db}
        version={version}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onBack={home}
        onOpen={(target) => openTarget(target, 'search')}
      />
    )
  }
  if (screen === 'weeklyReview' && db !== null) {
    return page(
      <WeeklyReview
        db={db}
        version={version}
        onBack={home}
        onOpenTask={(id) => openTask(id, 'weeklyReview')}
        onOpenMilestones={(id) => openProject(id, 'weeklyReview', 'milestones')}
        onOpenInbox={() => {
          setTab('inbox')
          setScreen('home')
        }}
        onEdited={edited}
      />
    )
  }
  if (screen === 'timesheet' && db !== null) {
    return page(
      <Timesheet
        db={db}
        version={version}
        onBack={home}
        onOpenTask={(id) => openTask(id, 'timesheet')}
        onEdited={edited}
      />
    )
  }
  if (screen === 'library' && db !== null && libraryItemId !== null) {
    return page(
      <LibraryReader
        db={db}
        itemId={libraryItemId}
        version={version}
        onBack={goBack}
        onOpenItem={openItem}
        onEdited={edited}
      />
    )
  }
  if (screen === 'team' && db !== null) {
    return page(
      <Team db={db} version={version} onBack={home} onOpenTask={(id) => openTask(id, 'team')} />
    )
  }
  if (screen === 'contacts' && db !== null) {
    return page(
      <Contacts
        db={db}
        version={version}
        onBack={home}
        onOpenTask={(id) => openTask(id, 'contacts')}
        onEdited={edited}
      />
    )
  }
  if (screen === 'task' && db !== null && taskId !== null) {
    return page(
      <TaskDetail
        db={db}
        taskId={taskId}
        version={version}
        onBack={goBack}
        onEdited={edited}
        onOpenTask={openRelatedTask}
        onOpenItem={openItem}
      />
    )
  }

  const homeRefresh = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void syncNow()}
      colors={[theme.accent]}
      progressBackgroundColor={theme.surface}
    />
  )
  return page(
    <>
      <TopBar
        theme={theme}
        title={BRAND.name}
        actions={[
          {
            icon: 'plus',
            label: t('mobile:capture.title'),
            onPress: () => setCapturing(!capturing)
          },
          {
            icon: 'search',
            label: t('views:searchView.search'),
            onPress: () => setScreen('search')
          },
          {
            icon: 'settings',
            label: t('mobile:settings.open'),
            onPress: () => setScreen('settings')
          }
        ]}
        menu={[
          { label: t('mobile:nav.syncNow'), onPress: () => void syncNow() },
          { label: t('views:weeklyReview.start'), onPress: () => setScreen('weeklyReview') },
          { label: t('mobile:time.timesheet'), onPress: () => setScreen('timesheet') },
          { label: t('views:team.title'), onPress: () => setScreen('team') },
          { label: t('views:contacts.title'), onPress: () => setScreen('contacts') }
        ]}
      />
      <View
        style={[styles.tabs, { backgroundColor: theme.surface, borderColor: theme.border }]}
        accessibilityRole="tablist"
      >
        {(['projects', 'myDay', 'needsYou', 'inbox'] as const).map((name) => {
          const label =
            name === 'projects'
              ? t('mobile:nav.projects')
              : name === 'myDay'
                ? t('mobile:nav.myDay')
                : name === 'needsYou'
                  ? t('mobile:nav.needsYou')
                  : t('mobile:nav.inbox')
          const count = name === 'inbox' ? unread : name === 'needsYou' ? asks : 0
          const badge = count > 0
          const selected = tab === name
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={
                !badge
                  ? label
                  : name === 'inbox'
                    ? t('mobile:nav.inboxUnread', { unread })
                    : t('mobile:nav.needsYouCount', { count })
              }
              accessibilityState={{ selected }}
              onPress={() => setTab(name)}
              style={[styles.tab, selected && { borderBottomColor: theme.accent }]}
            >
              <Text
                style={[styles.tabText, { color: selected ? theme.accent : theme.textSecondary }]}
              >
                {label}
              </Text>
              {badge && (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.badgeText, { color: theme.accentContrast }]}>
                    {count > 99 ? '99+' : count}
                  </Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </View>
      {db !== null && capturing && (
        <QuickCapture
          db={db}
          theme={theme}
          onCaptured={(projectId, title) => {
            edited()
            setCaptured(
              t('mobile:capture.done', {
                title,
                project: projectName({ id: projectId, name: null })
              })
            )
          }}
          onClose={() => setCapturing(false)}
        />
      )}
      {captured !== null && (
        <Text style={[styles.captured, { color: theme.success }]}>{captured}</Text>
      )}
      {db !== null && (
        <RunningTimerBar
          db={db}
          version={version}
          theme={theme}
          onOpenTask={(id) => openTask(id, 'home')}
          onEdited={edited}
        />
      )}
      <View style={styles.content}>
        {db !== null && tab === 'projects' && (
          <Projects
            db={db}
            version={version}
            onOpenProject={openProject}
            refreshControl={homeRefresh}
          />
        )}
        {db !== null && tab === 'myDay' && (
          <MyDay
            db={db}
            version={version}
            onOpenTask={(id) => openTask(id, 'home')}
            onEdited={edited}
            refreshControl={homeRefresh}
          />
        )}
        {db !== null && tab === 'needsYou' && (
          <NeedsYou
            db={db}
            version={version}
            onOpenTask={(id) => openTask(id, 'home')}
            onOpenProject={(id, view) => openProject(id, 'home', view)}
            onOpenItem={openItemFromHome}
            onEdited={edited}
            refreshControl={homeRefresh}
          />
        )}
        {db !== null && tab === 'inbox' && (
          <Inbox
            db={db}
            version={version}
            onOpen={(target) => openTarget(target, 'home')}
            onEdited={edited}
            refreshControl={homeRefresh}
          />
        )}
        {db === null && failure === null && (
          <Text style={[styles.line, { color: theme.textMuted }]}>Setting up the database…</Text>
        )}
        {failure !== null && (
          <Text style={[styles.line, styles.bad, { color: theme.danger }]}>
            The database could not be set up: {failure}
          </Text>
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flex: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent'
  },
  tabText: { fontSize: 15, fontWeight: '600' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  line: { fontSize: 16, padding: 16 },
  captured: { fontSize: 14, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 },
  bad: { fontWeight: '600' }
})
