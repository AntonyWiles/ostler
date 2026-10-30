import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach } from 'vitest'

/**
 * A fresh folder under the system temp folder for each test, removed after
 * it. Call it in a describe block (or at the top of the file) before the hooks
 * that use the folder: after-hooks run in reverse, so it is removed after
 * their teardown has closed whatever was open in it.
 */
export function useTempDir(prefix: string): () => string {
  let dir: string | null = null
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  })
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    dir = null
  })
  return () => {
    if (!dir) throw new Error('useTempDir: the folder exists only while a test runs')
    return dir
  }
}
