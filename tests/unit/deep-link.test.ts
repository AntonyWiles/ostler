import { describe, expect, it } from 'vitest'
import { deepLinkFor, findDeepLinkArgument, parseDeepLink } from '../../src/shared/deep-link'

const SCHEME = 'ostler'
const PROJECT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const TASK = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const VIEWS = ['overview', 'board', 'list', 'agents']
const isView = (view: string) => VIEWS.includes(view)
const parse = (raw: unknown) => parseDeepLink(raw, SCHEME, isView)

describe('parseDeepLink', () => {
  it('accepts the five shapes', () => {
    expect(parse('ostler://inbox')).toEqual({ ok: true, request: { kind: 'inbox' } })
    expect(parse('ostler://weekly-review')).toEqual({
      ok: true,
      request: { kind: 'weekly-review' }
    })
    expect(deepLinkFor({ kind: 'weekly-review' }, SCHEME)).toBe('ostler://weekly-review')
    expect(parse('ostler://weekly-review/extra').ok).toBe(false)
    expect(parse('ostler://quick-add')).toEqual({
      ok: true,
      request: { kind: 'quick-add' }
    })
    expect(parse(`ostler://task/${PROJECT}/${TASK}`)).toEqual({
      ok: true,
      request: { kind: 'task', projectId: PROJECT, taskId: TASK }
    })
    expect(parse(`ostler://project/${PROJECT}/board`)).toEqual({
      ok: true,
      request: { kind: 'project', projectId: PROJECT, view: 'board' }
    })
  })

  it('tolerates the trailing slash and scheme case Windows may pass', () => {
    expect(parse('ostler://inbox/')).toMatchObject({ ok: true })
    expect(parse('OSTLER://inbox')).toMatchObject({ ok: true })
  })

  it('round-trips every link Ostler makes', () => {
    for (const request of [
      { kind: 'inbox' as const },
      { kind: 'quick-add' as const },
      { kind: 'task' as const, projectId: PROJECT, taskId: TASK },
      { kind: 'project' as const, projectId: PROJECT, view: 'list' }
    ]) {
      expect(parse(deepLinkFor(request, SCHEME))).toEqual({ ok: true, request })
    }
  })

  it('rejects malformed links', () => {
    for (const raw of [
      undefined,
      42,
      '',
      'ostler:inbox',
      'ostler://',
      'ostler://inbox/extra',
      'ostler://task',
      `ostler://task/${PROJECT}`,
      `ostler://task/${PROJECT}/${TASK}/more`,
      'ostler://task/not-an-id/also-not',
      `ostler://task/${PROJECT}/123`,
      `ostler://project/${PROJECT}`,
      'ostler://settings',
      'https://example.com/inbox',
      'other-app://inbox'
    ]) {
      expect(parse(raw).ok, String(raw)).toBe(false)
    }
  })

  it('rejects a view the registry does not know', () => {
    expect(parse(`ostler://project/${PROJECT}/secret`)).toEqual({
      ok: false,
      reason: 'unknown view'
    })
  })

  it('rejects injection attempts', () => {
    for (const raw of [
      `ostler://task/${PROJECT}/..%2F..%2Fwindows`,
      'ostler://task/../../etc/passwd',
      'ostler://inbox?delete=all',
      'ostler://inbox#x',
      'ostler://inbox%00',
      `ostler://project/${PROJECT}/board?remove=1`,
      `ostler://project/${PROJECT}/C:/Windows`,
      'ostler://inbox" --inspect "',
      'ostler://inbox\nostler://quick-add',
      `ostler://${'a/'.repeat(200)}`
    ]) {
      expect(parse(raw).ok, raw).toBe(false)
    }
  })
})

describe('findDeepLinkArgument', () => {
  it("finds the link among a launch's arguments", () => {
    expect(findDeepLinkArgument(['ostler.exe', '--hidden', 'ostler://inbox'], SCHEME)).toBe(
      'ostler://inbox'
    )
    expect(findDeepLinkArgument(['ostler.exe', '.'], SCHEME)).toBeNull()
  })
})

describe('item links (N4.4a)', () => {
  it('accepts milestone, decision and Library links, and round-trips them', () => {
    for (const kind of ['milestone', 'decision', 'library'] as const) {
      const raw = `ostler://${kind}/${PROJECT}/${TASK}`
      expect(parse(raw)).toEqual({ ok: true, request: { kind, projectId: PROJECT, id: TASK } })
      expect(deepLinkFor({ kind, projectId: PROJECT, id: TASK }, SCHEME)).toBe(raw)
    }
  })

  it('refuses everything else about them', () => {
    for (const raw of [
      `ostler://milestone/${PROJECT}/${TASK}?edit=1`,
      `ostler://decision/${PROJECT}/${TASK}#top`,
      `ostler://library/${PROJECT}/not-an-id`,
      `ostler://library/bad/${TASK}`,
      `ostler://library/${PROJECT}`,
      `ostler://library/${PROJECT}/${TASK}/extra`,
      `ostler://goal/${PROJECT}/${TASK}`,
      `ostler://comment/${PROJECT}/${TASK}`,
      `ostler://milestone/${PROJECT}/${TASK}/${'a'.repeat(120)}`,
      `other-scheme://library/${PROJECT}/${TASK}`
    ]) {
      expect(parse(raw).ok, raw).toBe(false)
    }
  })
})
