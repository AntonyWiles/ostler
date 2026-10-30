import { describe, expect, it } from 'vitest'
import { commentPermissions } from '../../src/shared/comment-permissions'

const mine = { authorKind: 'human', authorPersonId: 'me' } as const
const theirs = { authorKind: 'human', authorPersonId: 'them' } as const
const automation = { authorKind: 'automation', authorPersonId: null } as const

describe('commentPermissions', () => {
  it('lets a lone person do everything with their own comments, and delete the rest', () => {
    expect(commentPermissions(null, mine, 'me')).toEqual({
      quote: true,
      pin: true,
      edit: true,
      delete: true
    })
    expect(commentPermissions(null, automation, 'me')).toMatchObject({ edit: false, delete: true })
  })

  it('lets an Editor edit and delete only their own comments, but pin any', () => {
    expect(commentPermissions('editor', mine, 'me')).toMatchObject({ edit: true, delete: true })
    expect(commentPermissions('editor', theirs, 'me')).toEqual({
      quote: true,
      pin: true,
      edit: false,
      delete: false
    })
  })

  it('lets an Owner delete anyone’s comment but edit only their own', () => {
    expect(commentPermissions('owner', theirs, 'me')).toMatchObject({ edit: false, delete: true })
    expect(commentPermissions('owner', mine, 'me')).toMatchObject({ edit: true, delete: true })
  })

  it('lets a Viewer quote, and edit and delete only their own comments, never pin', () => {
    expect(commentPermissions('viewer', mine, 'me')).toEqual({
      quote: true,
      pin: false,
      edit: true,
      delete: true
    })
    expect(commentPermissions('viewer', theirs, 'me')).toEqual({
      quote: true,
      pin: false,
      edit: false,
      delete: false
    })
  })

  it('treats nobody as the author of a comment when this PC has no person', () => {
    const anonymous = { authorKind: 'human', authorPersonId: null } as const
    expect(commentPermissions('editor', anonymous, null)).toMatchObject({ edit: false })
  })
})
