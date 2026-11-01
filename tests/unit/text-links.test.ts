import { describe, expect, it } from 'vitest'
import { localLinksAsText, isLocalUrl } from '../../src/shared/local-links'
import { findTaskKeys, linkTaskKeys } from '../../src/shared/task-key-links'
import {
  cleanProjectPath,
  fileLinkTarget,
  fileLinkUrl,
  isOpenableFile,
  relativeFileHref
} from '../../src/shared/file-links'
import { routeSummary } from '../../electron/services/automation/help'

const PROJECT = '250a34fa-a3b9-4539-91a9-87ebc4a93cc2'

describe('local-links.ts', () => {
  it('keeps links to this computer as code, with their words', () => {
    expect(localLinksAsText('[Risk & spend](http://localhost:8513/risk)')).toBe(
      'Risk & spend (`http://localhost:8513/risk`)'
    )
    expect(localLinksAsText('Open [http://127.0.0.1:3000](http://127.0.0.1:3000).')).toBe(
      'Open `http://127.0.0.1:3000`.'
    )
    expect(localLinksAsText('Go to http://app.localhost:8080/a?b=1#c, then stop')).toBe(
      'Go to `http://app.localhost:8080/a?b=1#c`, then stop'
    )
    expect(localLinksAsText('<http://[::1]:9000/x>')).toBe('`http://[::1]:9000/x`')
  })

  it('leaves web links and code alone', () => {
    const text = [
      '[Docs](https://example.com/localhost)',
      '`http://localhost:1/x`',
      '```',
      'http://localhost:2/y',
      '```',
      'http://localhost.example.com/z'
    ].join('\n')
    expect(localLinksAsText(text)).toBe(text)
    expect(isLocalUrl('http://localhost:8513/risk')).toBe(true)
    expect(isLocalUrl('https://localhost.example.com/')).toBe(false)
  })
})

describe('task-key-links.ts', () => {
  const urls = new Map([['BRI-19', `ostler://task/${PROJECT}/x`]])

  it('finds task IDs in words and link targets, not in code, links or other words', () => {
    expect(
      findTaskKeys(
        'See BRI-19 and [the review](bri-26). Not `BRI-3`, COVID19, x-BRI-4 or ABCDEF-1.'
      )
    ).toEqual(['BRI-19', 'BRI-26'])
    expect(findTaskKeys('[BRI-5](https://example.com/BRI-6)')).toEqual([])
  })

  it('links the IDs it was given and leaves the rest as written', () => {
    expect(linkTaskKeys('BRI-19, BRI-20 and [it](bri-19)', urls)).toBe(
      `[BRI-19](ostler://task/${PROJECT}/x), BRI-20 and [it](ostler://task/${PROJECT}/x)`
    )
  })
})

describe('file-links.ts', () => {
  it('reads a file link inside the project folder only', () => {
    expect(fileLinkTarget(`ostler://file/${PROJECT}/docs/story%20review.md`, 'ostler')).toEqual({
      projectId: PROJECT,
      path: 'docs/story review.md'
    })
    for (const bad of ['docs/../../secret', '/etc/passwd', 'C:/x', 'a\\b', '..', 'a//b', ''])
      expect(cleanProjectPath(bad)).toBeNull()
    expect(fileLinkTarget(`ostler://file/not-an-id/a.md`, 'ostler')).toBeNull()
    expect(fileLinkTarget(`ostler://file/${PROJECT}/a%2F..%2F..%2Fb`, 'ostler')).toBeNull()
  })

  it('makes links it can read back', () => {
    const target = { projectId: PROJECT, path: 'docs/overnight/story-review.md' }
    expect(fileLinkTarget(fileLinkUrl(target, 'ostler'), 'ostler')).toEqual(target)
  })

  it('takes relative paths as files and nothing else', () => {
    expect(relativeFileHref('./docs/plan.md#top')).toBe('docs/plan.md')
    expect(relativeFileHref('/risk')).toBeNull()
    expect(relativeFileHref('#heading')).toBeNull()
    expect(relativeFileHref('mailto:a@example.com')).toBeNull()
  })

  it('opens documents and shows anything that could run', () => {
    expect(isOpenableFile('docs/plan.md')).toBe(true)
    expect(isOpenableFile('tools/run.cmd')).toBe(false)
    expect(isOpenableFile('script.js')).toBe(false)
    expect(isOpenableFile('.env')).toBe(false)
  })
})

describe('help.ts', () => {
  it('summarises a route in its first sentence, cut to one line', () => {
    expect(routeSummary('List the tasks. ?status= keeps some.')).toBe('List the tasks.')
    expect(routeSummary('Call GET /help. Then go.')).toBe('Call GET /help.')
    expect(routeSummary('x'.repeat(300))).toHaveLength(140)
  })
})
