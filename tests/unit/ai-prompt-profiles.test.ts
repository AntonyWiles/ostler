import { describe, expect, it } from 'vitest'
import {
  buildGoalBreakdownUserPrompt,
  buildNextTasksUserPrompt,
  buildProjectChatAddendum,
  buildWorkItemImprovementUserPrompt
} from '../../src/shared/ostler-ai-prompts'
import { projectAiProfile } from '../../src/shared/ai-profile'

const evidence = { goal: { title: 'Plan the village fete', outcome: 'A fete on 1 June' } }

/** Each planning prompt that writes tasks, for one profile. */
function prompts(profile: 'software' | 'general') {
  return {
    goalBreakdown: buildGoalBreakdownUserPrompt(evidence, profile),
    nextTasks: buildNextTasksUserPrompt('Village fete', evidence, profile),
    workItemImprovement: buildWorkItemImprovementUserPrompt('Village fete', evidence, profile)
  }
}

/** Wording that belongs to software projects and coding agents. */
const SOFTWARE_WORDING =
  /coding agent|\bagent\b|repositor|repo-relative|file path|inspect files|harness|commit|workspace|queue/i

describe('planning prompts for each kind of project', () => {
  it('match their snapshots', () => {
    expect(prompts('software')).toMatchSnapshot('software')
    expect(prompts('general')).toMatchSnapshot('general')
  })

  it('keep the software prompts as they were', () => {
    expect(buildGoalBreakdownUserPrompt(evidence, 'software')).toBe(
      buildGoalBreakdownUserPrompt(evidence)
    )
    expect(prompts('software').goalBreakdown).toContain('The coding agent who carries out a task')
  })

  it('write tasks for a person, with no coding-agent or repository wording, for general projects', () => {
    for (const [name, prompt] of Object.entries(prompts('general'))) {
      expect(prompt, name).not.toMatch(SOFTWARE_WORDING)
      expect(prompt, name).toContain(
        'The person doing this task sees the task text and its attachments'
      )
      expect(prompt, name).toContain('starts with the outcome')
      expect(prompt, name).toContain('checklist')
    }
  })

  it('give the notes chat the library rule for its profile', () => {
    const chat = (profile: 'software' | 'general') =>
      buildProjectChatAddendum({
        projectName: 'Village fete',
        planning: { goals: [], milestones: [], workItems: [] },
        library: '- id 1: Map of the field',
        profile
      })
    expect(chat('general')).toContain('The person doing this task sees the task text')
    expect(chat('software')).toContain('The coding agent who carries out a task')
  })
})

describe('projectAiProfile', () => {
  const folder = { path: 'C:/work/site' }
  it('is software for a linked Git repository and general otherwise', () => {
    expect(projectAiProfile(folder, { isGitRepo: true })).toBe('software')
    expect(projectAiProfile(folder, { isGitRepo: false })).toBe('general')
    expect(projectAiProfile({ path: null }, { isGitRepo: true })).toBe('general')
    expect(projectAiProfile(folder, null)).toBe('general')
  })

  it('follows the project setting when it is not Auto', () => {
    expect(projectAiProfile({ path: null, aiProfile: 'software' }, null)).toBe('software')
    expect(projectAiProfile({ ...folder, aiProfile: 'general' }, { isGitRepo: true })).toBe(
      'general'
    )
    expect(projectAiProfile({ ...folder, aiProfile: 'auto' }, { isGitRepo: true })).toBe('software')
  })
})
