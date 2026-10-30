import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  normalizeAndResolve,
  isWithinRoot,
  isWatchedProject,
  sanitizePath,
  pathsEqual,
  containsPath
} from '../../electron/paths'

describe('paths.ts', () => {
  describe('normalizeAndResolve', () => {
    it('normalizes relative segments and resolves to absolute path', () => {
      const resolved = normalizeAndResolve('./src/../src/shared')
      expect(path.isAbsolute(resolved)).toBe(true)
      expect(resolved.endsWith('shared')).toBe(true)
    })
  })

  describe('isWithinRoot', () => {
    const root = path.resolve('/test/project')
    const insideFile = path.resolve('/test/project/src/index.ts')
    const outsideFile = path.resolve('/test/other-project/file.ts')
    const traversalAttempt = path.resolve('/test/project/../other-project/file.ts')

    it('returns true when file is exact root', () => {
      expect(isWithinRoot(root, root)).toBe(true)
    })

    it('returns true when file is inside the root directory', () => {
      expect(isWithinRoot(insideFile, root)).toBe(true)
    })

    it('returns false when file is outside the root directory', () => {
      expect(isWithinRoot(outsideFile, root)).toBe(false)
    })

    it('prevents directory traversal attacks', () => {
      expect(isWithinRoot(traversalAttempt, root)).toBe(false)
    })
  })

  describe('isWatchedProject', () => {
    const project1 = path.resolve('/projects/app1')
    const project2 = path.resolve('/projects/app2')
    const watchedProjects = [project1, project2]

    it('returns true if filePath is inside any watched project', () => {
      const filePath = path.resolve('/projects/app1/src/main.ts')
      expect(isWatchedProject(filePath, watchedProjects)).toBe(true)
    })

    it('returns false if filePath is not in any watched project', () => {
      const filePath = path.resolve('/projects/app3/index.ts')
      expect(isWatchedProject(filePath, watchedProjects)).toBe(false)
    })

    it('returns false if watched projects list is empty', () => {
      const filePath = path.resolve('/projects/app1/src/main.ts')
      expect(isWatchedProject(filePath, [])).toBe(false)
    })
  })

  describe('sanitizePath', () => {
    it('removes null bytes from path string', () => {
      const dirty = 'foo\0bar/baz\0.txt'
      expect(sanitizePath(dirty)).toBe(path.normalize('foobar/baz.txt'))
    })

    it('normalizes slashes and redundant separators', () => {
      const dirty = 'foo//bar///baz.txt'
      expect(sanitizePath(dirty)).toBe(path.normalize('foo/bar/baz.txt'))
    })
  })

  describe('pathsEqual', () => {
    it('matches the same directory written different ways', () => {
      expect(pathsEqual('/projects/app', '/projects/app/')).toBe(true)
      expect(pathsEqual('/projects/app', '/projects/nested/../app')).toBe(true)
    })

    it('does not match different directories', () => {
      expect(pathsEqual('/projects/app', '/projects/app-tools')).toBe(false)
    })

    it('folds case only where the filesystem does', () => {
      const expected = process.platform === 'win32'
      expect(pathsEqual('/Projects/App', '/projects/app')).toBe(expected)
    })
  })

  describe('containsPath', () => {
    it('is true for a directory nested inside the root', () => {
      expect(containsPath('/projects/app', '/projects/app/src')).toBe(true)
      expect(containsPath('/projects/app', '/projects/app/src/deep/file.ts')).toBe(true)
    })

    it('is false for the root itself', () => {
      expect(containsPath('/projects/app', '/projects/app')).toBe(false)
    })

    it('is false for a sibling sharing a name prefix', () => {
      expect(containsPath('/projects/app', '/projects/app-tools')).toBe(false)
    })

    it('is false when the arguments are the other way round', () => {
      expect(containsPath('/projects/app/src', '/projects/app')).toBe(false)
    })
  })
})
