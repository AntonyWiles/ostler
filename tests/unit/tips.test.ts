import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_DISMISSED_TIPS, normalizeTipsSettings } from '../../src/shared/tips'
import {
  labelBeside,
  placeTip,
  separateLabels,
  TIP_GAP,
  TIP_MARGIN
} from '../../src/renderer/tips/placement'
import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: () => {}, shouldUseDarkColors: false },
  systemPreferences: { on: () => {} }
}))

const { assertValidAppearanceUpdate } = await import('../../electron/app/appearance')

const viewport = { width: 1200, height: 800 }
const tip = { width: 320, height: 160 }

describe('tips settings', () => {
  it('are on with nothing dismissed when the file has nothing', () => {
    expect(normalizeTipsSettings(undefined)).toEqual({ enabled: true, dismissed: [] })
    expect(normalizeTipsSettings('junk')).toEqual({ enabled: true, dismissed: [] })
  })

  it('keep a choice to turn them off, and drop repeats and ids that are not tip ids', () => {
    expect(
      normalizeTipsSettings({
        enabled: false,
        dismissed: ['tour:sample', 'tour:sample', 'Not An Id', 7, 'tip:board-drag']
      })
    ).toEqual({ enabled: false, dismissed: ['tour:sample', 'tip:board-drag'] })
  })

  it('keep the dismissed list short', () => {
    const many = Array.from({ length: MAX_DISMISSED_TIPS + 50 }, (_, n) => `tip:${n}`)
    expect(normalizeTipsSettings({ dismissed: many }).dismissed).toHaveLength(MAX_DISMISSED_TIPS)
  })

  it('refuse an update from the window that is not a tips setting', () => {
    expect(() =>
      assertValidAppearanceUpdate({ tips: { enabled: false, dismissed: [] } })
    ).not.toThrow()
    expect(() => assertValidAppearanceUpdate({ tips: { enabled: 'no' } } as never)).toThrow()
    expect(() =>
      assertValidAppearanceUpdate({ tips: { dismissed: ['../etc'] } } as never)
    ).toThrow()
    expect(() => assertValidAppearanceUpdate({ tips: null } as never)).toThrow()
  })
})

describe('config migration 41', () => {
  const dir = useTempDir('ostler-tips-')
  afterEach(() => {})

  it('turns tips on for new installs and old configs, keeping a saved choice', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 41)
    expect(migration?.name).toBe('tips')
    const config: Record<string, unknown> = { ui: { theme: 'dark' } }
    migration?.up(config, { newInstall: false })
    expect(config.ui).toEqual({ theme: 'dark', tips: { enabled: true, dismissed: [] } })

    const fresh = new ConfigStore(path.join(dir(), 'fresh.json'))
    expect(fresh.get().ui.tips).toEqual({ enabled: true, dismissed: [] })
    fs.writeFileSync(path.join(dir(), 'old.json'), JSON.stringify({ configVersion: 40, ui: {} }))
    const old = new ConfigStore(path.join(dir(), 'old.json'))
    expect(old.get().ui.tips).toEqual({ enabled: true, dismissed: [] })
    expect(
      old.update({ ui: { tips: { enabled: false, dismissed: ['tour:sample'] } } }).ui.tips
    ).toEqual({ enabled: false, dismissed: ['tour:sample'] })
  })
})

describe('where a tip goes', () => {
  it('sits on the preferred side, centred on its target, with the arrow at the middle', () => {
    const anchor = { top: 100, left: 400, width: 200, height: 40 }
    const position = placeTip(anchor, tip, 'bottom', viewport)
    expect(position.side).toBe('bottom')
    expect(position.top).toBe(140 + TIP_GAP)
    expect(position.left).toBe(500 - tip.width / 2)
    expect(position.arrow).toBe(tip.width / 2)
  })

  it('flips to the other side when the preferred one has no room', () => {
    const anchor = { top: 700, left: 400, width: 200, height: 40 }
    expect(placeTip(anchor, tip, 'bottom', viewport).side).toBe('top')
    const nearRight = { top: 300, left: 1100, width: 60, height: 30 }
    expect(placeTip(nearRight, tip, 'right', viewport).side).toBe('left')
  })

  it('stays inside the window and keeps pointing at a target near the edge', () => {
    const anchor = { top: 10, left: 0, width: 40, height: 30 }
    const position = placeTip(anchor, tip, 'bottom', viewport)
    expect(position.left).toBe(TIP_MARGIN)
    // The target's middle is 20px in; the arrow stays clear of the corner.
    expect(position.arrow).toBeGreaterThanOrEqual(18)
    expect(position.arrow).toBeLessThan(40)
  })

  it('never goes under the window buttons over a custom title bar', () => {
    const anchor = { top: 44, left: 900, width: 100, height: 32 }
    const position = placeTip(anchor, tip, 'top', { ...viewport, top: 36 })
    expect(position.side).toBe('bottom')
    expect(position.top).toBeGreaterThanOrEqual(36 + TIP_MARGIN)
  })

  it('beside a tall target, sits level with its middle', () => {
    const sidebarButton = { top: 600, left: 0, width: 220, height: 36 }
    const position = placeTip(sidebarButton, tip, 'right', viewport)
    expect(position.side).toBe('right')
    expect(position.left).toBe(220 + TIP_GAP)
    expect(position.top + position.arrow).toBe(618)
  })
})

describe('highlight labels', () => {
  const tipRect = { top: 300, left: 600, width: 320, height: 160 }

  it('sit centred just above what they name', () => {
    const heading = { top: 250, left: 100, width: 200, height: 35 }
    const spot = labelBeside(heading, tipRect, viewport, 90)
    expect(spot.x).toBe(200)
    expect(spot.y).toBeLessThan(250)
  })

  it('go below when above would cover the tip or leave the window', () => {
    const search = { top: 92, left: 8, width: 222, height: 36 }
    const tip = { top: 48, left: 160, width: 320, height: 194 }
    // Above the search box would land on the tip's corner.
    expect(labelBeside(search, tip, viewport, 140).y).toBeGreaterThan(search.top + search.height)
    const top = { top: 4, left: 100, width: 80, height: 30 }
    expect(labelBeside(top, tipRect, viewport, 80).y).toBeGreaterThan(34)
  })

  it('go beside the control when above leaves the window and below covers the tip', () => {
    // A button in the header, its tip just under it.
    const button = { top: 8, left: 900, width: 100, height: 28 }
    const tip = { top: 46, left: 760, width: 320, height: 160 }
    const spot = labelBeside(button, tip, viewport, 80)
    expect(spot.side).toBe('left')
    expect(spot.x + 40).toBeLessThanOrEqual(button.left)
    expect(spot.y).toBe(22)
  })

  it('keep labels from landing on each other', () => {
    const spots = separateLabels(
      [
        { x: 600, y: 300 },
        { x: 620, y: 305 }
      ],
      [100, 100]
    )
    expect(spots[0]).toEqual({ x: 600, y: 300 })
    expect(spots[1].y).toBeGreaterThanOrEqual(300 + 22)
  })
})
