import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { FileLog, describeError } from '../../electron/app/logging'
import { useTempDir } from '../helpers/temp-dir'

describe('FileLog', () => {
  const dir = useTempDir('ostler-log-')

  it('writes errors with their stack to main.log', () => {
    const log = new FileLog(dir())
    log.error('Something failed', new Error('boom'))
    const text = fs.readFileSync(path.join(dir(), 'main.log'), 'utf8')
    expect(text).toMatch(/ERROR Something failed\nError: boom\n\s+at /)
  })

  it('rotates at the size limit and keeps three files in all', () => {
    const log = new FileLog(dir(), 200, 3)
    for (let index = 0; index < 40; index += 1) log.info(`line ${index} ${'x'.repeat(40)}`)

    expect(fs.readdirSync(dir()).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log'])
    for (const file of fs.readdirSync(dir())) {
      expect(fs.statSync(path.join(dir(), file)).size).toBeLessThanOrEqual(200)
    }
    const tail = log.tail(3)
    expect(tail).toHaveLength(3)
    expect(tail[2]).toContain('line 39')
  })

  it('carries on from an existing file after a restart', () => {
    new FileLog(dir()).info('first run')
    const log = new FileLog(dir())
    log.info('second run')
    expect(log.tail(10).map((line) => line.split(' ').slice(2).join(' '))).toEqual([
      'first run',
      'second run'
    ])
  })

  it('describes values that are not errors', () => {
    expect(describeError('plain')).toBe('plain')
    expect(describeError({ code: 7 })).toContain('code: 7')
  })
})
