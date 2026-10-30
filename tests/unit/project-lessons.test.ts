import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))

import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import {
  LESSONS_HEADING,
  MAX_RESOLVED_CONVENTIONS_LENGTH,
  resolveProjectConventions
} from '../../electron/services/project-conventions'
import {
  addLesson,
  editLesson,
  lessonDate,
  MAX_LESSON_LENGTH,
  MAX_PROJECT_LESSONS,
  moveLessonIntoConventions,
  parseProjectLessons,
  removeLesson
} from '../../src/shared/project-lessons'
import type { ProjectLesson } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const tempDir = useTempDir('ostler-lessons-')

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime()

function lesson(id: string, text: string, addedAt: number, enabled = true): ProjectLesson {
  return { id, text, enabled, addedAt, source: null }
}

describe('config migration 32: lessons', () => {
  it('gives every project an empty list of lessons and keeps one it has', () => {
    const configPath = path.join(tempDir(), 'config.json')
    const kept = lesson('l1', 'Keep it', day('2026-10-03'))
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        configVersion: 31,
        projects: [
          { id: 'a', name: 'A', path: null, color: '#fff', enabled: true },
          { id: 'b', name: 'B', path: null, color: '#fff', enabled: true, agentLessons: [kept] }
        ]
      })
    )
    const store = new ConfigStore(configPath)
    const [a, b] = store.getProjects()
    expect(a.agentLessons).toEqual([])
    expect(b.agentLessons).toEqual([kept])
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).configVersion).toBeGreaterThanOrEqual(
      32
    )
    expect(CONFIG_MIGRATIONS.find((entry) => entry.version === 32)?.name).toBe('project-lessons')
  })

  it('starts a new project with none', () => {
    const store = new ConfigStore(path.join(tempDir(), 'config.json'))
    expect(store.registerProject({ name: 'P', folder: null }).agentLessons).toEqual([])
  })
})

describe('lesson limits', () => {
  it('trims a lesson and refuses an empty or over-long one', () => {
    const made = { id: 'x', now: 1 }
    expect(addLesson([], { text: '  Use tabs.  ' }, made)[0]).toMatchObject({
      text: 'Use tabs.',
      enabled: true,
      addedAt: 1,
      source: null
    })
    expect(() => addLesson([], { text: '   ' }, made)).toThrow(/Write the lesson/)
    expect(() => addLesson([], { text: 'a'.repeat(MAX_LESSON_LENGTH + 1) }, made)).toThrow(
      /at most 500/
    )
    expect(addLesson([], { text: 'a'.repeat(MAX_LESSON_LENGTH) }, made)).toHaveLength(1)
  })

  it('keeps at most 100 lessons per project', () => {
    const full = Array.from({ length: MAX_PROJECT_LESSONS }, (_, i) => lesson(`l${i}`, 'x', i))
    expect(() => addLesson(full, { text: 'one more' }, { id: 'n', now: 1 })).toThrow(/at most 100/)
    expect(() => parseProjectLessons([...full, lesson('n', 'x', 1)])).toThrow(/at most 100/)
  })

  it('keeps where a lesson came from', () => {
    const [made] = addLesson(
      [],
      { text: 'Rule', source: { sessionId: 's1', taskTitle: ' Fix the login ' } },
      { id: 'x', now: 1 }
    )
    expect(made.source).toEqual({ sessionId: 's1', taskTitle: 'Fix the login' })
  })

  it('refuses a malformed list, a duplicate id and an unknown lesson', () => {
    expect(() => parseProjectLessons('nope')).toThrow()
    expect(() => parseProjectLessons([{ id: 'a', text: 'x', addedAt: 1 }])).toThrow(/on or off/)
    expect(() => parseProjectLessons([lesson('a', 'x', 1), lesson('a', 'y', 2)])).toThrow(/twice/)
    expect(() => editLesson([], 'missing', { enabled: false })).toThrow(/not found/)
    expect(() => removeLesson([], 'missing')).toThrow(/not found/)
    expect(() => editLesson([lesson('a', 'x', 1)], 'a', { enabled: 'no' })).toThrow(/on or off/)
  })

  it('edits text and the switch, and removes', () => {
    const list = [lesson('a', 'x', 1), lesson('b', 'y', 2)]
    expect(editLesson(list, 'a', { text: ' z ', enabled: false })[0]).toMatchObject({
      text: 'z',
      enabled: false
    })
    expect(removeLesson(list, 'a').map((entry) => entry.id)).toEqual(['b'])
  })

  it('checks every list saved through the config store', () => {
    const store = new ConfigStore(path.join(tempDir(), 'config.json'))
    const project = store.registerProject({ name: 'P', folder: null })
    expect(() => store.updateProject(project.id, { agentLessons: [lesson('a', '', 1)] })).toThrow(
      /Write the lesson/
    )
    const added = store.addProjectLesson(project.id, { text: 'Use tabs.' })
    expect(store.updateProjectLesson(project.id, added.id, { enabled: false }).enabled).toBe(false)
    store.removeProjectLesson(project.id, added.id)
    expect(store.getProjects()[0].agentLessons).toEqual([])
  })
})

describe('resolveProjectConventions with lessons', () => {
  it('gives the conventions alone when there are no lessons, or none on', () => {
    expect(resolveProjectConventions({ agentConventions: 'Use tabs.', agentLessons: [] })).toBe(
      'Use tabs.\n'
    )
    const off = [lesson('a', 'Hidden', day('2026-10-03'), false)]
    expect(resolveProjectConventions({ agentConventions: 'Use tabs.', agentLessons: off })).toBe(
      'Use tabs.\n'
    )
    expect(resolveProjectConventions({ agentConventions: '', agentLessons: off })).toBeNull()
  })

  it('puts the lessons that are on after the conventions, oldest first, each dated', () => {
    const text = resolveProjectConventions({
      agentConventions: '# Rules\n\nUse tabs.',
      agentLessons: [
        lesson('b', 'Tests go beside\nthe file.', day('2026-10-05')),
        lesson('off', 'Never shown', day('2026-10-04'), false),
        lesson('a', 'Use formatDate for dates.', day('2026-10-03'))
      ]
    })!
    expect(text.startsWith('# Rules\n\nUse tabs.\n\n## Lessons from earlier reviews\n')).toBe(true)
    expect(text).toContain('never extra access')
    expect(text).toContain(
      '- 2026-10-03: Use formatDate for dates.\n- 2026-10-05: Tests go beside the file.\n'
    )
    expect(text).not.toContain('Never shown')
    expect(text).not.toContain('left out')
  })

  it('gives lessons alone when there are no conventions', () => {
    const text = resolveProjectConventions({
      agentLessons: [lesson('a', 'Rule', day('2026-10-03'))]
    })!
    expect(text.startsWith(LESSONS_HEADING)).toBe(true)
  })

  it('leaves the oldest lessons out past the cap and says how many', () => {
    const conventions = 'c'.repeat(20_000)
    const lessons = Array.from({ length: 30 }, (_, i) =>
      lesson(`l${i}`, `${String(i).padStart(2, '0')}${'x'.repeat(480)}`, day('2026-01-01') + i)
    )
    const text = resolveProjectConventions({
      agentConventions: conventions,
      agentLessons: lessons
    })!
    expect(text.length).toBeLessThanOrEqual(MAX_RESOLVED_CONVENTIONS_LENGTH)
    expect(text.startsWith(conventions)).toBe(true)
    const match = /(\d+) older lessons were left out/.exec(text)
    expect(match).not.toBeNull()
    const leftOut = Number(match![1])
    expect(leftOut).toBeGreaterThan(0)
    // The newest is kept and the oldest dropped.
    expect(text).toContain(`- ${lessonDate(lessons[29].addedAt)}: 29`)
    expect(text).not.toContain(': 00x')
    expect(text.match(/^- /gm)).toHaveLength(30 - leftOut)
  })
})

describe('Move into conventions', () => {
  it('appends the lesson to the conventions and removes it', () => {
    const result = moveLessonIntoConventions(
      {
        agentConventions: '# Rules\n- Use tabs.\n\n',
        agentLessons: [lesson('a', 'Tests go\nbeside the file.', 1), lesson('b', 'Keep', 2)]
      },
      'a'
    )
    expect(result.agentConventions).toBe('# Rules\n- Use tabs.\n- Tests go beside the file.\n')
    expect(result.agentLessons.map((entry) => entry.id)).toEqual(['b'])
  })

  it('starts the conventions when there are none, and refuses past their limit', () => {
    expect(
      moveLessonIntoConventions({ agentLessons: [lesson('a', 'Rule', 1)] }, 'a').agentConventions
    ).toBe('- Rule\n')
    expect(() =>
      moveLessonIntoConventions(
        { agentConventions: 'c'.repeat(20_000), agentLessons: [lesson('a', 'Rule', 1)] },
        'a'
      )
    ).toThrow(/at most 20000/)
  })
})

describe('lessons go where conventions go', () => {
  it('stay with the project in config and are cleared with it, as the conventions are', () => {
    const store = new ConfigStore(path.join(tempDir(), 'config.json'))
    const project = store.registerProject({ name: 'P', folder: null })
    store.updateProject(project.id, { agentConventions: 'Use tabs.' })
    store.addProjectLesson(project.id, { text: 'Rule' })
    const reopened = new ConfigStore(path.join(tempDir(), 'config.json'))
    const [saved] = reopened.getProjects()
    expect(saved.agentConventions).toBe('Use tabs.')
    expect(saved.agentLessons?.map((entry) => entry.text)).toEqual(['Rule'])
    reopened.removeProject(project.id)
    expect(reopened.getProjects()).toEqual([])
  })
})
