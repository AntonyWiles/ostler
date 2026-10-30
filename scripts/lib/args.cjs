/*
 * A tiny command-line parser for the scripts in scripts/.
 *
 *   const args = parseArgs(process.argv.slice(2), { values: ['--base'] })
 *   args.has('--check')   the flag was given (any argument starting with --)
 *   args.value('--base')  the argument after a value option (first one wins), or undefined
 *   args.positionals      everything else, in order
 *
 * No `--name=value`, no short flags, no validation: each script checks its own.
 */
function parseArgs(argv = process.argv.slice(2), { values = [] } = {}) {
  const flags = new Set()
  const options = new Map()
  const positionals = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (values.includes(arg)) {
      const value = argv[++index]
      if (!options.has(arg)) options.set(arg, value)
    } else if (arg.startsWith('--')) flags.add(arg)
    else positionals.push(arg)
  }
  return {
    has: (name) => flags.has(name),
    value: (name) => options.get(name),
    positionals
  }
}

module.exports = { parseArgs }
