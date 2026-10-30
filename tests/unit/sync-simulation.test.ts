/**
 * Sharing simulations: several PCs share one project through a network share, a Google
 * Drive-like sync app (each PC its own copy, files arriving late, out of order, half
 * written, with conflicted copies) and a sync server, with Owners, Editors, Viewers,
 * removed people and outsiders with no invite. Each scenario says what a person would
 * expect; tests/helpers/sync-simulation.ts is the world they run in.
 */
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '@shared/i18n'
import { HttpTransport } from '../../electron/services/sync/http-transport'
import { inviteMessage } from '../../electron/services/sync/invite-message'
import {
  receivedProjectUpdate,
  sharedProjectSettings
} from '../../electron/services/sync/shared-project-settings'
import { findShareFolder } from '../../electron/services/sync/share-folder-finder'
import { formatInvite, parseInvite, SharingError } from '../../electron/services/sync/sharing'
import { findInvite } from '../../src/shared/deep-link'
// @ts-expect-error: the reference server is plain JavaScript with no types.
import { createSyncServer } from '../../server/sync-server/server.mjs'
import {
  addComment,
  addTask,
  commentsOf,
  filesUnder,
  PROJECT,
  renameTask,
  SETTINGS,
  SimDrive,
  type SimPc,
  SimWorld,
  syncEveryone,
  tasksOf
} from '../helpers/sync-simulation'

/** The share's folder in a PC's synced folder. */
const shareIn = (pc: SimPc) => path.join(pc.root, 'Garden')

/** The person's key of a member, by name, as the Owner sees them. */
const personKeyOf = (owner: SimPc, name: string) =>
  owner.service.stateOf(PROJECT)!.members.find((member) => member.name === name)!.personKey

/** What a refusal says to a person: a real sentence from the locale, not a key. */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SharingError)
    const reason = (error as SharingError).reason
    const sentence = t(`errors:sharing.${reason}`)
    expect(sentence, `errors:sharing.${reason} has no wording`).not.toBe(`errors:sharing.${reason}`)
    return reason
  }
  throw new Error('expected a refusal')
}

/** Everything every PC agrees on once in step. */
function expectInStep(pcs: readonly SimPc[]) {
  const [first, ...rest] = pcs
  for (const pc of rest) {
    expect(tasksOf(pc), `${pc.name}'s tasks`).toEqual(tasksOf(first))
    expect(commentsOf(pc), `${pc.name}'s comments`).toEqual(commentsOf(first))
  }
  for (const pc of pcs) {
    const state = pc.service.stateOf(PROJECT)!
    expect(state.problems, `${pc.name}'s problems`).toEqual([])
    expect(state.status, `${pc.name}'s status`).toBe('up-to-date')
    expect(state.waitingToSend, `${pc.name} still has changes to send`).toBe(0)
    expect(pc.errors, `${pc.name} logged errors`).toEqual([])
    // Everyone sees the same people, each once, on the one PC they have here.
    const people = state.members.map((person) => [person.name, person.role, person.devices.length])
    expect(people, `${pc.name}'s people`).toEqual(
      first.service.stateOf(PROJECT)!.members.map((person) => [person.name, person.role, 1])
    )
  }
}

let world: SimWorld

afterEach(async () => {
  await world.close()
})

describe('a network share: one folder everyone uses', () => {
  let share: string
  let ann: SimPc
  let ben: SimPc
  let cat: SimPc

  beforeEach(async () => {
    world = new SimWorld()
    const network = path.join(world.dir, 'nas')
    share = path.join(network, 'Garden')
    ann = await world.pc('Ann', network)
    ben = await world.pc('Ben', network)
    cat = await world.pc('Cat', network)
    addTask(ann, 'task-1', 'Dig beds')
    await ann.share(share)
    await ben.join(ann.service.invite(PROJECT, 'editor')!, share)
    await cat.join(ann.service.invite(PROJECT, 'viewer')!, share)
    await syncEveryone([ann, ben, cat])
  })

  it('gives everyone the project, the same people and the right roles', () => {
    expectInStep([ann, ben, cat])
    expect(tasksOf(cat)).toEqual({ 'task-1': 'Dig beds' })
    for (const pc of [ann, ben, cat]) {
      const people = pc.service.stateOf(PROJECT)!.members
      expect(people.map((person) => [person.name, person.role])).toEqual([
        ['Ann', 'owner'],
        ['Ben', 'editor'],
        ['Cat', 'viewer']
      ])
    }
    expect(cat.service.stateOf(PROJECT)!.myRole).toBe('viewer')
  })

  it('carries an Editor’s changes to everyone, and a Viewer’s comment, but not a Viewer’s edit', async () => {
    renameTask(ben, 'task-1', 'Dig the beds')
    addTask(ben, 'task-2', 'Buy seeds')
    expect(() => renameTask(cat, 'task-1', 'Pave it over')).toThrow(/read-only/)
    addComment(cat, 'comment-1', 'task-1', 'Mind the roses')
    await syncEveryone([ann, ben, cat])
    expectInStep([ann, ben, cat])
    expect(tasksOf(ann)).toEqual({ 'task-1': 'Dig the beds', 'task-2': 'Buy seeds' })
    expect(commentsOf(ben)).toEqual({ 'comment-1': 'Mind the roses' })
  })

  it('ends with one title when two people rename the same task at once', async () => {
    renameTask(ann, 'task-1', 'Dig beds deep')
    renameTask(ben, 'task-1', 'Dig beds shallow')
    await syncEveryone([ann, ben, cat])
    expectInStep([ann, ben, cat])
  })

  it('refuses an Editor changing roles, and lets the Owner promote them', async () => {
    await expect(ben.service.setRole(PROJECT, personKeyOf(ben, 'Cat'), 'editor')).rejects.toThrow()
    await ann.service.setRole(PROJECT, personKeyOf(ann, 'Cat'), 'editor')
    await syncEveryone([ann, ben, cat])
    expect(cat.service.stateOf(PROJECT)!.myRole).toBe('editor')
    renameTask(cat, 'task-1', 'Dig beds, then rake')
    await syncEveryone([ann, ben, cat])
    expectInStep([ann, ben, cat])
    expect(tasksOf(ann)['task-1']).toBe('Dig beds, then rake')
  })

  it('leaves out a Viewer’s edit when their PC is tampered with to say they are an Owner', async () => {
    cat.db.prepare("UPDATE sync_shares SET my_role = 'owner'").run()
    // A fresh connection: the read-only guard is made from my_role when a connection opens.
    renameTask(cat, 'task-1', 'Pave it over')
    await cat.service.syncNow(PROJECT)
    await ann.service.syncNow(PROJECT)
    await ben.service.syncNow(PROJECT)
    expect(tasksOf(ann)['task-1']).toBe('Dig beds')
    expect(tasksOf(ben)['task-1']).toBe('Dig beds')
  })

  it('removes a person: their old invite lets no one in, their later edits reach no one, a new invite works', async () => {
    const oldInvite = ann.service.invite(PROJECT, 'editor')!
    await ann.service.removePerson(PROJECT, personKeyOf(ann, 'Ben'))
    await syncEveryone([ann, ben, cat])
    expect(ben.service.stateOf(PROJECT)!.removed).toBe(true)

    // Ben keeps editing on his own PC: nothing of it reaches the others.
    renameTask(ben, 'task-1', 'Concrete everything')
    await syncEveryone([ann, ben, cat])
    expect(tasksOf(ann)['task-1']).toBe('Dig beds')
    expect(tasksOf(cat)['task-1']).toBe('Dig beds')

    const dan = await world.pc('Dan', path.dirname(share))
    expect(await refusalOf(dan.join(oldInvite, share))).toBe('old-invite')
    expect(dan.service.stateOf(PROJECT)).toBeNull()

    await dan.join(ann.service.invite(PROJECT, 'editor')!, share)
    renameTask(ann, 'task-1', 'Dig beds again')
    await syncEveryone([ann, cat, dan])
    expectInStep([ann, cat, dan])
  })

  it('stops sharing on one PC: it keeps the project, and the others carry on', async () => {
    await ben.service.leave(PROJECT)
    expect(tasksOf(ben)).toEqual({ 'task-1': 'Dig beds' })
    renameTask(ann, 'task-1', 'Dig the beds')
    await syncEveryone([ann, cat])
    expectInStep([ann, cat])
    expect(tasksOf(ben)['task-1']).toBe('Dig beds')
  })
})

describe('no invite, or the wrong one', () => {
  let share: string
  let ann: SimPc
  let eve: SimPc

  beforeEach(async () => {
    world = new SimWorld()
    const network = path.join(world.dir, 'nas')
    share = path.join(network, 'Garden')
    ann = await world.pc('Ann', network)
    eve = await world.pc('Eve', network)
    addTask(ann, 'task-1', 'Plant the secret orchard')
    addComment(ann, 'comment-1', 'task-1', 'Gate code 4471')
    await ann.share(share)
  })

  it('keeps every file in the folder unreadable to someone with the folder but no invite', () => {
    for (const file of filesUnder(share)) {
      const text = fs.readFileSync(path.join(share, ...file.split('/'))).toString('latin1')
      expect(text, file).not.toContain('secret orchard')
      expect(text, file).not.toContain('4471')
      expect(text, file).not.toContain('Garden')
    }
  })

  it('refuses an invite with the right ids but a made-up key, keeps nothing, and leaves the folder clean for the others', async () => {
    const real = parseInvite(ann.service.invite(PROJECT, 'editor')!)
    const forged = formatInvite({
      ...real,
      projectKey: randomBytes(32),
      grant: undefined,
      invitePrivateKey: undefined
    })
    await ann.service.syncNow(PROJECT)
    const before = filesUnder(share)
    expect(await refusalOf(eve.join(forged, share))).toBe('invite-does-not-fit')
    expect(eve.service.stateOf(PROJECT)).toBeNull()
    expect(tasksOf(eve)).toEqual({})
    expect(filesUnder(share), 'files the refused join left in the shared folder').toEqual(before)
    await ann.service.syncNow(PROJECT)
    expect(ann.service.stateOf(PROJECT)!.problems).toEqual([])
  })

  it('refuses an invite to another project’s folder', async () => {
    const other = path.join(path.dirname(share), 'Other')
    fs.mkdirSync(other)
    fs.copyFileSync(path.join(share, 'share.json'), path.join(other, 'share.json'))
    const json = JSON.parse(fs.readFileSync(path.join(other, 'share.json'), 'utf8'))
    fs.writeFileSync(
      path.join(other, 'share.json'),
      JSON.stringify({ ...json, shareId: 'someone-elses-share' })
    )
    expect(await refusalOf(eve.join(ann.service.invite(PROJECT)!, other))).toBe('wrong-folder')
  })

  it('refuses a folder with no project in it', async () => {
    const empty = path.join(world.dir, 'empty')
    fs.mkdirSync(empty)
    await refusalOf(eve.join(ann.service.invite(PROJECT)!, empty))
    expect(eve.service.stateOf(PROJECT)).toBeNull()
  })

  it('refuses text that is not an invite, and an invite cut short', async () => {
    expect(await refusalOf(eve.join('hello', share))).toBe('not-an-invite')
    const invite = ann.service.invite(PROJECT)!
    await refusalOf(eve.join(invite.slice(0, invite.length / 2), share))
    expect(eve.service.stateOf(PROJECT)).toBeNull()
  })

  it('ignores a change file an outsider drops into the folder, and keeps applying the real ones', async () => {
    const bob = await world.pc('Bob', path.dirname(share))
    await bob.join(ann.service.invite(PROJECT)!, share)
    const changes = path.join(share, 'changes', 'outsider-device')
    fs.mkdirSync(changes, { recursive: true })
    fs.writeFileSync(path.join(changes, '000001.ostlerchanges'), randomBytes(300))
    renameTask(ann, 'task-1', 'Plant the orchard')
    await syncEveryone([ann, bob])
    expect(tasksOf(bob)['task-1']).toBe('Plant the orchard')
    // The outsider's file is reported, not applied.
    expect(bob.service.stateOf(PROJECT)!.problems.length).toBeGreaterThan(0)
  })

  it('finds the invite in the message a person was sent, and joins with it', async () => {
    const message = inviteMessage('Garden', ann.service.invite(PROJECT)!, share)
    const invite = findInvite(message, 'ostler')
    expect(invite).not.toBeNull()
    await eve.join(invite!, share)
    expect(tasksOf(eve)).toEqual({ 'task-1': 'Plant the secret orchard' })
  })
})

describe('a Google Drive-like sync app: each PC its own copy, synced late', () => {
  let drive: SimDrive
  let ann: SimPc
  let ben: SimPc
  let cat: SimPc

  beforeEach(async () => {
    world = new SimWorld()
    drive = new SimDrive(world)
    ann = await world.pc('Ann')
    ben = await world.pc('Ben')
    cat = await world.pc('Cat')
    addTask(ann, 'task-1', 'Dig beds')
    await ann.share(shareIn(ann))
  })

  const joinAll = async () => {
    drive.syncAll([ann, ben, cat])
    await ben.join(ann.service.invite(PROJECT, 'editor')!, shareIn(ben))
    await cat.join(ann.service.invite(PROJECT, 'viewer')!, shareIn(cat))
    await syncEveryone([ann, ben, cat], drive)
  }

  it('refuses a join before the folder has arrived, keeps nothing, and joins once it has', async () => {
    await refusalOf(ben.join(ann.service.invite(PROJECT)!, shareIn(ben)))
    expect(ben.service.stateOf(PROJECT)).toBeNull()
    drive.syncAll([ann, ben])
    await ben.join(ann.service.invite(PROJECT)!, shareIn(ben))
    expect(tasksOf(ben)).toEqual({ 'task-1': 'Dig beds' })
  })

  it('refuses a join while the project is still arriving, leaves nothing behind, and joins once as one device', async () => {
    drive.sync(ann)
    // Only the share file and the member files have arrived on Ben's PC so far.
    drive.sync(ben, { only: (file) => file === 'Garden/share.json' || file.includes('/members/') })
    expect(await refusalOf(ben.join(ann.service.invite(PROJECT)!, shareIn(ben)))).toBe(
      'no-snapshot'
    )
    expect(filesUnder(shareIn(ben)).filter((file) => file.startsWith('members/'))).toHaveLength(1)
    drive.syncAll([ann, ben])
    await ben.join(ann.service.invite(PROJECT)!, shareIn(ben))
    await syncEveryone([ann, ben], drive)
    expectInStep([ann, ben])
  })

  it('finds the shared folder on the joiner’s PC once it has synced there', async () => {
    const shareId = parseInvite(ann.service.invite(PROJECT)!).shareId
    const limits = { maxDepth: 5, maxFolders: 5000, timeoutMs: 5000, fs }
    expect(await findShareFolder(shareId, [ben.root], limits)).toBeNull()
    drive.syncAll([ann, ben])
    expect(await findShareFolder(shareId, [ben.root], limits)).toBe(shareIn(ben))
  })

  it('keeps everyone in step once the sync app catches up', async () => {
    await joinAll()
    renameTask(ben, 'task-1', 'Dig the beds')
    addComment(cat, 'comment-1', 'task-1', 'Mind the roses')
    addTask(ann, 'task-2', 'Buy seeds')
    await syncEveryone([ann, ben, cat], drive)
    expectInStep([ann, ben, cat])
  })

  it('shows nothing new until the sync app has brought the files, then everything', async () => {
    await joinAll()
    renameTask(ben, 'task-1', 'Dig the beds')
    await ben.service.syncNow(PROJECT)
    await ann.service.syncNow(PROJECT)
    expect(tasksOf(ann)['task-1']).toBe('Dig beds')
    expect(ann.service.stateOf(PROJECT)!.problems).toEqual([])
    await syncEveryone([ann, ben, cat], drive)
    expect(tasksOf(ann)['task-1']).toBe('Dig the beds')
  })

  it('catches up a PC that was offline for a long time and edited meanwhile', async () => {
    await joinAll()
    drive.setOffline(ben, true)
    for (let i = 0; i < 20; i++) addTask(ben, `ben-${i}`, `Ben's task ${i}`)
    for (let i = 0; i < 20; i++) addTask(ann, `ann-${i}`, `Ann's task ${i}`)
    renameTask(ann, 'task-1', 'Dig beds (Ann)')
    renameTask(ben, 'task-1', 'Dig beds (Ben)')
    await syncEveryone([ann, ben, cat], drive)
    expect(Object.keys(tasksOf(ann))).toHaveLength(21)
    drive.setOffline(ben, false)
    await syncEveryone([ann, ben, cat], drive)
    expectInStep([ann, ben, cat])
    expect(Object.keys(tasksOf(cat))).toHaveLength(41)
  })

  it('copes with files arriving in any order and a few at a time', async () => {
    await joinAll()
    for (let i = 0; i < 6; i++) {
      addTask(ben, `ben-${i}`, `Ben's task ${i}`)
      await ben.service.syncNow(PROJECT)
    }
    drive.sync(ben)
    for (let step = 0; step < 12; step++) {
      drive.sync(ann, { order: { seed: step + 1 }, limit: 1 })
      await ann.service.syncNow(PROJECT)
    }
    await syncEveryone([ann, ben, cat], drive)
    expectInStep([ann, ben, cat])
  })

  it('lets a newcomer join while member and change files are still arriving out of order', async () => {
    await joinAll()
    addTask(ben, 'task-2', 'Buy seeds')
    await syncEveryone([ann, ben], drive)
    const dan = await world.pc('Dan')
    drive.sync(dan, { order: 'reverse', only: (file) => !file.includes('/members/') })
    try {
      await dan.join(ann.service.invite(PROJECT)!, shareIn(dan))
    } catch {
      // Refusing until the member files are here is fine; what matters is how it ends.
    }
    drive.sync(dan)
    if (!dan.service.stateOf(PROJECT)) await dan.join(ann.service.invite(PROJECT)!, shareIn(dan))
    await syncEveryone([ann, ben, cat, dan], drive)
    expectInStep([ann, ben, cat, dan])
  })

  it('recovers when a file first arrives half written', async () => {
    await joinAll()
    renameTask(ben, 'task-1', 'Dig the beds')
    addTask(ben, 'task-2', 'Buy seeds')
    await ben.service.syncNow(PROJECT)
    drive.sync(ben)
    drive.sync(ann, { partial: (file) => file.startsWith('Garden/changes/') })
    await ann.service.syncNow(PROJECT)
    // Half a file may be reported, but must not be taken as the whole.
    expect(tasksOf(ann)['task-2']).toBeUndefined()
    drive.sync(ann)
    await ann.service.syncNow(PROJECT)
    await syncEveryone([ann, ben, cat], drive)
    expectInStep([ann, ben, cat])
    expect(tasksOf(ann)).toEqual({ 'task-1': 'Dig the beds', 'task-2': 'Buy seeds' })
  })

  it('recovers when the member file of someone new arrives half written', async () => {
    drive.syncAll([ann, ben])
    await ben.join(ann.service.invite(PROJECT)!, shareIn(ben))
    addTask(ben, 'task-2', 'Buy seeds')
    await ben.service.syncNow(PROJECT)
    drive.sync(ben)
    drive.sync(ann, { partial: (file) => file.includes('/members/') })
    await ann.service.syncNow(PROJECT)
    drive.sync(ann)
    await syncEveryone([ann, ben], drive)
    expectInStep([ann, ben])
  })

  it('takes no notice of conflicted copies the sync app makes', async () => {
    await joinAll()
    addTask(ben, 'task-2', 'Buy seeds')
    await syncEveryone([ann, ben, cat], drive)
    const someChange = filesUnder(ann.root).find((file) => file.includes('/changes/'))!
    drive.conflictCopy(ann, someChange)
    drive.conflictCopy(ann, 'Garden/share.json', 'Ann-PC')
    renameTask(ben, 'task-1', 'Dig the beds')
    await syncEveryone([ann, ben, cat], drive)
    expectInStep([ann, ben, cat])
  })

  it('removes a person even while their PC is offline, and they learn it when it is back', async () => {
    await joinAll()
    drive.setOffline(ben, true)
    await ann.service.removePerson(PROJECT, personKeyOf(ann, 'Ben'))
    renameTask(ben, 'task-1', 'Concrete everything')
    renameTask(ann, 'task-1', 'Dig the beds')
    await syncEveryone([ann, ben, cat], drive)
    drive.setOffline(ben, false)
    await syncEveryone([ann, ben, cat], drive)
    expect(ben.service.stateOf(PROJECT)!.removed).toBe(true)
    expect(tasksOf(ann)['task-1']).toBe('Dig the beds')
    expect(tasksOf(cat)['task-1']).toBe('Dig the beds')
    expectInStep([ann, cat])
  })
})

describe('a sync server', () => {
  const KEY = 'a-long-random-access-key'
  let server: http.Server
  let base: string

  beforeEach(async () => {
    world = new SimWorld({
      openServer: (location) =>
        new HttpTransport(location, {
          fetch: (url, init) => fetch(url, init),
          authorization: async () => `Bearer ${KEY}`,
          pollMs: 3_600_000
        })
    })
    server = http.createServer(
      createSyncServer({
        dataDir: path.join(world.dir, 'server'),
        keys: [KEY],
        log: () => undefined
      })
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('shares, joins with only the invite, and keeps an Owner, an Editor and a Viewer in step', async () => {
    const ann = await world.pc('Ann')
    const ben = await world.pc('Ben')
    const cat = await world.pc('Cat')
    addTask(ann, 'task-1', 'Dig beds')
    const location = `${base}/spaces/0f8fad5b-d9cb-469f-a165-70867728950e`
    await ann.share(location)
    const editorInvite = ann.service.invite(PROJECT, 'editor')!
    const viewerInvite = ann.service.invite(PROJECT, 'viewer')!
    expect(parseInvite(editorInvite).location).toBe(location)
    await ben.join(editorInvite, parseInvite(editorInvite).location!)
    await cat.join(viewerInvite, parseInvite(viewerInvite).location!)

    renameTask(ben, 'task-1', 'Dig the beds')
    addComment(cat, 'comment-1', 'task-1', 'Mind the roses')
    expect(() => renameTask(cat, 'task-1', 'Pave it')).toThrow(/read-only/)
    await syncEveryone([ann, ben, cat])
    expectInStep([ann, ben, cat])
    expect(tasksOf(cat)['task-1']).toBe('Dig the beds')
  })

  it('gives the person invited the server’s own steps, not a folder’s', async () => {
    const ann = await world.pc('Ann')
    const location = `${base}/spaces/1b4e28ba-2fa1-11d2-883f-0016d3cca427`
    await ann.share(location)
    const message = inviteMessage(SETTINGS.name, ann.service.invite(PROJECT)!, location)
    expect(message).toContain('127.0.0.1')
    expect(message).not.toMatch(/Google Drive|OneDrive|Dropbox/)
  })
})

describe('the project icon, and who may change the shared settings', () => {
  let share: string
  let ann: SimPc
  let ben: SimPc
  let cat: SimPc

  const iconOf = (pc: SimPc) => pc.store.getProjects().find((p) => p.id === PROJECT)?.icon ?? null
  const nameOf = (pc: SimPc) => pc.store.getProjects().find((p) => p.id === PROJECT)?.name

  beforeEach(async () => {
    world = new SimWorld()
    const network = path.join(world.dir, 'nas')
    share = path.join(network, 'Garden')
    ann = await world.pc('Ann', network)
    ben = await world.pc('Ben', network)
    cat = await world.pc('Cat', network)
    addTask(ann, 'task-1', 'Dig beds')
    await ann.share(share)
    ann.store.updateProject(PROJECT, { icon: 'flower' })
    await ann.service.syncNow(PROJECT)
    await ben.join(ann.service.invite(PROJECT, 'editor')!, share)
    await cat.join(ann.service.invite(PROJECT, 'viewer')!, share)
    await syncEveryone([ann, ben, cat])
  })

  it('gives everyone who joins the icon the Owner set', () => {
    expect([ann, ben, cat].map(iconOf)).toEqual(['flower', 'flower', 'flower'])
  })

  it('carries the Owner’s new icon, and an Editor’s, to everyone, and clearing it too', async () => {
    ann.store.updateProject(PROJECT, { icon: 'tree' })
    await syncEveryone([ann, ben, cat])
    expect([ann, ben, cat].map(iconOf)).toEqual(['tree', 'tree', 'tree'])
    ben.store.updateProject(PROJECT, { icon: 'sprout' })
    await syncEveryone([ann, ben, cat])
    expect([ann, ben, cat].map(iconOf)).toEqual(['sprout', 'sprout', 'sprout'])
    ann.store.updateProject(PROJECT, { icon: null })
    await syncEveryone([ann, ben, cat])
    expect([ann, ben, cat].map(iconOf)).toEqual([null, null, null])
  })

  it('gives someone who joins later the icon as it is now', async () => {
    ben.store.updateProject(PROJECT, { icon: 'sun' })
    await syncEveryone([ann, ben, cat])
    const dan = await world.pc('Dan', path.dirname(share))
    await dan.join(ann.service.invite(PROJECT)!, share)
    await syncEveryone([ann, ben, cat, dan])
    expect(iconOf(dan)).toBe('sun')
  })

  it('refuses a Viewer changing the name or icon, from settings or the automation API, but lets them choose an area', () => {
    expect(() => cat.store.updateProject(PROJECT, { icon: 'car' })).toThrow(/view this project/)
    expect(() => cat.store.updateProject(PROJECT, { name: 'Car park' })).toThrow(
      /view this project/
    )
    // Saving what it already is, and settings that stay on this PC, are fine.
    cat.store.updateProject(PROJECT, { icon: 'flower', stage: 'active' })
    expect(iconOf(cat)).toBe('flower')
  })

  it('leaves out settings from a Viewer whose PC is tampered with, says so once, and keeps the Owner’s', async () => {
    cat.db.prepare("UPDATE sync_shares SET my_role = 'owner'").run()
    cat.store.updateProject(PROJECT, { icon: 'car', name: 'Car park' })
    await cat.service.syncNow(PROJECT)
    await ann.service.syncNow(PROJECT)
    await ben.service.syncNow(PROJECT)
    expect([iconOf(ann), nameOf(ann)]).toEqual(['flower', 'Garden'])
    expect([iconOf(ben), nameOf(ben)]).toEqual(['flower', 'Garden'])
    expect(ann.service.stateOf(PROJECT)!.problems).toEqual([
      { kind: 'record', reason: 'not-allowed' }
    ])
    await ann.service.syncNow(PROJECT)
    expect(ann.service.stateOf(PROJECT)!.problems).toEqual([])

    // The Owner's next change still reaches everyone, the tampered PC too.
    ann.store.updateProject(PROJECT, { icon: 'leaf' })
    await syncEveryone([ann, ben, cat])
    expect([ann, ben, cat].map(iconOf)).toEqual(['leaf', 'leaf', 'leaf'])
  })

  it('keeps the icon when settings arrive from an Ostler from before icons were shared', async () => {
    const { icon: _icon, ...old } = sharedProjectSettings(ann.store.getProjects()[0])
    ben.store.updateProject(PROJECT, receivedProjectUpdate({ ...old, name: 'Garden plot' }), {
      received: true
    })
    expect(iconOf(ben)).toBe('flower')
    ben.store.updateProject(PROJECT, receivedProjectUpdate({ ...old, icon: 'hovercraft' }), {
      received: true
    })
    expect(iconOf(ben)).toBe('flower')
  })
})

describe('the project icon through a sync server', () => {
  const KEY = 'a-long-random-access-key'
  let server: http.Server

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('reaches whoever joins, and a change reaches everyone', async () => {
    world = new SimWorld({
      openServer: (location) =>
        new HttpTransport(location, {
          fetch: (url, init) => fetch(url, init),
          authorization: async () => `Bearer ${KEY}`,
          pollMs: 3_600_000
        })
    })
    server = http.createServer(
      createSyncServer({
        dataDir: path.join(world.dir, 'server'),
        keys: [KEY],
        log: () => undefined
      })
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const ann = await world.pc('Ann')
    const ben = await world.pc('Ben')
    const location = `${base}/spaces/6ba7b810-9dad-11d1-80b4-00c04fd430c8`
    await ann.share(location)
    ann.store.updateProject(PROJECT, { icon: 'music' })
    await ann.service.syncNow(PROJECT)
    await ben.join(ann.service.invite(PROJECT)!, location)
    await syncEveryone([ann, ben])
    expect(ben.store.getProjects()[0].icon).toBe('music')
    ben.store.updateProject(PROJECT, { icon: 'film' })
    await syncEveryone([ann, ben])
    expect(ann.store.getProjects()[0].icon).toBe('film')
  })
})
