// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArchiveView } from '@renderer/views/planning/ArchiveView'
import { t } from '@shared/i18n'
import { makeWorkItem } from '../../fixtures/planning-records'
import { renderPlanningWorkspace } from '../../fixtures/planning-workspace'

/**
 * One word for one act: Bring back makes something set aside current again
 * (archived, won't do, Someday, turned down, discarded, dismissed); Restore
 * puts back a saved copy (the recycle bin, a backup, a restore point, an
 * earlier version).
 */

describe('Bring back and Restore', () => {
  it('labels every action that un-parks something Bring back', () => {
    const bringBack = [
      'tasks:archiveView.bringBack2',
      'tasks:wontDo.reopen',
      'tasks:someday.bringBack',
      'tasks:ideas.reopen',
      'tasks:goalsMilestonesPanel.restore',
      'agents:reviewer.restore',
      'projects:historyTab.bringBack',
      'settings:peopleSection.restore',
      'settings:projectsSection.restore',
      'library:libraryDetail.unarchive'
    ]
    for (const key of bringBack) expect(t(key), key).toBe('Bring back')
    expect(t('tasks:archiveView.bringBack', { chosenCount: 2 })).toBe('Bring back 2')
    expect(t('tasks:ideas.reopenFor', { title: 'Blockchain' })).toBe('Bring back “Blockchain”')
    expect(t('settings:peopleSection.restore2', { personName: 'Sam' })).toBe('Bring back Sam')
    expect(t('settings:projectsSection.restore2', { projectName: 'Garden' })).toBe(
      'Bring back Garden'
    )
  })

  it('keeps Restore for a saved copy', () => {
    const restore = [
      'tasks:archiveView.restore2',
      'tasks:descriptionHistory.restore',
      'library:libraryEditor.restore',
      'projects:historyTab.restore'
    ]
    for (const key of restore) expect(t(key), key).toBe('Restore')
    expect(t('settings:backupsSection.restore')).toBe('Restore…')
  })

  it('brings back from the Archive, and restores from the recycle bin', async () => {
    const archived = makeWorkItem('a', { title: 'Shipped', status: 'done', archivedAt: 2 })
    const binned = makeWorkItem('b', { title: 'Old idea', deletedAt: Date.now() })
    const ws = await renderPlanningWorkspace({
      api: {
        getPlanningWorkItems: async (_projectId, scope) => ({
          ok: true,
          value: scope === 'archived' ? [archived] : scope === 'deleted' ? [binned] : []
        })
      }
    })

    const archive = render(<ArchiveView ws={ws} mode="archive" />)
    const archiveRow = (await screen.findByText('Shipped')).closest('[role="row"]') as HTMLElement
    // The bin's extra column is keyed to a class, not to its translated label.
    expect(archive.container.querySelector('.archive-view')?.classList).not.toContain(
      'archive-view--bin'
    )
    expect(within(archiveRow).getByRole('button', { name: 'Bring back' })).toBeTruthy()
    fireEvent.click(within(archiveRow).getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Bring back 1' })).toBeTruthy()
    archive.unmount()

    const bin = render(<ArchiveView ws={ws} mode="bin" />)
    const binRow = (await screen.findByText('Old idea')).closest('[role="row"]') as HTMLElement
    expect(bin.container.querySelector('.archive-view')?.classList).toContain('archive-view--bin')
    expect(within(binRow).getByRole('button', { name: 'Restore' })).toBeTruthy()
    fireEvent.click(within(binRow).getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Restore 1' })).toBeTruthy()
  })
})
