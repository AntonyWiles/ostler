/*
 * Builds the privacy policy web page that Google Play links to,
 * https://antonywiles.github.io/ostler/privacy/, from docs/mobile/privacy-policy.md, so the page
 * and the policy in the repository cannot drift. `npm run privacy:page` writes the site to
 * out/privacy-page/; docs/mobile/releasing.md says how to publish it on the gh-pages branch.
 */
const fs = require('node:fs')
const path = require('node:path')
const { marked } = require('marked')

const { projectRoot } = require('./lib/root.cjs')
const POLICY = path.join(projectRoot, 'docs', 'mobile', 'privacy-policy.md')
const SITE = path.join(projectRoot, 'out', 'privacy-page')
const REPO_URL = 'https://github.com/AntonyWiles/ostler'

const STYLE = `
  :root { color-scheme: light dark; --text: #1f2328; --muted: #59636e; --line: #d1d9e0; --accent: #4f46e5; --bg: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --text: #e6edf3; --muted: #9198a1; --line: #3d444d; --accent: #60a5fa; --bg: #0d1117; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; line-height: 1.25; margin: 0 0 16px; }
  h2 { font-size: 20px; margin: 32px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
  a { color: var(--accent); }
  code { font-size: 14px; }
  .table { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; }
  th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  footer { margin-top: 48px; color: var(--muted); font-size: 14px; }
`

/** The policy as a complete HTML page. */
function policyPage(markdown) {
  const title = markdown.match(/^# (.+)$/m)?.[1] ?? 'Ostler privacy policy'
  const body = marked
    .parse(markdown, { gfm: true })
    .replace(/<table>/g, '<div class="table"><table>')
    .replace(/<\/table>/g, '</table></div>')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<footer>The source of this page is <a href="${REPO_URL}/blob/master/docs/mobile/privacy-policy.md">docs/mobile/privacy-policy.md</a> in the Ostler repository.</footer>
</main>
</body>
</html>
`
}

/** The site's front page sends visitors on to the repository. */
function indexPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ostler</title>
<meta http-equiv="refresh" content="0; url=${REPO_URL}">
</head>
<body><p><a href="${REPO_URL}">Ostler on GitHub</a> · <a href="privacy/">Privacy policy</a></p></body>
</html>
`
}

function build(site = SITE) {
  fs.rmSync(site, { recursive: true, force: true })
  fs.mkdirSync(path.join(site, 'privacy'), { recursive: true })
  // Served as plain files: GitHub Pages must not run Jekyll over them.
  fs.writeFileSync(path.join(site, '.nojekyll'), '')
  fs.writeFileSync(path.join(site, 'index.html'), indexPage())
  fs.writeFileSync(
    path.join(site, 'privacy', 'index.html'),
    policyPage(fs.readFileSync(POLICY, 'utf8'))
  )
  return site
}

if (require.main === module) {
  process.stdout.write(`Privacy page written to ${path.relative(projectRoot, build())}\n`)
}

module.exports = { build, policyPage }
