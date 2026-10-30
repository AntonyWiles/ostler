import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UPDATE_SETTINGS, type UpdateSettings, type UpdateState } from '@shared/ostler-api'
import {
  UpdateService,
  releaseNotesText,
  updateErrorMessage,
  updatesOffReason,
  type Updater,
  type UpdateServiceDependencies
} from '../../electron/services/update-service'

/** A stand-in for electron-updater's autoUpdater: the test emits its events. */
class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = false
  checkForUpdates = vi.fn(async () => undefined)
  downloadUpdate = vi.fn(async () => undefined)
  quitAndInstall = vi.fn()
}

function setup(overrides: Partial<UpdateServiceDependencies> = {}) {
  const updater = new FakeUpdater()
  const settings: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS }
  let agents = 0
  const states: UpdateState[] = []
  const deps: UpdateServiceDependencies = {
    offReason: null,
    loadUpdater: vi.fn(() => updater),
    settings: () => settings,
    agentsRunning: () => agents,
    beforeInstall: vi.fn(),
    onChange: (state) => states.push(state),
    log: vi.fn(),
    now: () => 1000,
    agentPollMs: 100,
    ...overrides
  }
  const service = new UpdateService(deps)
  return {
    service,
    updater,
    settings,
    deps,
    states,
    setAgents: (count: number) => {
      agents = count
    }
  }
}

describe('updatesOffReason', () => {
  it('is off in development and in the portable exe, on when installed', () => {
    expect(updatesOffReason({}, false)).toBe('development')
    expect(updatesOffReason({ PORTABLE_EXECUTABLE_DIR: 'C:\\x' }, true)).toBe('portable')
    expect(updatesOffReason({}, true)).toBeNull()
    // An unpacked --dir build has no app-update.yml.
    expect(updatesOffReason({}, true, false)).toBe('development')
  })
})

describe('UpdateService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never loads the updater or checks in development or portable builds', async () => {
    for (const reason of ['development', 'portable'] as const) {
      const { service, deps } = setup({ offReason: reason })
      service.start()
      await service.check()
      await service.download()
      expect(deps.loadUpdater).not.toHaveBeenCalled()
      expect(service.state()).toEqual({ status: 'off', reason })
      expect(service.inboxItem()).toBeNull()
    }
  })

  it('checks at start-up only when automatic checks are on', () => {
    const on = setup()
    on.service.start()
    expect(on.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    const off = setup()
    off.settings.checkAutomatically = false
    off.service.start()
    expect(off.deps.loadUpdater).not.toHaveBeenCalled()
  })

  it('applies the settings to the updater, and never installs on quit', async () => {
    const { service, updater, settings } = setup()
    settings.receiveBeta = true
    settings.downloadAutomatically = false
    await service.check()
    expect(updater.allowPrerelease).toBe(true)
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    settings.receiveBeta = false
    service.settingsChanged()
    expect(updater.allowPrerelease).toBe(false)
  })

  it('goes from checking to downloading to ready, and adds an Inbox item', async () => {
    const { service, updater, states } = setup()
    await service.check()
    expect(states[0]).toEqual({ status: 'checking' })
    updater.emit('update-available', {
      version: '1.1.0',
      releaseNotes: '<p>Faster <b>boards</b></p>'
    })
    expect(service.state()).toEqual({
      status: 'downloading',
      version: '1.1.0',
      notes: 'Faster boards',
      percent: 0
    })
    updater.emit('download-progress', { percent: 42 })
    expect(service.state()).toMatchObject({ status: 'downloading', percent: 42 })
    updater.emit('update-downloaded', { version: '1.1.0', releaseNotes: null })
    expect(service.state()).toEqual({
      status: 'ready',
      version: '1.1.0',
      notes: 'Faster boards',
      agentsRunning: 0,
      restartWhenAgentsFinish: false
    })
    expect(service.inboxItem()).toMatchObject({
      key: 'update:1.1.0',
      kind: 'update',
      title: 'Update ready. Restart to update',
      projectId: null
    })
    // Nothing restarts on its own.
    vi.advanceTimersByTime(60_000)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('waits for the person to download when automatic downloads are off', async () => {
    const { service, updater, settings } = setup()
    settings.downloadAutomatically = false
    await service.check()
    updater.emit('update-available', { version: '1.1.0' })
    expect(service.state()).toMatchObject({ status: 'available', version: '1.1.0' })
    await service.download()
    expect(updater.downloadUpdate).toHaveBeenCalled()
    expect(service.state()).toMatchObject({ status: 'downloading' })
  })

  it('says when there is nothing new', async () => {
    const { service, updater } = setup()
    await service.check()
    updater.emit('update-not-available', { version: '1.0.0' })
    expect(service.state()).toEqual({ status: 'up-to-date', checkedAt: 1000 })
  })

  it('restarts now when the person asks, after quitting is under way', async () => {
    const { service, updater, deps } = setup()
    expect(() => service.restart('now')).toThrow('No update is ready')
    await service.check()
    updater.emit('update-downloaded', { version: '1.1.0' })
    service.restart('now')
    expect(deps.beforeInstall).toHaveBeenCalled()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('defers the restart while agents run, and restarts once they finish', async () => {
    const { service, updater, setAgents } = setup()
    await service.check()
    setAgents(2)
    updater.emit('update-downloaded', { version: '1.1.0' })
    expect(service.state()).toMatchObject({ status: 'ready', agentsRunning: 2 })
    expect(service.restart('when-agents-finish')).toMatchObject({
      restartWhenAgentsFinish: true
    })
    vi.advanceTimersByTime(500)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    setAgents(0)
    vi.advanceTimersByTime(100)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('restarts at once from "when agents finish" if none are running', async () => {
    const { service, updater } = setup()
    await service.check()
    updater.emit('update-downloaded', { version: '1.1.0' })
    service.restart('when-agents-finish')
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('shows errors in plain words and logs the raw one', async () => {
    const { service, updater, deps } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND github.com'))
    await service.check()
    expect(service.state()).toEqual({
      status: 'error',
      message: "Couldn't reach the update server. Check your internet connection, then try again."
    })
    expect(deps.log).toHaveBeenCalledWith('Updating failed: getaddrinfo ENOTFOUND github.com')
    // electron-updater emits 'error' and rejects with the same error: one log line.
    const twice = new Error(['HttpError: 404 ', '"headers": {}'].join('\n'))
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('error', twice)
      throw twice
    })
    await service.check()
    expect(deps.log).toHaveBeenCalledTimes(2)
    expect(deps.log).toHaveBeenLastCalledWith('Updating failed: HttpError: 404 ')
    // A later error event after a finished download keeps the download.
    updater.emit('update-downloaded', { version: '1.1.0' })
    updater.emit('error', new Error('boom'))
    expect(service.state()).toMatchObject({ status: 'ready' })
  })
})

describe('updateErrorMessage', () => {
  it('turns known failures into advice and the rest into a plain sentence', () => {
    expect(updateErrorMessage(new Error('sha512 checksum mismatch'))).toMatch(/damaged/)
    expect(updateErrorMessage(new Error('HttpError: 404 latest.yml'))).toMatch(/No update/)
    expect(updateErrorMessage(new Error('HttpError: 403 rate limit exceeded'))).toMatch(/busy/)
    expect(updateErrorMessage(new Error('weird'))).toBe("Couldn't update. Try again later.")
  })
})

describe('releaseNotesText', () => {
  it('turns the HTML release body and note lists into plain text', () => {
    expect(releaseNotesText('<h3>Added</h3><ul><li>Boards &amp; lists</li></ul>')).toBe(
      'Added\n- Boards & lists'
    )
    expect(releaseNotesText([{ version: '1.1.0', note: 'One' }])).toBe('One')
    expect(releaseNotesText(null)).toBe('')
  })
})
