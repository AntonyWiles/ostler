import { describe, expect, it } from 'vitest'
import { projectAndSubprojectName } from '@shared/subproject-label'

describe('projectAndSubprojectName', () => {
  it('is the project alone for a task in no workstream', () => {
    expect(projectAndSubprojectName('Launch', null)).toBe('Launch')
    expect(projectAndSubprojectName('Launch', undefined)).toBe('Launch')
    expect(projectAndSubprojectName('Launch', '')).toBe('Launch')
  })

  it('joins the project and the workstream with a ›', () => {
    expect(projectAndSubprojectName('Launch', 'Website')).toBe('Launch › Website')
  })
})
