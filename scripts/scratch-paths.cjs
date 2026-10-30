/*
 * Guards shared by the scratch scripts (`npm run dev:scratch`,
 * `npm run scratch:project`): which names are allowed, where scratch folders
 * live, and the one check that keeps a delete inside the scratch root.
 */
const path = require('node:path')

const SCRATCH_ROOT = 'C:\\temp\\ostler-roadmap'
const SCRATCH_PROJECTS_ROOT = path.win32.join(SCRATCH_ROOT, 'projects')

/** Ports a scratch instance uses, so it never collides with an everyday running Ostler. */
// Agents start off, as on a new install (D10): a config file without a
// version is otherwise migrated as an existing install, which keeps them on.
const SCRATCH_CONFIG = {
  harness: { enabled: false, port: 18934 },
  automationApi: { enabled: false, port: 18935 }
}

const NAME_PATTERN = /^[a-z0-9-]+$/

function assertScratchName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`Scratch name must match [a-z0-9-]+, got ${JSON.stringify(name)}`)
  }
  return name
}

/** True only for a path strictly inside `root` (never `root` itself). */
function isStrictlyInside(root, candidate) {
  const relative = path.win32.relative(path.win32.resolve(root), path.win32.resolve(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.win32.isAbsolute(relative)
}

function scratchDataDir(name) {
  return path.win32.join(SCRATCH_ROOT, assertScratchName(name))
}

function scratchProjectDir(name) {
  return path.win32.join(SCRATCH_PROJECTS_ROOT, assertScratchName(name))
}

/** Throws unless `target` may be deleted by `--fresh`. */
function assertDeletable(target) {
  if (!isStrictlyInside(SCRATCH_ROOT, target)) {
    throw new Error(`Refusing to delete ${target}: it is not inside ${SCRATCH_ROOT}`)
  }
  if (path.win32.resolve(target).toLowerCase() === SCRATCH_PROJECTS_ROOT.toLowerCase()) {
    throw new Error(`Refusing to delete the scratch projects folder ${target}`)
  }
  return target
}

module.exports = {
  SCRATCH_ROOT,
  SCRATCH_PROJECTS_ROOT,
  SCRATCH_CONFIG,
  assertScratchName,
  isStrictlyInside,
  scratchDataDir,
  scratchProjectDir,
  assertDeletable
}
