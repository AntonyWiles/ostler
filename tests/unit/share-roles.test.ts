import { describe, expect, it } from 'vitest'
import { capabilitiesOf, ROLE_CAPABILITIES, SHARE_ROLES } from '../../src/shared/share-roles'

describe('share roles', () => {
  it('lists the roles most rights first', () => {
    expect(SHARE_ROLES).toEqual(['owner', 'editor', 'contributor', 'viewer'])
  })

  it('gives an Owner every right', () => {
    expect(ROLE_CAPABILITIES.owner).toEqual({
      invite: true,
      changeRoles: true,
      removePeople: true,
      editProjectSettings: true,
      createTasks: true,
      editAnyTask: true,
      editOwnTasks: true,
      deleteTasks: true,
      editLibrary: true,
      comment: true,
      pinComments: true,
      deleteAnyComment: true,
      logOwnTime: true,
      requestSignOff: true,
      answerSignOffs: true
    })
  })

  it('gives an Editor the content and inviting but not roles, removal or deleting others comments', () => {
    expect(ROLE_CAPABILITIES.editor).toEqual({
      invite: true,
      changeRoles: false,
      removePeople: false,
      editProjectSettings: true,
      createTasks: true,
      editAnyTask: true,
      editOwnTasks: true,
      deleteTasks: true,
      editLibrary: true,
      comment: true,
      pinComments: true,
      deleteAnyComment: false,
      logOwnTime: true,
      requestSignOff: true,
      answerSignOffs: true
    })
  })

  it('gives a Contributor their own tasks, comments and their own time', () => {
    const allowed = Object.entries(ROLE_CAPABILITIES.contributor)
      .filter(([, value]) => value)
      .map(([key]) => key)
    expect(allowed).toEqual([
      'editOwnTasks',
      'comment',
      'logOwnTime',
      'requestSignOff',
      'answerSignOffs'
    ])
  })

  it('gives a Viewer comments and answering sign-offs addressed to them', () => {
    const allowed = Object.entries(ROLE_CAPABILITIES.viewer)
      .filter(([, value]) => value)
      .map(([key]) => key)
    expect(allowed).toEqual(['comment', 'answerSignOffs'])
  })

  it('treats a project that is not shared as an Owner', () => {
    expect(capabilitiesOf(null)).toEqual(ROLE_CAPABILITIES.owner)
  })
})
