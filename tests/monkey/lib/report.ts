import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { describeOptions, type MonkeyOptions } from './options'
import type { ActionRecord, Finding, Recorder } from './recorder'
import { REPO_ROOT } from './app'

/**
 * The run's report, written at the end (and on demand in drive mode):
 * `report.md` for agents and diffs, `report.html` for people, with the
 * screenshots inline. Both are built from the files the recorder wrote, so a
 * report can be regenerated for a run that crashed (`npm run monkey -- report <run folder>`).
 */

const SEVERITY_ORDER = ['S1', 'S2', 'S3', 'S4'] as const

function ostlerVersion(): { commit: string; dirty: boolean; built: string } {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', ['-C', REPO_ROOT, ...args], {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim()
    } catch {
      return ''
    }
  }
  let built = 'unknown'
  try {
    built = fs.statSync(path.join(REPO_ROOT, 'out/main/main.js')).mtime.toISOString()
  } catch {
    // No build.
  }
  return {
    commit: git('rev-parse', '--short', 'HEAD') || 'unknown',
    dirty: git('status', '--porcelain') !== '',
    built
  }
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id)
  )
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

function readActions(file: string): ActionRecord[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ActionRecord)
  } catch {
    return []
  }
}

/**
 * The places a person can go that the run never went: tabs and links seen on
 * some screen (the sidebar, project tabs, settings sections, menu items) and
 * pressed on none. Read from what the app showed, so a new view shows up here
 * without anyone listing it.
 */
function placesNeverOpened(
  coverage: Record<string, { controls: Record<string, { seen: number; pressed: number }> }>
): { control: string; screens: number }[] {
  const seen = new Map<string, { pressed: number; screens: number }>()
  for (const entry of Object.values(coverage)) {
    for (const [control, record] of Object.entries(entry.controls)) {
      if (!/^(tab|link|menuitem) "/.test(control)) continue
      const total = seen.get(control) ?? { pressed: 0, screens: 0 }
      total.pressed += record.pressed
      total.screens += 1
      seen.set(control, total)
    }
  }
  const screenNames = Object.keys(coverage).join('\n')
  return [...seen.entries()]
    .filter(([control, total]) => {
      if (total.pressed > 0) return false
      // Reached some other way (a shortcut, the palette): its screen was seen.
      const name = /"(.+)"/.exec(control)?.[1] ?? ''
      return !name || !screenNames.includes(name.replace(/\s+\d+$/, ''))
    })
    .map(([control, total]) => ({ control, screens: total.screens }))
    .sort((a, b) => a.control.localeCompare(b.control))
}

function countLines(file: string): number {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

export function writeReport(
  options: MonkeyOptions,
  recorder: Recorder,
  extra: { fakeAi?: Record<string, number> } = {}
): string {
  recorder.flush()
  const dir = options.runDir
  const findings = sortFindings(recorder.allFindings())
  const coverage = recorder.coverage()
  const version = ostlerVersion()
  const actions = countLines(path.join(dir, 'actions.jsonl'))
  const shots = fs.existsSync(path.join(dir, 'shots'))
    ? fs.readdirSync(path.join(dir, 'shots')).length
    : 0
  const minutes = Math.round(recorder.elapsed() / 60000)

  const bySeverity = Object.fromEntries(
    SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])
  )
  const kinds = [...new Set(findings.map((f) => f.kind))].sort()

  const screens = Object.entries(coverage).sort((a, b) => a[0].localeCompare(b[0]))
  const neverPressed = screens
    .map(([screen, entry]) => ({
      screen,
      controls: Object.entries(entry.controls)
        .filter(([, record]) => record.pressed === 0)
        .map(([control]) => control)
    }))
    .filter((entry) => entry.controls.length > 0)
  const totalControls = screens.reduce(
    (sum, [, entry]) => sum + Object.keys(entry.controls).length,
    0
  )
  const pressedControls = screens.reduce(
    (sum, [, entry]) =>
      sum + Object.values(entry.controls).filter((record) => record.pressed > 0).length,
    0
  )

  const md: string[] = []
  md.push(`# Monkey run ${options.runId}`)
  md.push('')
  md.push(
    `Ostler \`${version.commit}\`${version.dirty ? ' (with uncommitted changes)' : ''}, built ${version.built}. ` +
      `Mode **${options.mode}**, AI **${options.ai}**, agents **${options.agents}**, seed ${options.seed}, speed ${options.speed}. ` +
      `${actions} actions, ${shots} screenshots, about ${minutes} min.`
  )
  md.push('')
  md.push(
    'Files: **[review: storyboards and contact sheets per phase](review/index.md)** · [journal](journal.md) · [actions](actions.jsonl) · [keys](keys.log) · [console](console.log) · [findings](findings.json) · [coverage](coverage.json) · [screenshots](shots/)'
  )
  md.push('')
  const allActions = readActions(path.join(dir, 'actions.jsonl'))
  const failedActions = allActions.filter((action) => !action.ok)
  const slowest = allActions
    .filter((action) => ['click', 'type', 'press', 'select', 'check', 'drag'].includes(action.kind))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10)
  if (recorder.phases.length) {
    md.push('## Phases')
    md.push('')
    md.push('| Phase | Result | Time | Why |')
    md.push('| --- | --- | --- | --- |')
    for (const phase of recorder.phases) {
      md.push(
        `| ${phase.title} (\`${phase.name}\`) | ${phase.status} | ${Math.round((phase.durationMs ?? 0) / 1000)} s | ${(phase.reason ?? '').replace(/\|/g, '\\|').slice(0, 200)} |`
      )
    }
    md.push('')
  }
  md.push('## Findings')
  md.push('')
  md.push(
    `${findings.length} in all: ${SEVERITY_ORDER.map((s) => `${bySeverity[s]} ${s}`).join(', ')}. ` +
      `S1 loses work or capacity, S2 says something untrue, S3 wastes time, S4 is friction.`
  )
  md.push('')
  if (kinds.length) {
    md.push('| Kind | ' + SEVERITY_ORDER.join(' | ') + ' |')
    md.push('| --- | ' + SEVERITY_ORDER.map(() => '---').join(' | ') + ' |')
    for (const kind of kinds) {
      md.push(
        `| ${kind} | ${SEVERITY_ORDER.map((s) => findings.filter((f) => f.kind === kind && f.severity === s).length || '').join(' | ')} |`
      )
    }
    md.push('')
  }
  for (const finding of findings) {
    md.push(`### ${finding.id} · ${finding.severity} · ${finding.kind} — ${finding.title}`)
    md.push('')
    md.push(
      `Where: \`${finding.where || 'n/a'}\` · phase \`${finding.phase}\` · step ${finding.step} · seen ${finding.count}× · from ${finding.source}` +
        (finding.screenshot ? ` · [screenshot](${finding.screenshot})` : '')
    )
    if (finding.details) {
      md.push('')
      md.push('```text')
      md.push(finding.details.slice(0, 1500))
      md.push('```')
    }
    md.push('')
  }
  md.push('## Failed steps')
  md.push('')
  if (failedActions.length === 0) md.push('None.')
  for (const action of failedActions) {
    md.push(
      `- #${action.seq} \`${action.phase}\` ${action.kind} ${action.target ?? action.value ?? ''}: ${(action.error ?? '').slice(0, 200)}${action.screenshot ? ` ([shot](${action.screenshot}))` : ''}`
    )
  }
  md.push('')
  md.push('## Slowest steps')
  md.push('')
  for (const action of slowest) {
    md.push(
      `- ${(action.durationMs / 1000).toFixed(1)} s — \`${action.phase}\` ${action.kind} ${action.target ?? ''}${action.screenshot ? ` ([shot](${action.screenshot}))` : ''}`
    )
  }
  md.push('')
  const unopened = placesNeverOpened(coverage)
  md.push('## Places never opened')
  md.push('')
  md.push(
    `${unopened.length} tabs, links and menu items were on screen but never pressed, and no screen of that name was seen. ` +
      'Each is a part of Ostler this run did not test.'
  )
  md.push('')
  if (unopened.length) md.push(unopened.map((entry) => entry.control).join(' · '))
  md.push('')
  md.push('## Coverage')
  md.push('')
  md.push(
    `${screens.length} screens seen; ${pressedControls} of ${totalControls} distinct controls pressed. ` +
      'A control nobody pressed is a control nobody tested.'
  )
  md.push('')
  for (const entry of neverPressed.slice(0, 80)) {
    md.push(
      `- \`${entry.screen}\`: ${entry.controls.slice(0, 25).join(', ')}${entry.controls.length > 25 ? `, … ${entry.controls.length - 25} more` : ''}`
    )
  }
  md.push('')
  if (extra.fakeAi && Object.keys(extra.fakeAi).length) {
    md.push('## Stand-in AI requests')
    md.push('')
    md.push(
      Object.entries(extra.fakeAi)
        .map(([feature, count]) => `${feature}: ${count}`)
        .join(' · ')
    )
    md.push('')
  }
  md.push('## Options')
  md.push('')
  md.push('```json')
  md.push(JSON.stringify(describeOptions(options), null, 2))
  md.push('```')
  const markdown = recorder.redact(md.join('\n'))
  fs.writeFileSync(path.join(dir, 'report.md'), `${markdown}\n`)

  fs.writeFileSync(
    path.join(dir, 'report.html'),
    recorder.redact(
      html(options, findings, recorder, {
        version,
        actions,
        shots,
        minutes,
        screens: screens.length,
        pressedControls,
        totalControls
      })
    )
  )
  return path.join(dir, 'report.md')
}

function html(
  options: MonkeyOptions,
  findings: Finding[],
  recorder: Recorder,
  stats: {
    version: { commit: string; dirty: boolean; built: string }
    actions: number
    shots: number
    minutes: number
    screens: number
    pressedControls: number
    totalControls: number
  }
): string {
  const shotNames = fs.existsSync(path.join(options.runDir, 'shots'))
    ? fs.readdirSync(path.join(options.runDir, 'shots')).sort()
    : []
  // A filmstrip: at most 120 screenshots, evenly spread over the run.
  const step = Math.max(1, Math.ceil(shotNames.length / 120))
  const strip = shotNames.filter((_, index) => index % step === 0)
  const phaseRows = recorder.phases
    .map(
      (phase) =>
        `<tr><td>${escapeHtml(phase.title)}</td><td class="status ${phase.status}">${phase.status}</td><td>${Math.round((phase.durationMs ?? 0) / 1000)} s</td><td>${escapeHtml(phase.reason ?? '')}</td></tr>`
    )
    .join('')
  const findingCards = findings
    .map(
      (finding) => `<article class="finding sev-${finding.severity}">
  <header><span class="badge">${finding.severity}</span><span class="kind">${escapeHtml(finding.kind)}</span><h3>${finding.id} — ${escapeHtml(finding.title)}</h3></header>
  <p class="meta">${escapeHtml(finding.where || 'n/a')} · phase ${escapeHtml(finding.phase)} · step ${finding.step} · ${finding.count}× · ${finding.source}</p>
  ${finding.details ? `<pre>${escapeHtml(finding.details.slice(0, 1500))}</pre>` : ''}
  ${finding.screenshot ? `<a href="${finding.screenshot}"><img loading="lazy" src="${finding.screenshot}" alt="Screenshot for ${finding.id}"></a>` : ''}
</article>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monkey run ${escapeHtml(options.runId)}</title>
<style>
:root { --bg:#fbfbfc; --fg:#1d1f24; --muted:#5d6370; --card:#fff; --line:#e3e5ea; --s1:#b42318; --s2:#c4320a; --s3:#a15c07; --s4:#4b5563; --ok:#067647; --bad:#b42318; }
@media (prefers-color-scheme: dark) { :root { --bg:#141518; --fg:#e8e9ec; --muted:#a2a7b3; --card:#1c1e22; --line:#2c2f36; --s1:#f97066; --s2:#fb8c5a; --s3:#fdb022; --s4:#a2a7b3; --ok:#47cd89; --bad:#f97066; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 20px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 24px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.stat b { display: block; font-size: 20px; }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.status.passed { color: var(--ok); } .status.failed { color: var(--bad); }
.finding { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--s4); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
.finding.sev-S1 { border-left-color: var(--s1); } .finding.sev-S2 { border-left-color: var(--s2); } .finding.sev-S3 { border-left-color: var(--s3); }
.finding header { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.finding h3 { font-size: 15px; margin: 0; flex: 1 1 300px; }
.badge { font-weight: 700; } .kind { color: var(--muted); }
.meta { color: var(--muted); margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; font-size: 12px; max-height: 240px; overflow: auto; }
.finding img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin-top: 6px; }
.strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.strip a { display: block; color: var(--muted); font-size: 11px; text-decoration: none; overflow-wrap: anywhere; }
.strip img { width: 100%; border: 1px solid var(--line); border-radius: 4px; }
</style>
</head>
<body>
<main>
<h1>Monkey run ${escapeHtml(options.runId)}</h1>
<p class="sub">Ostler ${escapeHtml(stats.version.commit)}${stats.version.dirty ? ' (uncommitted changes)' : ''} · mode ${options.mode} · AI ${options.ai} · agents ${options.agents} · seed ${options.seed}</p>
<div class="stats">
<div class="stat"><b>${findings.length}</b>findings</div>
<div class="stat"><b>${findings.filter((f) => f.severity === 'S1' || f.severity === 'S2').length}</b>S1 + S2</div>
<div class="stat"><b>${stats.actions}</b>actions</div>
<div class="stat"><b>${stats.shots}</b>screenshots</div>
<div class="stat"><b>${stats.screens}</b>screens</div>
<div class="stat"><b>${stats.pressedControls}/${stats.totalControls}</b>controls pressed</div>
<div class="stat"><b>${stats.minutes} min</b>run time</div>
</div>
${phaseRows ? `<h2>Phases</h2><table><thead><tr><th>Phase</th><th>Result</th><th>Time</th><th>Why</th></tr></thead><tbody>${phaseRows}</tbody></table>` : ''}
<h2>Findings</h2>
${findingCards || '<p>None.</p>'}
<h2>Filmstrip</h2>
<div class="strip">${strip.map((name) => `<a href="shots/${name}"><img loading="lazy" src="shots/${name}" alt="${escapeHtml(name)}">${escapeHtml(name)}</a>`).join('')}</div>
</main>
</body>
</html>
`
}
