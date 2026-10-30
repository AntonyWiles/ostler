import * as fs from 'fs'
import { fromRendererProjectUpdate } from '../../src/shared/renderer-config'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A reversible stand-in for safeStorage, so the test can prove an encrypted
// key survives a config upgrade byte for byte and still decrypts.
vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) =>
    key ? `ostler-secure:v1:${Buffer.from(key).toString('base64')}` : key,
  decryptApiKey: (value: string) => {
    if (!value.startsWith('ostler-secure:v1:')) throw new Error('not encrypted')
    return Buffer.from(value.slice('ostler-secure:v1:'.length), 'base64').toString('utf-8')
  },
  sealSecret: (token: string) =>
    token ? `ostler-secure:v1:${Buffer.from(token).toString('base64')}` : token,
  openSecret: (value: string) =>
    value.startsWith('ostler-secure:v1:')
      ? Buffer.from(value.slice('ostler-secure:v1:'.length), 'base64').toString('utf-8')
      : value
}))

import { CONFIG_MIGRATIONS, ConfigStore, LATEST_CONFIG_VERSION } from '../../electron/config-store'
import { DEFAULT_BACKUP_SETTINGS, assertValidDesktopUpdate } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const ENCRYPTED_KEY = `ostler-secure:v1:${Buffer.from('sk-secret').toString('base64')}`

describe('config migrations', () => {
  const tempDir = useTempDir('ostler-config-migrations-')
  let configPath: string
  let backupDir: string

  beforeEach(() => {
    configPath = path.join(tempDir(), 'config.json')
    backupDir = path.join(tempDir(), 'backups')
  })

  const onDisk = () => JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  it('starts with a baseline that only stamps version 1', () => {
    expect(CONFIG_MIGRATIONS[0]).toMatchObject({ version: 1, name: 'baseline' })
    const raw: Record<string, unknown> = { ui: { theme: 'light' } }
    CONFIG_MIGRATIONS[0].up(raw, { newInstall: false })
    expect(raw).toEqual({ ui: { theme: 'light' } })
  })

  it('stamps a new install with the latest version and makes no backup', () => {
    const store = new ConfigStore(configPath)

    expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
    expect(onDisk().configVersion).toBe(LATEST_CONFIG_VERSION)
    expect(store.get().backups).toEqual(DEFAULT_BACKUP_SETTINGS)
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('upgrades an unversioned config, copying the old file to backups first', () => {
    const original = JSON.stringify({ ui: { theme: 'light' }, ai: { apiKey: ENCRYPTED_KEY } })
    fs.writeFileSync(configPath, original)

    const store = new ConfigStore(configPath)

    expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
    expect(store.get().ui.theme).toBe('light')
    expect(store.get().backups).toEqual(DEFAULT_BACKUP_SETTINGS)
    expect(onDisk()).toMatchObject({
      configVersion: LATEST_CONFIG_VERSION,
      backups: DEFAULT_BACKUP_SETTINGS
    })

    const copies = fs.readdirSync(backupDir)
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(
      new RegExp(`^pre-migration-config-v0-v${LATEST_CONFIG_VERSION}-\\d{8}-\\d{6}-\\d{3}\\.json$`)
    )
    expect(fs.readFileSync(path.join(backupDir, copies[0]), 'utf-8')).toBe(original)
  })

  it('keeps the secret encrypted on disk and still decrypts it after the upgrade', () => {
    fs.writeFileSync(configPath, JSON.stringify({ ai: { apiKey: ENCRYPTED_KEY } }))

    const store = new ConfigStore(configPath)

    expect(store.get().ai.apiKey).toBe('sk-secret')
    expect(onDisk().ai.apiKey).toBe(ENCRYPTED_KEY)
    expect(new ConfigStore(configPath).get().ai.apiKey).toBe('sk-secret')
  })

  it('keeps backup settings a user already has', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ configVersion: 1, backups: { enabled: false, intervalHours: 6, keep: 3 } })
    )

    const store = new ConfigStore(configPath)

    expect(store.get().backups).toEqual({
      enabled: false,
      intervalHours: 6,
      keep: 3,
      copyTo: null,
      lastCopiedAt: null,
      copyFailedAt: null
    })
  })

  it('leaves a current config alone', () => {
    new ConfigStore(configPath)
    const before = fs.readFileSync(configPath, 'utf-8')

    new ConfigStore(configPath)

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before)
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('does not migrate when the old file cannot be backed up', () => {
    fs.writeFileSync(configPath, JSON.stringify({ ui: { theme: 'light' } }))
    fs.writeFileSync(backupDir, 'a file where the backups folder should be')

    const store = new ConfigStore(configPath)

    expect(onDisk().configVersion).toBeUndefined()
    expect(store.get().ui.theme).toBe('light')
  })

  describe('appearance (version 3)', () => {
    it('gives a new install the System theme, Comfortable density and the Ostler accent', () => {
      const store = new ConfigStore(configPath)

      expect(store.get().ui).toMatchObject({
        theme: 'system',
        density: 'comfortable',
        accent: 'ostler'
      })
      expect(onDisk().ui).toMatchObject({
        theme: 'system',
        density: 'comfortable',
        accent: 'ostler'
      })
    })

    it('writes dark into an existing config that never stored a theme', () => {
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 2, projects: [] }))

      const store = new ConfigStore(configPath)

      expect(store.get().ui).toMatchObject({
        theme: 'dark',
        density: 'comfortable',
        accent: 'ostler'
      })
      expect(onDisk().ui.theme).toBe('dark')
    })

    it('keeps the theme an existing config stored', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ configVersion: 2, ui: { theme: 'dark', sendMessageOn: 'enter' } })
      )

      const store = new ConfigStore(configPath)

      expect(store.get().ui).toMatchObject({ theme: 'dark', sendMessageOn: 'enter' })
      expect(onDisk().ui).toMatchObject({ theme: 'dark', density: 'comfortable' })
    })

    it('keeps density and accent a config already has', () => {
      const raw: Record<string, unknown> = {
        ui: { theme: 'light', density: 'compact', accent: 'windows' }
      }
      CONFIG_MIGRATIONS.find((migration) => migration.version === 3)!.up(raw, {
        newInstall: false
      })
      expect(raw.ui).toEqual({ theme: 'light', density: 'compact', accent: 'windows' })
    })
  })

  describe('agents opt-in (version 4)', () => {
    it('starts a new install with agents and both HTTP servers off', () => {
      const store = new ConfigStore(configPath)

      expect(store.get().harness.enabled).toBe(false)
      expect(store.get().automationApi.enabled).toBe(false)
      expect(onDisk().harness.enabled).toBe(false)
      expect(onDisk().automationApi.enabled).toBe(false)
    })

    it('keeps agents on for an existing config that relied on the old default', () => {
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 3, projects: [] }))

      const store = new ConfigStore(configPath)

      expect(store.get().harness.enabled).toBe(true)
      expect(store.get().automationApi.enabled).toBe(true)
      expect(onDisk().harness.enabled).toBe(true)
      expect(onDisk().automationApi.enabled).toBe(true)
    })

    it('keeps the switches an existing config stored', () => {
      const raw: Record<string, unknown> = {
        harness: { enabled: false, port: 9100 },
        automationApi: { enabled: true, port: 9101 }
      }

      CONFIG_MIGRATIONS.find((migration) => migration.version === 4)!.up(raw, {
        newInstall: false
      })

      expect(raw.harness).toEqual({ enabled: false, port: 9100 })
      expect(raw.automationApi).toEqual({ enabled: true, port: 9101 })
    })
  })

  describe('start page (version 5)', () => {
    it('opens on Home for new and existing configs', () => {
      expect(new ConfigStore(configPath).get().ui.startPage).toBe('home')
      fs.rmSync(configPath)
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 4, ui: { theme: 'dark' } }))
      const store = new ConfigStore(configPath)
      expect(store.get().ui).toMatchObject({ theme: 'dark', startPage: 'home' })
      expect(onDisk().ui.startPage).toBe('home')
    })

    it('keeps a start page a config already has', () => {
      const raw: Record<string, unknown> = { ui: { startPage: 'lastProject' } }
      CONFIG_MIGRATIONS.find((migration) => migration.version === 5)!.up(raw, {
        newInstall: false
      })
      expect(raw.ui).toEqual({ startPage: 'lastProject' })
    })
  })

  describe('estimate unit (version 6)', () => {
    const estimateUnit = CONFIG_MIGRATIONS.find((migration) => migration.version === 6)!

    it('counts every existing project in points and keeps a unit a project already has', () => {
      const raw: Record<string, unknown> = {
        projects: [
          { id: 'a' },
          { id: 'b', estimateUnit: 'hours' },
          { id: 'c', estimateUnit: 'days' }
        ]
      }
      estimateUnit.up(raw, { newInstall: false })
      expect(raw.projects).toEqual([
        { id: 'a', estimateUnit: 'points' },
        { id: 'b', estimateUnit: 'hours' },
        { id: 'c', estimateUnit: 'points' }
      ])
    })

    it('upgrades a version 5 config on load', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 5,
          projects: [makeWatchedProject({ id: 'p1', name: 'One', addedAt: 1 })]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.getProjects()[0].estimateUnit).toBe('points')
      expect(onDisk().projects[0].estimateUnit).toBe('points')
    })

    it('refuses a unit other than points or hours', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          projects: [makeWatchedProject({ id: 'p1', name: 'One', addedAt: 1 })]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.updateProject('p1', { estimateUnit: 'hours' }).estimateUnit).toBe('hours')
      expect(() =>
        store.updateProject('p1', { estimateUnit: 'days' as unknown as 'hours' })
      ).toThrow('Estimates count in points or hours')
    })
  })

  describe('reminders (version 7)', () => {
    it('gives every config due-date reminders at 09:00, quiet hours off and every source on', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 6,
          notifications: { enabled: false, onBuildFailure: false }
        })
      )

      const store = new ConfigStore(configPath)

      expect(store.get().notifications).toMatchObject({
        enabled: false,
        onBuildFailure: false,
        dueReminders: 'dueDate',
        reminderTime: '09:00',
        quietHoursEnabled: false,
        onReminder: true,
        onAgentQuestion: true,
        onReviewWaiting: true,
        onBlocker: true
      })
      expect(onDisk().notifications.reminderTime).toBe('09:00')
    })

    it('keeps reminder settings a config already has, and refuses a bad time', () => {
      const raw: Record<string, unknown> = {
        notifications: { dueReminders: 'both', reminderTime: '07:30' }
      }
      CONFIG_MIGRATIONS.find((migration) => migration.version === 7)!.up(raw, {
        newInstall: false
      })
      expect(raw.notifications).toMatchObject({ dueReminders: 'both', reminderTime: '07:30' })

      const store = new ConfigStore(configPath)
      store.update({ notifications: { reminderTime: '25:00', dueReminders: 'often' as never } })
      expect(store.get().notifications).toMatchObject({
        reminderTime: '09:00',
        dueReminders: 'dueDate'
      })
    })
  })

  describe('project AI (version 8)', () => {
    const projectAi = CONFIG_MIGRATIONS.find((migration) => migration.version === 8)!

    it('keeps every project readable by AI with an Auto profile, and keeps what a project has', () => {
      const raw: Record<string, unknown> = {
        projects: [
          { id: 'a' },
          { id: 'b', aiAccess: false, aiProfile: 'general' },
          { id: 'c', aiAccess: 'yes', aiProfile: 'robots' }
        ]
      }
      projectAi.up(raw, { newInstall: false })
      expect(raw.projects).toEqual([
        { id: 'a', aiAccess: true, aiProfile: 'auto' },
        { id: 'b', aiAccess: false, aiProfile: 'general' },
        { id: 'c', aiAccess: true, aiProfile: 'auto' }
      ])
    })

    it('upgrades a version 7 config on load, and refuses a bad value later', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 7,
          projects: [
            makeWatchedProject({ id: 'p1', name: 'One', addedAt: 1, estimateUnit: 'points' })
          ]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.getProjects()[0]).toMatchObject({ aiProfile: 'auto' })
      expect(onDisk().projects[0]).toMatchObject({ aiProfile: 'auto' })
      expect(() =>
        store.updateProject('p1', { aiProfile: 'robots' as unknown as 'general' })
      ).toThrow('Auto, Software or General')
    })
  })

  describe('Ostler AI reads project files (version 20)', () => {
    const files = CONFIG_MIGRATIONS.find((migration) => migration.version === 20)!

    it('drops the per-project switch and sets a 100,000-token context', () => {
      const raw: Record<string, unknown> = {
        ai: { contextTokens: 32_000 },
        projects: [{ id: 'a', aiAccess: false, aiProfile: 'general' }]
      }
      files.up(raw, { newInstall: false })
      expect(raw.ai).toEqual({ contextTokens: 32_000 })
      expect(raw.projects).toEqual([{ id: 'a', aiProfile: 'general' }])
      const fresh: Record<string, unknown> = {}
      files.up(fresh, { newInstall: false })
      expect(fresh.ai).toEqual({ contextTokens: 100_000 })
    })
  })

  describe('agent experience (version 9)', () => {
    const conventions = CONFIG_MIGRATIONS.find((migration) => migration.version === 9)!

    it("keeps the built-in agent on Ostler AI's model, one at a time, starting nothing by itself", () => {
      const raw: Record<string, unknown> = { harness: { enabled: true, agentModel: 'kept' } }
      conventions.up(raw, { newInstall: false })
      expect(raw.harness).toEqual({
        enabled: true,
        agentProvider: '',
        agentModel: 'kept',
        maxConcurrentAgents: 1,
        autoRunQueued: false
      })
    })

    it('gives every project empty conventions, and keeps what a project has', () => {
      const raw: Record<string, unknown> = {
        projects: [
          { id: 'a' },
          { id: 'b', agentConventions: 'Use tabs' },
          { id: 'c', agentConventions: 3 }
        ]
      }
      conventions.up(raw, { newInstall: false })
      expect(raw.projects).toEqual([
        { id: 'a', agentConventions: '' },
        { id: 'b', agentConventions: 'Use tabs' },
        { id: 'c', agentConventions: '' }
      ])
    })

    it('upgrades a version 8 config on load, and refuses a bad value later', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 8,
          projects: [
            {
              id: 'p1',
              name: 'One',
              path: null,
              color: '#3b82f6',
              enabled: true,
              customIgnorePatterns: [],
              notes: '',
              tags: [],
              addedAt: 1,
              lastActivity: null,
              estimateUnit: 'points',
              aiAccess: true,
              aiProfile: 'auto'
            }
          ]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.getProjects()[0].agentConventions).toBe('')
      expect(onDisk().projects[0].agentConventions).toBe('')
      expect(store.updateProject('p1', { agentConventions: '# Rules' }).agentConventions).toBe(
        '# Rules'
      )
      expect(() => store.updateProject('p1', { agentConventions: 'x'.repeat(20_001) })).toThrow(
        'at most'
      )
    })
  })
  describe('first run (version 10)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 10)!

    it('starts a new install with the welcome and the checklist', () => {
      const store = new ConfigStore(configPath)
      expect(store.get().ui).toMatchObject({
        firstRunCompleted: false,
        lastSeenVersion: '',
        gettingStarted: { dismissed: false, triedView: false, usedSearch: false, sawBackups: false }
      })
    })

    it('marks an existing config with projects as past the welcome and the checklist', () => {
      const raw: Record<string, unknown> = { projects: [{ id: 'p1' }], ui: { theme: 'dark' } }
      migration().up(raw, { newInstall: false })
      expect(raw.ui).toMatchObject({
        theme: 'dark',
        firstRunCompleted: true,
        lastSeenVersion: '',
        gettingStarted: { dismissed: true }
      })
    })

    it('still welcomes an existing config that never added a project', () => {
      const raw: Record<string, unknown> = { projects: [] }
      migration().up(raw, { newInstall: false })
      expect(raw.ui).toMatchObject({
        firstRunCompleted: false,
        gettingStarted: { dismissed: false }
      })
    })

    it('keeps values a config already has', () => {
      const raw: Record<string, unknown> = {
        projects: [{ id: 'p1' }],
        ui: { firstRunCompleted: false, lastSeenVersion: '0.1.0' }
      }
      migration().up(raw, { newInstall: false })
      expect(raw.ui).toMatchObject({ firstRunCompleted: false, lastSeenVersion: '0.1.0' })
    })
  })

  describe('desktop (version 11)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 11)!

    it("starts every config with Ostler's title bar and background mode, sign-in and the key off", () => {
      const store = new ConfigStore(configPath)
      expect(store.get().desktop).toEqual({
        nativeTitleBar: false,
        backgroundMode: false,
        startAtLogin: false,
        quickAddHotkeyEnabled: false,
        quickAddHotkey: 'Ctrl+Alt+N',
        // Added by version 27 (N4.2a), which runs after this one.
        snipHotkeyEnabled: false,
        snipHotkey: 'Ctrl+Alt+S'
      })
    })

    it('keeps values a config already has, and fills the rest', () => {
      const raw: Record<string, unknown> = {
        desktop: { backgroundMode: true, quickAddHotkey: 'Alt+Q' }
      }
      migration().up(raw, { newInstall: false })
      expect(raw.desktop).toEqual({
        nativeTitleBar: false,
        backgroundMode: true,
        startAtLogin: false,
        quickAddHotkeyEnabled: false,
        quickAddHotkey: 'Alt+Q'
      })
    })

    it('upgrades a version 10 config on load, and refuses a bad key later', () => {
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 10, projects: [] }))
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      expect(store.get().desktop.backgroundMode).toBe(false)
      expect(() => assertValidDesktopUpdate({ quickAddHotkey: 'Q' })).toThrow()
    })
  })

  describe('zoom (version 12)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 12)!

    it('starts every config at 100%', () => {
      const store = new ConfigStore(configPath)
      expect(store.get().ui.zoom).toBe(0)
      const raw: Record<string, unknown> = { ui: { theme: 'dark' } }
      migration().up(raw, { newInstall: false })
      expect(raw.ui).toEqual({ theme: 'dark', zoom: 0 })
    })

    it('keeps a zoom a config already has, within the steps', () => {
      const kept: Record<string, unknown> = { ui: { zoom: 2 } }
      migration().up(kept, { newInstall: false })
      expect((kept.ui as { zoom: number }).zoom).toBe(2)
      const huge: Record<string, unknown> = { ui: { zoom: 40 } }
      migration().up(huge, { newInstall: false })
      expect((huge.ui as { zoom: number }).zoom).toBeLessThan(7)
    })

    it('upgrades a version 11 config on load, and saves a changed zoom', () => {
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 11, projects: [] }))
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      store.update({ ui: { ...store.get().ui, zoom: 1.5 } })
      expect(new ConfigStore(configPath).get().ui.zoom).toBe(1.5)
    })
  })
  describe('updates (version 13)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 13)!

    it('starts every config checking and downloading, off the beta channel', () => {
      const store = new ConfigStore(configPath)
      expect(store.get().updates).toEqual({
        checkAutomatically: true,
        downloadAutomatically: true,
        receiveBeta: false
      })
    })

    it('keeps values a config already has, and fills the rest', () => {
      const raw: Record<string, unknown> = { updates: { receiveBeta: true, checkAutomatically: 1 } }
      migration().up(raw, { newInstall: false })
      expect(raw.updates).toEqual({
        checkAutomatically: true,
        downloadAutomatically: true,
        receiveBeta: true
      })
    })

    it('upgrades a version 12 config on load, and saves a change', () => {
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 12, projects: [] }))
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      store.update({ updates: { checkAutomatically: false } })
      expect(new ConfigStore(configPath).get().updates.checkAutomatically).toBe(false)
    })
  })

  describe('language (version 14)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 14)!

    it('starts every config on "Match Windows"', () => {
      expect(new ConfigStore(configPath).get().ui.language).toBe('system')
    })

    it('keeps a language a config already has', () => {
      const raw: Record<string, unknown> = { ui: { language: 'en' } }
      migration().up(raw, { newInstall: false })
      expect(raw.ui).toEqual({ language: 'en' })
    })

    it('upgrades a version 13 config on load, and saves a change', () => {
      fs.writeFileSync(configPath, JSON.stringify({ configVersion: 13, projects: [], ui: {} }))
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      expect(store.get().ui.language).toBe('system')
      store.update({ ui: { language: 'en' } })
      expect(new ConfigStore(configPath).get().ui.language).toBe('en')
    })
  })

  describe('automation API switch (version 15)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 15)!
    const migrate = (harness: unknown, automationApi: unknown) => {
      const raw: Record<string, unknown> = { harness, automationApi }
      migration().up(raw, { newInstall: false })
      return raw.automationApi
    }

    // The API listened only while both switches were on; it keeps listening
    // exactly then, now on its own switch (D38).
    it.each([
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false]
    ])('agents %s and automation API %s: listens %s', (agents, api, listens) => {
      expect(migrate({ enabled: agents }, { enabled: api, port: 9101 })).toEqual({
        enabled: listens,
        port: 9101
      })
    })

    it('turns the API off when a section is missing', () => {
      expect(migrate(undefined, { enabled: true })).toEqual({ enabled: false })
      expect(migrate({ enabled: true }, undefined)).toEqual({ enabled: false })
    })

    it('starts a new install with the automation API off', () => {
      expect(new ConfigStore(configPath).get().automationApi.enabled).toBe(false)
    })

    it('upgrades a version 14 config with agents off and the API on to the API off', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 14,
          projects: [],
          harness: { enabled: false, port: 9100 },
          automationApi: { enabled: true, port: 9101 }
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.get().automationApi).toEqual({ enabled: false, port: 9101 })
      expect(onDisk().automationApi).toEqual({ enabled: false, port: 9101 })
    })
  })

  describe('project agent effort (version 16)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 16)!
    const migrate = (projects: unknown) => {
      const raw: Record<string, unknown> = { projects }
      migration().up(raw, { newInstall: false })
      return raw.projects
    }

    // A project on its own model ran it with the provider default effort, and
    // keeps doing so; a valid level already there is kept.
    it('gives every project with agent settings the provider default effort', () => {
      expect(
        migrate([
          { id: 'a', autoDispatch: { aiOverrideEnabled: true, defaultModel: 'gpt-5' } },
          { id: 'b', autoDispatch: { defaultEffort: 'high' } },
          { id: 'c', autoDispatch: { defaultEffort: 'turbo' } },
          { id: 'd' }
        ])
      ).toEqual([
        {
          id: 'a',
          autoDispatch: { aiOverrideEnabled: true, defaultModel: 'gpt-5', defaultEffort: '' }
        },
        { id: 'b', autoDispatch: { defaultEffort: 'high' } },
        { id: 'c', autoDispatch: { defaultEffort: '' } },
        { id: 'd' }
      ])
    })

    it('leaves a config without projects alone', () => {
      expect(migrate(undefined)).toBeUndefined()
    })

    it('upgrades a version 15 config on load', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 15,
          projects: [
            {
              id: 'p1',
              name: 'Garden',
              path: null,
              autoDispatch: {
                projectId: 'p1',
                enabled: false,
                maxConcurrentEmbeddedSessions: 0,
                aiOverrideEnabled: true,
                defaultProvider: 'anthropic',
                defaultModel: 'claude-haiku-5-5'
              }
            }
          ]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      expect(store.getProjectAutoDispatchConfig('p1')).toMatchObject({
        defaultModel: 'claude-haiku-5-5',
        defaultEffort: ''
      })
      expect(onDisk().projects[0].autoDispatch.defaultEffort).toBe('')
      store.updateProjectAutoDispatchConfig('p1', { defaultEffort: 'low' })
      expect(new ConfigStore(configPath).getProjectAutoDispatchConfig('p1').defaultEffort).toBe(
        'low'
      )
    })
  })

  describe('agent prices and limits (version 17)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 17)!

    // Nobody's costs or agents change until they set prices and limits.
    it('writes no prices and no limits, keeping valid ones', () => {
      const raw: Record<string, unknown> = {
        harness: {
          enabled: true,
          modelPrices: [
            { model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 },
            { model: '', inputPerMillion: 1, outputPerMillion: 1 }
          ]
        },
        projects: [
          { id: 'a' },
          { id: 'b', agentLimits: { tokensPerDay: 500000, tokensPerMonth: -3 } }
        ]
      }
      migration().up(raw, { newInstall: false })
      expect(raw.harness).toEqual({
        enabled: true,
        modelPrices: [{ model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 }]
      })
      expect(raw.projects).toEqual([
        { id: 'a', agentLimits: { tokensPerDay: null, tokensPerMonth: null } },
        { id: 'b', agentLimits: { tokensPerDay: 500000, tokensPerMonth: null } }
      ])
    })

    it('upgrades a version 16 config on load', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 16,
          harness: { enabled: true },
          projects: [{ id: 'p1', name: 'Garden', path: null }]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      expect(store.get().harness.modelPrices).toEqual([])
      expect(onDisk().projects[0].agentLimits).toEqual({ tokensPerDay: null, tokensPerMonth: null })
      store.updateProject('p1', { agentLimits: { tokensPerDay: 1000.7, tokensPerMonth: 0 } })
      expect(new ConfigStore(configPath).getProjects()[0].agentLimits).toEqual({
        tokensPerDay: 1000,
        tokensPerMonth: null
      })
    })
  })

  describe('GitHub (version 18)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 18)!

    // Nothing reaches GitHub until the person sets it up (R4.4, D40).
    it('writes no token and no repository, keeping ones already there', () => {
      const raw: Record<string, unknown> = {
        projects: [{ id: 'a' }, { id: 'b', githubRepository: 'acme/site' }, 'junk']
      }
      migration().up(raw, { newInstall: false })
      expect(raw.github).toEqual({ token: '' })
      expect(raw.projects).toEqual([
        { id: 'a', githubRepository: '' },
        { id: 'b', githubRepository: 'acme/site' },
        'junk'
      ])
    })

    it('upgrades a version 17 config on load, and saves a repository it checked', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ configVersion: 17, projects: [{ id: 'p1', name: 'Site', path: null }] })
      )
      const store = new ConfigStore(configPath)
      expect(store.get().configVersion).toBe(LATEST_CONFIG_VERSION)
      expect(store.get().github).toEqual({ token: '' })
      expect(onDisk().projects[0].githubRepository).toBe('')
      store.updateProject('p1', { githubRepository: 'git@github.com:acme/site.git' })
      expect(new ConfigStore(configPath).getProjects()[0].githubRepository).toBe('acme/site')
      expect(() =>
        store.updateProject('p1', { githubRepository: 'gitlab.com/acme/site' })
      ).toThrow()
      store.updateProject('p1', { githubRepository: '' })
      expect(store.getProjects()[0].githubRepository).toBe('')
    })
  })

  describe('encrypted project tokens (version 19)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 19)!
    const sealed = (token: string) => `ostler-secure:v1:${Buffer.from(token).toString('base64')}`

    it('encrypts plain tokens, once', () => {
      const raw: Record<string, unknown> = {
        projects: [
          { id: 'a', automationToken: 'automation-a' },
          { id: 'b', automationToken: sealed('automation-b') },
          'junk'
        ]
      }
      migration().up(raw, { newInstall: false })
      const once = JSON.parse(JSON.stringify(raw))
      expect(raw.projects).toEqual([
        { id: 'a', automationToken: sealed('automation-a') },
        { id: 'b', automationToken: sealed('automation-b') },
        'junk'
      ])
      migration().up(raw, { newInstall: false })
      expect(raw).toEqual(once)
    })

    it('upgrades a version 18 config on load, and every token keeps working', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 18,
          projects: [
            {
              id: 'p1',
              name: 'Site',
              path: null,
              harnessToken: 'harness-1',
              automationToken: 'automation-1'
            }
          ]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.getProjects()[0]).toMatchObject({
        automationToken: 'automation-1'
      })
      const text = fs.readFileSync(configPath, 'utf-8')
      expect(text).not.toContain('harness-1')
      expect(text).not.toContain('automation-1')
      // Version 21 then drops the project-wide agent password altogether.
      expect(onDisk().projects[0]).toMatchObject({ automationToken: sealed('automation-1') })
      expect(onDisk().projects[0]).not.toHaveProperty('harnessToken')
      expect(new ConfigStore(configPath).getProjects()[0]).toMatchObject({
        automationToken: 'automation-1'
      })
    })
  })

  describe('agent copies and history (version 21)', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 21)!

    it('drops the project password, commit rules and the two switches, and sets the history defaults', () => {
      const raw: Record<string, unknown> = {
        projects: [
          {
            id: 'a',
            harnessToken: 'shared',
            harnessCommitRules: [{ id: 'r1' }],
            automationToken: 'kept',
            autoDispatch: {
              enabled: true,
              autoQueueReadyWork: true,
              autoAcceptNoChangeSessions: true,
              maxConcurrentEmbeddedSessions: 2
            }
          },
          'junk'
        ]
      }
      migration().up(raw, { newInstall: false })
      expect(raw.history).toEqual({ retentionDays: 30, saveMyEdits: true })
      expect(raw.projects).toEqual([
        {
          id: 'a',
          automationToken: 'kept',
          autoDispatch: { enabled: true, maxConcurrentEmbeddedSessions: 2 }
        },
        'junk'
      ])
    })

    it("keeps a person's own history settings", () => {
      const raw: Record<string, unknown> = { history: { retentionDays: 7, saveMyEdits: false } }
      migration().up(raw, { newInstall: false })
      expect(raw.history).toEqual({ retentionDays: 7, saveMyEdits: false })
    })

    it('gives a fresh config 30 days and "Your edits" entries on', () => {
      expect(new ConfigStore(configPath).get().history).toEqual({
        retentionDays: 30,
        saveMyEdits: true,
        keepChangesDays: 30
      })
    })
  })

  describe('22 backup-second-place', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 22)!

    it('adds no second place to backup settings a person already has', () => {
      const raw: Record<string, unknown> = {
        backups: { enabled: false, intervalHours: 6, keep: 3 }
      }
      migration().up(raw, { newInstall: false })
      expect(raw.backups).toEqual({
        enabled: false,
        intervalHours: 6,
        keep: 3,
        copyTo: null,
        lastCopiedAt: null,
        copyFailedAt: null
      })
    })

    it('keeps a second place already set', () => {
      const backups = {
        enabled: true,
        intervalHours: 24,
        keep: 7,
        copyTo: 'E:\\Backups',
        lastCopiedAt: 5,
        copyFailedAt: null
      }
      const raw: Record<string, unknown> = { backups: { ...backups } }
      migration().up(raw, { newInstall: false })
      expect(raw.backups).toEqual(backups)
    })

    it('gives a fresh config no second place', () => {
      expect(new ConfigStore(configPath).get().backups).toMatchObject({
        copyTo: null,
        lastCopiedAt: null,
        copyFailedAt: null
      })
    })
  })

  describe('23 areas-and-project-icons', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 23)!

    it('adds no areas, and no area or icon to any project', () => {
      const raw: Record<string, unknown> = { projects: [{ id: 'a', color: '#3b82f6' }, 'junk'] }
      migration().up(raw, { newInstall: false })
      expect(raw.areas).toEqual([])
      expect(raw.projects).toEqual([
        { id: 'a', color: '#3b82f6', areaId: null, icon: null },
        'junk'
      ])
    })

    it('keeps areas, areas of projects and icons already set', () => {
      const raw: Record<string, unknown> = {
        areas: [{ id: 'home', name: 'Home' }],
        projects: [{ id: 'a', areaId: 'home', icon: 'house' }]
      }
      migration().up(raw, { newInstall: false })
      expect(raw.areas).toEqual([{ id: 'home', name: 'Home' }])
      expect(raw.projects).toEqual([{ id: 'a', areaId: 'home', icon: 'house' }])
    })

    it('upgrades a version 22 config on load: an unknown area or icon reads as none', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 22,
          areas: [
            { id: 'work', name: '  Work  ' },
            { id: 'work', name: 'Again' },
            { name: 'No id' }
          ],
          projects: [
            { id: 'a', name: 'A', path: null, color: '#3b82f6', areaId: 'gone', icon: 'unicorn' },
            { id: 'b', name: 'B', path: null, color: '#3b82f6', areaId: 'work', icon: 'plane' }
          ]
        })
      )
      const config = new ConfigStore(configPath).get()
      expect(config.configVersion).toBe(LATEST_CONFIG_VERSION)
      expect(config.areas).toEqual([{ id: 'work', name: 'Work' }])
      expect(config.projects.map(({ areaId, icon }) => ({ areaId, icon }))).toEqual([
        { areaId: null, icon: null },
        { areaId: 'work', icon: 'plane' }
      ])
    })

    it('gives a fresh config no areas', () => {
      expect(new ConfigStore(configPath).get().areas).toEqual([])
    })
  })

  describe('24 weekly-review-reminder', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 24)!

    it('starts a new install with the reminder off', () => {
      const notifications = new ConfigStore(configPath).get().notifications
      expect(notifications.weeklyReviewDay).toBeNull()
      expect(notifications.weeklyReviewTime).toBe('16:00')
    })

    it('leaves the reminder off for an existing config, keeping its other settings', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 23,
          projects: [],
          notifications: { reminderTime: '08:30', quietHoursEnabled: true }
        })
      )
      const notifications = new ConfigStore(configPath).get().notifications
      expect(notifications.weeklyReviewDay).toBeNull()
      expect(notifications.weeklyReviewTime).toBe('16:00')
      expect(notifications.reminderTime).toBe('08:30')
      expect(notifications.quietHoursEnabled).toBe(true)
    })

    it('replaces values that are not a weekday or a time', () => {
      const raw: Record<string, unknown> = {
        notifications: { weeklyReviewDay: 9, weeklyReviewTime: '25:00' }
      }
      migration().up(raw, { newInstall: false })
      expect(raw.notifications).toEqual({ weeklyReviewDay: null, weeklyReviewTime: '16:00' })
    })

    it('saves a chosen day and time, and turning it off again', () => {
      const store = new ConfigStore(configPath)
      store.update({ notifications: { weeklyReviewDay: 1, weeklyReviewTime: '09:15' } })
      expect(new ConfigStore(configPath).get().notifications).toMatchObject({
        weeklyReviewDay: 1,
        weeklyReviewTime: '09:15'
      })
      store.update({ notifications: { weeklyReviewDay: null } })
      expect(new ConfigStore(configPath).get().notifications.weeklyReviewDay).toBeNull()
    })
  })

  describe('25 keep-reminding-interval', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 25)!

    it('gives a new install a 15-minute interval', () => {
      expect(new ConfigStore(configPath).get().notifications.keepRemindingMinutes).toBe(15)
    })

    it('gives an existing config a 15-minute interval, keeping its other settings', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 24,
          projects: [],
          notifications: { reminderTime: '08:30', weeklyReviewDay: 5 }
        })
      )
      const notifications = new ConfigStore(configPath).get().notifications
      expect(notifications.keepRemindingMinutes).toBe(15)
      expect(notifications.reminderTime).toBe('08:30')
      expect(notifications.weeklyReviewDay).toBe(5)
    })

    it('replaces an interval that is not one of the choices', () => {
      const raw: Record<string, unknown> = { notifications: { keepRemindingMinutes: 7 } }
      migration().up(raw, { newInstall: false })
      expect(raw.notifications).toEqual({ keepRemindingMinutes: 15 })
    })

    it('saves a chosen interval, and puts one that is not a choice back to the default', () => {
      const store = new ConfigStore(configPath)
      store.update({ notifications: { keepRemindingMinutes: 30 } })
      expect(new ConfigStore(configPath).get().notifications.keepRemindingMinutes).toBe(30)
      store.update({ notifications: { keepRemindingMinutes: 12 } })
      expect(new ConfigStore(configPath).get().notifications.keepRemindingMinutes).toBe(15)
    })
  })

  describe('26 working-hours', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 26)!

    it('gives a new install 09:00 to 17:00', () => {
      expect(new ConfigStore(configPath).get().ui.workingHours).toEqual({
        start: '09:00',
        end: '17:00'
      })
    })

    it('gives an existing config 09:00 to 17:00, keeping its other settings', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ configVersion: 25, projects: [], ui: { startPage: 'last', zoom: 1 } })
      )
      const ui = new ConfigStore(configPath).get().ui
      expect(ui.workingHours).toEqual({ start: '09:00', end: '17:00' })
      expect(ui.startPage).toBe('last')
      expect(ui.zoom).toBe(1)
    })

    it('replaces hours that cannot be read or end before they start', () => {
      const raw: Record<string, unknown> = {
        ui: { workingHours: { start: '18:00', end: '08:00' } }
      }
      migration().up(raw, { newInstall: false })
      expect(raw.ui).toEqual({ workingHours: { start: '09:00', end: '17:00' } })
    })

    it('saves chosen hours, and puts unreadable ones back to the default', () => {
      const store = new ConfigStore(configPath)
      store.update({ ui: { workingHours: { start: '08:00', end: '16:30' } } })
      expect(new ConfigStore(configPath).get().ui.workingHours).toEqual({
        start: '08:00',
        end: '16:30'
      })
      store.update({ ui: { workingHours: { start: 'soon', end: '16:30' } } })
      expect(new ConfigStore(configPath).get().ui.workingHours).toEqual({
        start: '09:00',
        end: '17:00'
      })
    })
  })

  describe('27 snip-to-task-key', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 27)!

    it('gives a new install the key off, with Ctrl+Alt+S ready', () => {
      const desktop = new ConfigStore(configPath).get().desktop
      expect(desktop.snipHotkeyEnabled).toBe(false)
      expect(desktop.snipHotkey).toBe('Ctrl+Alt+S')
    })

    it('turns it off for an existing config, keeping its Quick add key', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 26,
          projects: [],
          desktop: { quickAddHotkeyEnabled: true, quickAddHotkey: 'Ctrl+Alt+Q' }
        })
      )
      const desktop = new ConfigStore(configPath).get().desktop
      expect(desktop.snipHotkeyEnabled).toBe(false)
      expect(desktop.snipHotkey).toBe('Ctrl+Alt+S')
      expect(desktop.quickAddHotkeyEnabled).toBe(true)
      expect(desktop.quickAddHotkey).toBe('Ctrl+Alt+Q')
    })

    it('replaces a key it cannot read, and keeps a good one', () => {
      const raw: Record<string, unknown> = { desktop: { snipHotkey: 'S', snipHotkeyEnabled: true } }
      migration().up(raw, { newInstall: false })
      expect(raw.desktop).toEqual({ snipHotkey: 'Ctrl+Alt+S', snipHotkeyEnabled: true })
      const kept: Record<string, unknown> = { desktop: { snipHotkey: 'Alt+F9' } }
      migration().up(kept, { newInstall: false })
      expect(kept.desktop).toEqual({ snipHotkey: 'Alt+F9', snipHotkeyEnabled: false })
    })
  })

  describe('28 project-stages', () => {
    const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 28)!
    const defaultNames = { planning: '', active: '', 'on-hold': '', done: '' }

    it('gives a new install the default column names', () => {
      expect(new ConfigStore(configPath).get().ui.projectStageNames).toEqual(defaultNames)
    })

    it('makes every existing project Active and keeps the rest of ui', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 27,
          ui: { theme: 'dark' },
          projects: [
            { id: 'a', name: 'A', path: null, color: '#fff', enabled: true },
            { id: 'b', name: 'B', path: null, color: '#fff', enabled: false }
          ]
        })
      )
      const config = new ConfigStore(configPath).get()
      expect(config.projects.map((project) => project.stage)).toEqual(['active', 'active'])
      expect(config.ui.projectStageNames).toEqual(defaultNames)
      expect(config.ui.theme).toBe('dark')
      expect(onDisk().projects[1].stage).toBe('active')
    })

    it('keeps a stage and names it can read, and replaces the rest', () => {
      const raw: Record<string, unknown> = {
        ui: { projectStageNames: { planning: '  Ideas ', done: 7 } },
        projects: [{ stage: 'on-hold' }, { stage: 'paused' }, 'not a project']
      }
      migration().up(raw, { newInstall: false })
      expect((raw.ui as Record<string, unknown>).projectStageNames).toEqual({
        ...defaultNames,
        planning: 'Ideas'
      })
      expect(raw.projects).toEqual([{ stage: 'on-hold' }, { stage: 'active' }, 'not a project'])
    })

    it('sets and checks a stage through updateProject, and saves renamed columns', () => {
      const store = new ConfigStore(configPath)
      const project = store.registerProject({ name: 'P', folder: null })
      expect(project.stage).toBe('active')
      expect(store.updateProject(project.id, { stage: 'done' }).stage).toBe('done')
      expect(() => store.updateProject(project.id, { stage: 'paused' as never })).toThrow(/stage/)
      store.update({ ui: { projectStageNames: { ...defaultNames, 'on-hold': ' Summer ' } } })
      expect(new ConfigStore(configPath).get().ui.projectStageNames['on-hold']).toBe('Summer')
    })
  })

  describe('44 mark-demo-projects', () => {
    it('marks the demos by their names, and not copies opened from a backup', () => {
      const raw: Record<string, unknown> = {
        projects: [
          { name: 'Welcome to Ostler (Demo Project)' },
          { name: 'Harbour Café refit (Advanced Demo)' },
          { name: 'Backup copy of Welcome to Ostler (Demo Project)' },
          { name: 'Garden' },
          'not a project'
        ]
      }
      CONFIG_MIGRATIONS.find((entry) => entry.version === 44)!.up(raw, { newInstall: false })
      expect(raw.projects).toEqual([
        { name: 'Welcome to Ostler (Demo Project)', demo: 'simple' },
        { name: 'Harbour Café refit (Advanced Demo)', demo: 'advanced' },
        { name: 'Backup copy of Welcome to Ostler (Demo Project)' },
        { name: 'Garden' },
        'not a project'
      ])
    })

    it('keeps a demo mark on a new project, and the renderer cannot set or clear it', () => {
      const store = new ConfigStore(configPath)
      const demo = store.registerProject({ name: 'D', folder: null, demo: 'simple' })
      expect(demo.demo).toBe('simple')
      expect(store.registerProject({ name: 'P', folder: null }).demo).toBeUndefined()
      expect(fromRendererProjectUpdate({ demo: 'simple', name: 'E' } as never)).toEqual({
        name: 'E'
      })
    })
  })

  describe('47 email-server', () => {
    it('adds an email server that is not set up, keeping what can be read', () => {
      const raw: Record<string, unknown> = { email: { host: 'smtp.example.com', port: 'x' } }
      CONFIG_MIGRATIONS.find((entry) => entry.version === 47)!.up(raw, { newInstall: false })
      expect(raw.email).toEqual({
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
        username: '',
        password: '',
        fromAddress: '',
        fromName: ''
      })
    })

    it('keeps the password encrypted on disk and readable after a restart', () => {
      const store = new ConfigStore(configPath)
      store.update({ email: { host: 'smtp.example.com', password: 'app-password' } })
      expect(fs.readFileSync(configPath, 'utf-8')).not.toContain('"password": "app-password"')
      expect(new ConfigStore(configPath).get().email.password).toBe('app-password')
    })
  })

  describe('49 remove-nested-projects', () => {
    it('drops parentProjectId from every project', () => {
      const raw: Record<string, unknown> = {
        projects: [
          { id: 'p1', areaId: 'a' },
          { id: 'p2', parentProjectId: 'p1', areaId: 'b' },
          { id: 'p3', parentProjectId: null },
          'not a project'
        ]
      }
      CONFIG_MIGRATIONS.find((entry) => entry.version === 49)!.up(raw, { newInstall: false })
      const projects = raw.projects as Record<string, unknown>[]
      expect(projects[1]).toEqual({ id: 'p2', areaId: 'b' })
      expect('parentProjectId' in projects[2]).toBe(false)
      expect(projects[3]).toBe('not a project')
    })
  })
})
