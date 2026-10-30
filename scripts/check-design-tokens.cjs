/*
 * Keeps raw colours, sizes and weights out of the renderer. Colours, type
 * sizes, weights, border and focus-ring widths come only from tokens.css, so
 * `npm run lint` fails on:
 *   - in any .css under src/renderer other than tokens.css: hex, rgb()/rgba(),
 *     hsl()/hsla(), the other colour functions (oklch(), lab(), hwb(),
 *     color()...) and named colours (`white`, `red`...), pixel font-size,
 *     numeric font-weight, pixel border and outline widths, and a selector on
 *     an attribute that holds translated words (`[aria-label='Recycle bin']`);
 *   - in .tsx files: literal colours in inline `style={{ ... }}` objects, and
 *     in SVG `fill`, `stroke` and `stopColor` attributes;
 *   - in .ts and .tsx files: a string that is a hex, rgb() or hsl() colour.
 * Dynamic values (a project's colour from data) are expressions, not literals,
 * so they pass; Windows high contrast's system colours (Canvas, CanvasText,
 * Highlight...) are not literals either.
 */
const fs = require('node:fs')
const path = require('node:path')
const { walk } = require('./lib/walk.cjs')

/**
 * Real exceptions, by path relative to src/renderer (forward slashes). Keep it
 * short and say why each one is here.
 */
const ALLOWLIST = {
  // The token source itself: the only place raw values are defined.
  'styles/tokens.css': 'defines the tokens',
  // Contrast maths for a person's own accent colour: white text on it.
  'ui/theme/accent.ts': 'measures contrast against white text'
}

/** CSS's named colours (CSS Color 4), which the theme tokens replace. */
const NAMED_COLOURS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen'
]

const CSS_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/
// A whole word: `var(--annotation-red)` and `white-space` are not colours.
const CSS_NAMED_COLOUR = new RegExp(`(?<![-\\w])(?:${NAMED_COLOURS.join('|')})(?![-\\w])`, 'i')
const CSS_PX_FONT = /font-size\s*:\s*[-\d.]+px\b/
const CSS_NUMERIC_WEIGHT = /font-weight\s*:\s*\d/
const CSS_PX_EDGE = /(?:^|[\s;{])(?:border(?:-[a-z]+)*|outline(?:-[a-z]+)*)\s*:\s*-?[\d.]+px\b/
// Attributes whose values are translated words; a selector on them breaks in
// every other language and in the pseudo-locale.
const CSS_TEXT_SELECTOR = /\[\s*(?:aria-label|aria-description|title|alt|placeholder)\s*[~|^$*]?=/

const STYLE_COLOUR_LITERAL =
  /(?:#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\()|\b(?:color|background|backgroundColor|borderColor|fill|stroke|outlineColor)\s*:\s*['"`](?!var\(|transparent|inherit|currentColor|none)/
const SVG_COLOUR_ATTRIBUTE =
  /\b(?:fill|stroke|stopColor|floodColor|lightingColor)=\{?\s*(['"`])([^'"`]*)\1/g
const SVG_ALLOWED_VALUE = /^(?:none|currentColor|transparent|inherit)$|^(?:url|var)\(|\$\{/i
const CODE_COLOUR_STRING = /(['"`])(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^'"`]*\))\1/

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

/** Problems in one stylesheet, as `line: message`. */
function checkCss(source) {
  const problems = []
  const lines = stripCssComments(source).split('\n')
  lines.forEach((line, index) => {
    const at = index + 1
    if (CSS_TEXT_SELECTOR.test(line))
      problems.push(`${at}: selector on translated text (use a class or a data attribute)`)
    // Only declaration values: a selector such as `#root` is not a colour.
    const colon = line.indexOf(':')
    if (colon === -1 || /\{\s*$/.test(line)) return
    const value = line.slice(colon + 1)
    // Quoted text (`content: 'red'`, a font name) is not a colour.
    const unquoted = value.replace(/(['"])(?:(?!\1).)*\1/g, '')
    if (CSS_COLOUR.test(value) || CSS_NAMED_COLOUR.test(unquoted))
      problems.push(`${at}: raw colour (use a colour token)`)
    if (CSS_PX_FONT.test(line)) problems.push(`${at}: pixel font-size (use a type token)`)
    if (CSS_NUMERIC_WEIGHT.test(line))
      problems.push(`${at}: numeric font-weight (use a weight token)`)
    if (CSS_PX_EDGE.test(line))
      problems.push(
        `${at}: pixel border or outline width (use --border-width or the focus-ring tokens)`
      )
  })
  return problems
}

/** The source text of every `style={{ ... }}` object, with its starting line. */
function inlineStyles(source) {
  const found = []
  const opener = /style=\{\{/g
  let match
  while ((match = opener.exec(source))) {
    let depth = 2
    let end = match.index + match[0].length
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') depth -= 1
      end += 1
    }
    const line = source.slice(0, match.index).split('\n').length
    found.push({ line, text: source.slice(match.index, end) })
  }
  return found
}

/** Colour strings in code (.ts or .tsx), as `line: message`. Comments are skipped. */
function checkCode(source) {
  const problems = []
  source.split('\n').forEach((line, index) => {
    if (/^\s*(?:\/\/|\/?\*)/.test(line)) return
    if (CODE_COLOUR_STRING.test(line))
      problems.push(`${index + 1}: literal colour in code (use a token, or PROJECT_COLORS)`)
  })
  return problems
}

/** Problems in one component file, as `line: message`. */
function checkTsx(source) {
  const problems = inlineStyles(source)
    .filter(({ text }) => STYLE_COLOUR_LITERAL.test(text))
    .map(({ line }) => `${line}: literal colour in an inline style (use a token or a class)`)
  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(SVG_COLOUR_ATTRIBUTE)) {
      if (!SVG_ALLOWED_VALUE.test(match[2]))
        problems.push(`${index + 1}: literal colour in an SVG attribute (use a token or a class)`)
    }
  })
  // One message per line: a colour string already reported above is not repeated.
  const reported = new Set(problems.map((problem) => problem.split(':')[0]))
  for (const problem of checkCode(source)) {
    if (!reported.has(problem.split(':')[0])) problems.push(problem)
  }
  return problems.sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
}

/** Every problem under a renderer folder, as `relative/path:line: message`. */
function checkTree(rendererRoot) {
  const problems = []
  for (const file of walk(rendererRoot)) {
    const relative = path.relative(rendererRoot, file).split(path.sep).join('/')
    if (ALLOWLIST[relative]) continue
    let found = []
    if (file.endsWith('.css')) found = checkCss(fs.readFileSync(file, 'utf8'))
    else if (file.endsWith('.tsx')) found = checkTsx(fs.readFileSync(file, 'utf8'))
    else if (file.endsWith('.ts')) found = checkCode(fs.readFileSync(file, 'utf8'))
    for (const problem of found) problems.push(`src/renderer/${relative}:${problem}`)
  }
  return problems
}

function main(projectRoot) {
  const problems = checkTree(path.join(projectRoot, 'src', 'renderer'))
  for (const problem of problems) process.stderr.write(`check-design-tokens: ${problem}\n`)
  return problems.length === 0 ? 0 : 1
}

if (require.main === module) {
  process.exitCode = main(
    process.argv[2] ? path.resolve(process.argv[2]) : require('./lib/root.cjs').projectRoot
  )
}

module.exports = { checkCss, checkTsx, checkCode, checkTree, ALLOWLIST }
