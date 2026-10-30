/*
 * Fails when package.json's `build.productName`, `build.appId`, the deep-link
 * scheme the installer registers (`build.protocols`), the publisher (`author`)
 * or the GitHub release feed (`build.publish`), or the data folder the
 * uninstaller may remove (`build/installer.nsh`), differ from
 * src/shared/brand.ts, the single source of product identity. package.json
 * and NSIS cannot import TypeScript, so `npm run lint` runs this instead.
 */
const fs = require('node:fs')
const path = require('node:path')

/** Reads one `key: 'value'` string from brand.ts's literal BRAND object. */
function brandValue(brandSource, key) {
  const match = new RegExp(`\\b${key}:\\s*'([^']*)'`).exec(brandSource)
  if (!match) throw new Error(`brand.ts has no ${key}`)
  return match[1]
}

/** `owner/repo` from a GitHub URL. */
function githubRepository(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/.exec(url)
  return match ? `${match[1]}/${match[2]}` : null
}

/**
 * Returns one message per mismatch; empty when package.json (and, when given,
 * build/installer.nsh) agree with brand.ts.
 */
function checkBrand(packageJson, brandSource, installerNsh = null) {
  const build = packageJson.build || {}
  const author =
    typeof packageJson.author === 'object' ? packageJson.author?.name : packageJson.author
  const feed = (build.publish || []).find((entry) => entry.provider === 'github')
  const expected = [
    ['author', author, brandValue(brandSource, 'publisher')],
    [
      'build.publish (github owner/repo)',
      feed ? `${feed.owner}/${feed.repo}` : undefined,
      githubRepository(brandValue(brandSource, 'repositoryUrl'))
    ],
    ['build.productName', build.productName, brandValue(brandSource, 'fullName')],
    ['build.appId', build.appId, brandValue(brandSource, 'appUserModelId')],
    [
      'build.protocols[0].schemes[0]',
      build.protocols?.[0]?.schemes?.[0],
      brandValue(brandSource, 'urlScheme')
    ]
  ]
  if (installerNsh !== null) {
    const folder = /!define OSTLER_DATA_FOLDER "([^"]*)"/.exec(installerNsh)?.[1]
    expected.push([
      'build/installer.nsh OSTLER_DATA_FOLDER',
      folder,
      brandValue(brandSource, 'dataFolderName')
    ])
  }
  return expected
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(
      ([field, actual, wanted]) =>
        `${field.startsWith('build/') ? '' : 'package.json '}${field} is ${JSON.stringify(actual)}, brand.ts says ${JSON.stringify(wanted)}`
    )
}

function main(projectRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const brandSource = fs.readFileSync(path.join(projectRoot, 'src', 'shared', 'brand.ts'), 'utf8')
  const installerNsh = fs.readFileSync(path.join(projectRoot, 'build', 'installer.nsh'), 'utf8')
  const problems = checkBrand(packageJson, brandSource, installerNsh)
  for (const problem of problems) process.stderr.write(`check-brand: ${problem}\n`)
  return problems.length === 0 ? 0 : 1
}

if (require.main === module) {
  process.exitCode = main(
    process.argv[2] ? path.resolve(process.argv[2]) : require('./lib/root.cjs').projectRoot
  )
}

module.exports = { checkBrand, brandValue }
