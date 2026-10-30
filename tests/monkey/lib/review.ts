import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { chromium, type Browser } from 'playwright'
import type { MonkeyOptions } from './options'
import type { ActionRecord, Finding, PhaseRecord } from './recorder'

/**
 * The run made reviewable: `review/` holds, for each phase, a storyboard
 * (`NN-phase.md`, every step with its result and screenshot) and contact
 * sheets (`NN-phase-K.png`, the phase's screenshots as captioned thumbnails,
 * failures outlined in red), plus `findings-K.png` with every finding's
 * screenshot. Reading a phase's sheets shows what a person would have seen
 * through it, without opening hundreds of screenshots one at a time.
 * Built from the run's files, so `npm run monkey -- report <folder>` rebuilds it.
 */

const PER_SHEET = 20
const COLUMNS = 4

interface Tile {
  shot: string
  caption: string
  bad: boolean
}

function readLines<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
  } catch {
    return []
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

function describe(action: ActionRecord): string {
  const value = action.value ? ` = ${action.value.replace(/\s+/g, ' ').slice(0, 50)}` : ''
  return `${action.kind} ${action.target ?? ''}${value}`.trim()
}

function sheetHtml(runDir: string, title: string, tiles: Tile[]): string {
  const cells = tiles
    .map((tile) => {
      const src = pathToFileURL(path.join(runDir, tile.shot)).href
      return `<figure class="${tile.bad ? 'bad' : ''}"><img src="${src}"><figcaption>${escapeHtml(tile.caption)}</figcaption></figure>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; padding: 12px; background: #fff; font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #111; width: ${COLUMNS * 410}px; }
h1 { font-size: 16px; margin: 0 0 8px; }
.grid { display: grid; grid-template-columns: repeat(${COLUMNS}, 400px); gap: 10px; }
figure { margin: 0; border: 3px solid #d0d4dc; border-radius: 4px; background: #f4f5f7; }
figure.bad { border-color: #d92d20; background: #fee4e2; }
img { display: block; width: 100%; height: 250px; object-fit: contain; object-position: top; background: #e4e7ec; }
figcaption { padding: 4px 6px; height: 50px; overflow: hidden; overflow-wrap: anywhere; }
</style></head><body><h1>${escapeHtml(title)}</h1><div class="grid">${cells}</div></body></html>`
}

/**
 * Any Chromium to draw the sheets with: Playwright's own, else Edge (on every
 * Windows) or Chrome, else whichever build sits in Playwright's browser cache.
 * Nothing is downloaded.
 */
async function launchAnyChromium(): Promise<Browser | null> {
  const attempts: (() => Promise<Browser>)[] = [
    () => chromium.launch(),
    () => chromium.launch({ channel: 'msedge' }),
    () => chromium.launch({ channel: 'chrome' })
  ]
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
      : path.join(process.env.HOME ?? '', '.cache', 'ms-playwright'))
  for (const folder of fs.existsSync(cache) ? fs.readdirSync(cache).sort().reverse() : []) {
    if (!/^chromium-\d+$/.test(folder)) continue
    for (const executable of [
      'chrome-win64/chrome.exe',
      'chrome-win/chrome.exe',
      'chrome-linux64/chrome',
      'chrome-linux/chrome'
    ]) {
      const file = path.join(cache, folder, executable)
      if (fs.existsSync(file)) attempts.push(() => chromium.launch({ executablePath: file }))
    }
  }
  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch {
      // Try the next one.
    }
  }
  return null
}

export async function writeReview(options: MonkeyOptions): Promise<string | null> {
  const runDir = options.runDir
  const reviewDir = path.join(runDir, 'review')
  const actions = readLines<ActionRecord>(path.join(runDir, 'actions.jsonl'))
  const findings = readJson<Finding[]>(path.join(runDir, 'findings.json'), [])
  const phases = readJson<PhaseRecord[]>(path.join(runDir, 'phases.json'), [])
  if (!actions.length) return null
  fs.rmSync(reviewDir, { recursive: true, force: true })
  fs.mkdirSync(reviewDir, { recursive: true })

  // Phases in the order they ran; actions before the first phase are "setup".
  const order: string[] = []
  for (const action of actions) if (!order.includes(action.phase)) order.push(action.phase)
  const findingsByShot = new Map<string, Finding[]>()
  for (const finding of findings) {
    if (!finding.screenshot) continue
    findingsByShot.set(finding.screenshot, [
      ...(findingsByShot.get(finding.screenshot) ?? []),
      finding
    ])
  }

  const browser = await launchAnyChromium()
  const page = browser
    ? await browser.newPage({ viewport: { width: COLUMNS * 410 + 24, height: 800 } })
    : null
  const render = async (title: string, tiles: Tile[], file: string) => {
    if (!page) return
    const html = path.join(reviewDir, '.sheet.html')
    fs.writeFileSync(html, sheetHtml(runDir, title, tiles))
    await page.goto(pathToFileURL(html).href)
    await page.waitForLoadState('load')
    await page.screenshot({ path: path.join(reviewDir, file), fullPage: true, type: 'png' })
  }

  const index: string[] = [`# Review of ${options.runId}`, '']
  index.push(
    'Each phase has a storyboard (every step, its result and screenshot) and contact sheets ' +
      '(the screenshots as thumbnails; a red frame is a failed step or a finding). ' +
      'Read the sheets to see the run as a person would have; open a full screenshot from the storyboard.',
    ''
  )
  try {
    for (const [index_, phase] of order.entries()) {
      const prefix = `${String(index_).padStart(2, '0')}-${phase}`
      const steps = actions.filter((action) => action.phase === phase)
      const record = phases.find((entry) => entry.name === phase)
      const phaseFindings = findings.filter((finding) => finding.phase === phase)
      const md: string[] = [
        `# ${record?.title ?? phase} (\`${phase}\`)`,
        '',
        `${record?.status ?? 'n/a'}${record?.reason ? `: ${record.reason}` : ''} · ${steps.length} steps · ${phaseFindings.length} findings`,
        ''
      ]
      if (phaseFindings.length) {
        md.push('## Findings', '')
        for (const finding of phaseFindings) {
          md.push(
            `- **${finding.id}** ${finding.severity} ${finding.kind} — ${finding.title}${finding.screenshot ? ` ([shot](../${finding.screenshot}))` : ''}`
          )
        }
        md.push('')
      }
      md.push(
        '## Steps',
        '',
        '| # | Step | Screen | ms | Result |',
        '| --- | --- | --- | --- | --- |'
      )
      const tiles: Tile[] = []
      const seen = new Set<string>()
      for (const action of steps) {
        const step = describe(action).replace(/\|/g, '\\|')
        md.push(
          `| ${action.seq} | ${action.screenshot ? `[${step}](../${action.screenshot})` : step} | ${(action.route ?? '').replace(/\|/g, '\\|').slice(0, 60)} | ${action.durationMs} | ${action.ok ? 'ok' : `**failed**: ${(action.error ?? '').replace(/\|/g, '\\|').slice(0, 160)}`} |`
        )
        if (action.screenshot && !seen.has(action.screenshot)) {
          seen.add(action.screenshot)
          const found = findingsByShot.get(action.screenshot) ?? []
          tiles.push({
            shot: action.screenshot,
            caption: `#${action.seq} ${describe(action)}${action.ok ? '' : ` — FAILED: ${action.error ?? ''}`}${found.length ? ` — ${found.map((f) => f.id).join(', ')}` : ''}`,
            bad: !action.ok || found.length > 0
          })
        }
      }
      // Finding screenshots taken outside an action (the checks' own).
      for (const finding of phaseFindings) {
        if (!finding.screenshot || seen.has(finding.screenshot)) continue
        seen.add(finding.screenshot)
        tiles.push({
          shot: finding.screenshot,
          caption: `${finding.id} ${finding.severity} — ${finding.title}`,
          bad: true
        })
      }
      tiles.sort((a, b) => a.shot.localeCompare(b.shot))
      const sheets: string[] = []
      for (let start = 0; start < tiles.length; start += PER_SHEET) {
        const file = `${prefix}-${sheets.length + 1}.png`
        await render(
          `${record?.title ?? phase} — ${start + 1} to ${Math.min(tiles.length, start + PER_SHEET)} of ${tiles.length}`,
          tiles.slice(start, start + PER_SHEET),
          file
        )
        sheets.push(file)
      }
      fs.writeFileSync(path.join(reviewDir, `${prefix}.md`), `${md.join('\n')}\n`)
      index.push(
        `- **${record?.title ?? phase}** — ${record?.status ?? 'n/a'}, ${steps.length} steps, ${phaseFindings.length} findings: [storyboard](${prefix}.md)` +
          (page && sheets.length
            ? ` · sheets ${sheets.map((sheet, i) => `[${i + 1}](${sheet})`).join(' ')}`
            : '')
      )
    }

    const shotFindings = findings.filter((finding) => finding.screenshot)
    const findingSheets: string[] = []
    for (let start = 0; start < shotFindings.length; start += PER_SHEET) {
      const file = `findings-${findingSheets.length + 1}.png`
      await render(
        `Findings ${start + 1} to ${Math.min(shotFindings.length, start + PER_SHEET)} of ${shotFindings.length}`,
        shotFindings.slice(start, start + PER_SHEET).map((finding) => ({
          shot: finding.screenshot!,
          caption: `${finding.id} ${finding.severity} ${finding.kind} — ${finding.title}`,
          bad: finding.severity === 'S1' || finding.severity === 'S2'
        })),
        file
      )
      findingSheets.push(file)
    }
    if (page && findingSheets.length) {
      index.push(
        '',
        `Findings with screenshots: ${findingSheets.map((sheet, i) => `[${i + 1}](${sheet})`).join(' ')}`
      )
    }
    if (!page) {
      index.push(
        '',
        '_No contact sheets: no Chromium, Edge or Chrome could be started to draw them._'
      )
    }
  } finally {
    await browser?.close()
    fs.rmSync(path.join(reviewDir, '.sheet.html'), { force: true })
  }
  const file = path.join(reviewDir, 'index.md')
  fs.writeFileSync(file, `${index.join('\n')}\n`)
  return file
}
