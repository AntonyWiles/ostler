import { describe, expect, it } from 'vitest'
import { viewContext, type Features } from '@renderer/navigation/features'

describe('viewContext and the Plan tab', () => {
  const features: Features = { agents: false, ai: false, loaded: true }

  it('says a project in Planning is planning', () => {
    expect(viewContext(features, { id: 'p1', path: null, stage: 'planning' }).planning).toBe(true)
  })

  it('says a project in any other stage is not', () => {
    expect(viewContext(features, { id: 'p1', path: null, stage: 'active' }).planning).toBe(false)
  })

  it('leaves planning out without a project', () => {
    expect('planning' in viewContext(features, null)).toBe(false)
  })
})
