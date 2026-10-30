import { StepError, type Session, type Target } from '../lib/session'

/**
 * Exploration: a seeded random walk through the app. Each step looks at the
 * controls a person could reach right now (only the top dialog's, when one is
 * open), prefers ones nobody has pressed on this screen yet, and uses one:
 * clicks a button, types into a field, picks an option, or presses a
 * keyboard shortcut. The same seed replays the same walk on the same data.
 *
 * It avoids only what would end the run or wipe what it is exploring
 * (quitting, restoring a backup, removing the project, the emergency stop);
 * everything else is fair game, including Delete.
 */

const AVOID =
  /\b(quit|exit ostler|restore|restart (now|ostler|to update)|remove (this )?project|delete (this )?project|delete everything|delete all|uninstall|stop all ai|emergency|start an isolated agent workspace|open (a )?terminal|report a problem|check for updates|download)\b/i

/** Typing a person might do, and some a person would not. */
const WORDS = [
  'Draft the release notes',
  'Fix the countdown flicker',
  'Ask Sam about icons',
  'Pomodoro',
  'review',
  'tomorrow',
  'next week',
  '#ui !high tomorrow',
  '@me friday',
  '12',
  '0',
  '-5',
  '3.5'
]
const ODD_TEXT = [
  '',
  ' ',
  'a'.repeat(300),
  'Ünïcödé ✓ 日本語 🍅',
  'שלום עולם',
  '<script>alert(1)</script>',
  '"quotes" and \'apostrophes\'',
  '../../etc/passwd',
  'Line one\nLine two',
  '9999-99-99',
  'NaN',
  '%s %d {0}'
]

const SHORTCUTS = [
  'Control+K',
  'Control+N',
  'Control+Shift+N',
  'Control+B',
  '?',
  '/',
  'Escape',
  'Escape',
  'g',
  'h',
  'i',
  'j',
  'k',
  'x',
  'e',
  't',
  'Enter',
  'Control+Z',
  'Control+1',
  'Control+2',
  'Control+3',
  'Control+4',
  'Alt+ArrowRight',
  'Alt+ArrowDown',
  'Control+=',
  'Control+-',
  'Control+0',
  'Tab',
  'Shift+Tab',
  'ArrowDown',
  'Delete'
]

interface Control {
  id: number
  role: string
  name: string
  disabled: boolean
}

export async function runExplore(session: Session): Promise<void> {
  const { options, recorder, random, hand } = session
  const phase = recorder.phaseStart('explore', `Exploration (seed ${options.seed})`)
  const deadline = Date.now() + options.minutes * 60_000
  let sameScreen = 0
  let lastScreen = ''
  let failures = 0
  try {
    for (let step = 0; step < options.steps && Date.now() < deadline; step += 1) {
      const screen = await session.screen()
      sameScreen = screen === lastScreen ? sameScreen + 1 : 0
      lastScreen = screen
      if (sameScreen > 14) {
        // Stuck: back out the way a person would.
        await hand.press('Escape', { times: 2 }).catch(() => {})
        await hand.click(session.ui.link(/^Home/, false)).catch(() => {})
        sameScreen = 0
        continue
      }

      if (random.chance(0.12)) {
        await hand.press(random.pick(SHORTCUTS)).catch(() => {})
        continue
      }

      const controls = await session.page
        .evaluate(() => {
          const w = window as unknown as { __monkeyInventory?: (tag: boolean) => Control[] }
          return w.__monkeyInventory?.(true) ?? []
        })
        .catch(() => [] as Control[])
      const coverage = recorder.coverage()[screen]?.controls ?? {}
      const usable = controls.filter((control) => !control.disabled && !AVOID.test(control.name))
      if (usable.length === 0) {
        await hand.press('Escape').catch(() => {})
        continue
      }
      // Unpressed controls are three times as likely to be picked.
      const weighted = usable.flatMap((control) =>
        (coverage[`${control.role} "${control.name}"`]?.pressed ?? 0) === 0
          ? [control, control, control]
          : [control]
      )
      const control = random.pick(weighted)
      const target: Target = {
        locator: session.page.locator(`[data-monkey-id="${control.id}"]`),
        description: `${control.role} "${control.name}"`,
        control: `${control.role} "${control.name}"`
      }
      try {
        if (control.role === 'textbox' || control.role === 'searchbox') {
          const text = random.chance(0.25) ? random.pick(ODD_TEXT) : random.pick(WORDS)
          await hand.fill(target, text)
          if (random.chance(0.4)) await hand.press(random.chance(0.5) ? 'Enter' : 'Tab')
        } else if (control.role === 'combobox') {
          const options = await target.locator
            .evaluate((element) =>
              element instanceof HTMLSelectElement
                ? Array.from(element.options)
                    .filter((option) => !option.disabled)
                    .map((option) => option.value)
                : null
            )
            .catch(() => null)
          if (options && options.length) await hand.select(target, random.pick(options))
          else {
            await hand.fill(target, random.pick(WORDS))
            await hand.press(random.chance(0.5) ? 'ArrowDown' : 'Enter')
          }
        } else if (control.role === 'slider') {
          await hand.click(target)
          await hand.press(random.pick(['ArrowRight', 'ArrowLeft', 'End', 'Home']))
        } else {
          await hand.click(target, {
            deadClickCheck:
              control.role === 'button' || control.role === 'tab' || control.role === 'menuitem',
            button: random.chance(0.05) ? 'right' : 'left',
            timeout: 4000
          })
        }
        failures = 0
      } catch (error) {
        // A control that moved or vanished between looking and clicking is
        // normal in a live app; many in a row is not.
        failures += 1
        if (failures > 10) {
          recorder.finding({
            kind: 'broken',
            severity: 'S3',
            title: 'Ten actions in a row failed during exploration',
            details: error instanceof StepError ? error.message : String(error),
            where: screen
          })
          await hand.press('Escape', { times: 2 }).catch(() => {})
          failures = 0
        }
      }
      // Halfway through, restart once: what the walk did must survive.
      if (step === Math.floor(options.steps / 2))
        await session.restart('halfway through the exploration')
    }
    recorder.phaseEnd(phase, 'passed')
  } catch (error) {
    recorder.phaseEnd(phase, 'failed', error instanceof Error ? error.message : String(error))
    throw error
  }
}
