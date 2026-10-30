import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  AppState,
  BackHandler,
  Linking,
  Pressable,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { Join } from './src/screens/Join'
import { Pairing } from './src/screens/Pairing'
import { MyDay } from './src/screens/MyDay'
import { Project } from './src/screens/Project'
import { Projects } from './src/screens/Projects'
import { Settings } from './src/screens/Settings'
import { TaskDetail } from './src/screens/TaskDetail'
import { TopBar } from './src/screens/TopBar'
import { useIsDark, useTheme } from './src/theme'
import { BRAND } from '../src/shared/brand'
import { findInvite } from '../src/shared/deep-link'
import { t } from '@shared/i18n/index'
import {
  LATEST_SCHEMA_VERSION,
  migrate,
  openDatabase,
  readSchemaVersion,
  type OstlerDatabase
} from './src/db/database'
import { currentAccount } from './src/google/account'
import type { PhonePairing } from './src/sync/phone-pairing'
import type { PhoneSync } from './src/sync/phone-sync'
import { createPhoneSync } from './src/sync/phone-sync-runtime'

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

export default function App() {
  const [check, setCheck] = useState<Check | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const theme = useTheme()
  const dark = useIsDark()
  const [screen, setScreen] = useState<
    'home' | 'settings' | 'join' | 'pairing' | 'project' | 'task'
  >('home')
  const [tab, setTab] = useState<'projects' | 'myDay'>('projects')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  // Where Back from a task goes: the project it was opened from, or the home lists.
  const [taskFrom, setTaskFrom] = useState<'project' | 'home'>('home')
  const [db, setDb] = useState<OstlerDatabase | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [sync, setSync] = useState<PhoneSync | null>(null)
  const [pairing, setPairing] = useState<PhonePairing | null>(null)
  const [version, setVersion] = useState(0)
  const [pendingInvite, setPendingInvite] = useState<string | null>(null)
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

  // The sync loop exists while signed in, and runs only while the app is in the foreground.
  useEffect(() => {
    if (db === null || !signedIn) return
    const { sync: created, pairing: pairingCreated } = createPhoneSync(db, () =>
      setVersion((n) => n + 1)
    )
    setSync(created)
    setPairing(pairingCreated)
    if (AppState.currentState === 'active') created.start()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') created.start()
      else void created.stop()
    })
    return () => {
      subscription.remove()
      setSync(null)
      setPairing(null)
      pairingCreated.cancel()
      void created.dispose()
    }
  }, [db, signedIn])

  // An invite link (`<scheme>://join/<invite>`) opens the Join screen and joins.
  const openLink = useCallback((url: string | null | undefined) => {
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
    if (screen === 'task') setScreen(taskFrom)
    else if (screen === 'join' || screen === 'pairing') setScreen('settings')
    else setScreen('home')
  }, [screen, taskFrom])
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

  const openProject = useCallback((id: string) => {
    setProjectId(id)
    setScreen('project')
  }, [])
  const openTask = useCallback((id: string, from: 'project' | 'home') => {
    setTaskId(id)
    setTaskFrom(from)
    setScreen('task')
  }, [])

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
        db={db}
        projectId={projectId}
        version={version}
        onBack={home}
        onOpenTask={(id) => openTask(id, 'project')}
        onEdited={edited}
      />
    )
  }
  if (screen === 'task' && db !== null && taskId !== null) {
    return page(
      <TaskDetail db={db} taskId={taskId} version={version} onBack={goBack} onEdited={edited} />
    )
  }

  return page(
    <>
      <TopBar
        theme={theme}
        title={BRAND.name}
        actions={[
          {
            icon: 'settings',
            label: t('mobile:settings.open'),
            onPress: () => setScreen('settings')
          }
        ]}
      />
      <View
        style={[styles.tabs, { backgroundColor: theme.surface, borderColor: theme.border }]}
        accessibilityRole="tablist"
      >
        {(['projects', 'myDay'] as const).map((name) => {
          const label = name === 'projects' ? t('mobile:nav.projects') : t('mobile:nav.myDay')
          const selected = tab === name
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => setTab(name)}
              style={[styles.tab, selected && { borderBottomColor: theme.accent }]}
            >
              <Text
                style={[styles.tabText, { color: selected ? theme.accent : theme.textSecondary }]}
              >
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.content}>
        {db !== null && tab === 'projects' && (
          <Projects db={db} version={version} onOpenProject={openProject} />
        )}
        {db !== null && tab === 'myDay' && (
          <MyDay db={db} version={version} onOpenTask={(id) => openTask(id, 'home')} />
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
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent'
  },
  tabText: { fontSize: 15, fontWeight: '600' },
  line: { fontSize: 16, padding: 16 },
  bad: { fontWeight: '600' }
})
