/* The repository root, for the scripts in scripts/ (this file is in scripts/lib/). */
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..', '..')

module.exports = { projectRoot }
