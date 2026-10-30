/*
 * Every file under a folder, depth first, in readdir order. A folder that does not
 * exist gives no files. Symbolic links are not followed: a link (to a file or a
 * folder) is listed as a file, like any other entry that is not a folder.
 *
 *   skipDirs  folder names not to descend into, at any depth
 *   include   (name, fullPath) => boolean, which files to list (default: all)
 */
const fs = require('node:fs')
const path = require('node:path')

function walk(dir, { skipDirs = [], include = () => true } = {}, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) walk(full, { skipDirs, include }, out)
    } else if (include(entry.name, full)) {
      out.push(full)
    }
  }
  return out
}

module.exports = { walk }
