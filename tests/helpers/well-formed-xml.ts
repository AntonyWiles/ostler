/**
 * A strict enough well-formedness check for the XML Ostler writes (N7.6's
 * PowerPoint parts), with no parser dependency: one root element, every tag
 * closed in order, attributes quoted and unique, and only the five XML
 * entities or numeric references. Returns the problem, or null.
 */
export function xmlProblem(xml: string): string | null {
  let text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml
  text = text.replace(/^<\?xml[^?]*\?>\s*/, '')
  const stack: string[] = []
  let roots = 0
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y
  const entity = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/y
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === '<') {
      tag.lastIndex = at
      const match = tag.exec(text)
      if (!match) return `bad tag at ${at}: ${text.slice(at, at + 40)}`
      const [whole, closing, name, attributes, selfClosing] = match
      if (closing) {
        if (attributes || selfClosing) return `bad closing tag ${name}`
        if (stack.pop() !== name) return `mismatched </${name}>`
      } else {
        const names = [...attributes.matchAll(/([\w.:-]+)\s*=/g)].map((m) => m[1])
        if (new Set(names).size !== names.length) return `duplicate attribute on ${name}`
        for (const value of attributes.matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          const problem = textProblem(value[1] ?? value[2] ?? '', entity)
          if (problem) return `${problem} in an attribute of ${name}`
        }
        if (stack.length === 0) roots += 1
        if (!selfClosing) stack.push(name)
      }
      at += whole.length
      continue
    }
    const next = text.indexOf('<', at)
    const chunk = text.slice(at, next === -1 ? text.length : next)
    if (stack.length === 0 && chunk.trim()) return 'text outside the root'
    const problem = textProblem(chunk, entity)
    if (problem) return problem
    at += chunk.length
  }
  if (stack.length) return `unclosed <${stack[stack.length - 1]}>`
  if (roots !== 1) return `${roots} root elements`
  return null
}

function textProblem(value: string, entity: RegExp): string | null {
  for (let at = value.indexOf('&'); at !== -1; at = value.indexOf('&', at + 1)) {
    entity.lastIndex = at
    if (!entity.exec(value)) return `bare & at ${value.slice(at, at + 12)}`
  }
  return null
}
