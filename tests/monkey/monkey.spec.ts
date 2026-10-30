import { test } from '@playwright/test'
import * as fs from 'fs'
import { AI_PRESETS } from '../../src/shared/ai-presets'
import { startDriveServer } from './lib/drive'
import { FAKE_AI_MODEL, previousFakeAiPort, startFakeAi } from './lib/fake-ai'
import { describeOptions, readOptions } from './lib/options'
import { Recorder } from './lib/recorder'
import { writeReport } from './lib/report'
import { writeReview } from './lib/review'
import { Session } from './lib/session'
import { runExplore } from './journeys/explore'
import { runJourney } from './journeys/dummy-app'
import { runWhiteboard } from './journeys/whiteboard'

/**
 * The monkey: Ostler used end to end through its window, the way a person
 * would, with every action, key and screen recorded. Not a test with
 * assertions: a run that produces a report of what was found. Start it with
 * `npm run monkey` (scripts/monkey.cjs), which documents the options.
 */
test('monkey', async () => {
  test.setTimeout(0)
  const options = readOptions()
  fs.mkdirSync(options.runDir, { recursive: true })
  const recorder = new Recorder(options)
  if (options.mode === 'report') {
    console.log(`\nMonkey report: ${writeReport(options, recorder)}\n`)
    const review = await writeReview(options).catch((error) => `not written: ${String(error)}`)
    console.log(`Review (storyboards and contact sheets): ${review}\n`)
    return
  }
  console.log(`\nMonkey ${options.mode}: run folder ${options.runDir}\n`)
  recorder.journal(
    `\n# Monkey ${options.mode} — ${new Date().toISOString()}\n\n` +
      `Run folder \`${options.runDir}\`${options.fresh ? ' (new data folder: the app opens on its welcome)' : ' (continuing an earlier run)'}.\n\n` +
      '```json\n' +
      JSON.stringify(describeOptions(options), null, 2) +
      '\n```'
  )

  const fakeAi =
    options.ai === 'fake'
      ? await startFakeAi(options.runDir, previousFakeAiPort(options.runDir))
      : null
  const session = new Session(options, recorder)
  // A journey sets AI up through the screen. Exploring and driving start
  // with it ready: the stand-in AI is a keyless provider on this computer,
  // and live AI takes the key from the environment without saving it.
  const preconfigured = options.mode !== 'journey' && options.ai !== 'off'
  const livePreset = AI_PRESETS.find((preset) => preset.id === options.aiPreset)
  const ai =
    preconfigured && fakeAi
      ? { provider: 'custom', baseUrl: fakeAi.url, model: FAKE_AI_MODEL }
      : preconfigured && options.ai === 'live' && livePreset && options.aiModel
        ? {
            provider: livePreset.provider,
            baseUrl: livePreset.defaultBaseUrl,
            model: options.aiModel
          }
        : undefined
  const environment: Record<string, string> =
    preconfigured && options.ai === 'live' && options.aiKey
      ? { OSTLER_AI_API_KEY: options.aiKey }
      : {}
  recorder.secret(options.aiKey)

  let reportPath = ''
  try {
    await session.start({ environment }, { ai })
    if (options.mode === 'journey') await runJourney(session, { fakeAi })
    if (options.mode === 'explore') await runExplore(session)
    if (options.mode === 'whiteboard') await runWhiteboard(session, fakeAi)
    if (options.mode === 'drive' || options.keepOpen) {
      const drive = await startDriveServer(session, fakeAi)
      console.log(
        `\nDrive mode: ${drive.url}  (curl -s ${drive.url}/ for the commands; POST /quit to finish)\n`
      )
      await drive.done
      await drive.close()
    }
  } catch (error) {
    recorder.finding({
      kind: 'broken',
      severity: 'S2',
      title: `The monkey stopped: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      details: error instanceof Error ? (error.stack ?? error.message) : String(error),
      where: await session.screen().catch(() => 'unknown')
    })
    throw error
  } finally {
    reportPath = writeReport(options, recorder, { fakeAi: fakeAi?.counts() })
    await session.stop()
    await fakeAi?.close()
    const review = await writeReview(options).catch((error) => `not written: ${String(error)}`)
    console.log(`
Review (storyboards and contact sheets): ${review}`)
    console.log(`\nMonkey report: ${reportPath}\nFindings: ${recorder.allFindings().length}\n`)
  }
})
