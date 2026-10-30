#!/usr/bin/env node

/*
 * Convert a generic agent-session JSONL file into a small, reviewable Ostler export.
 *
 * The input is treated as data. No string from the rollout is evaluated or
 * executed, and the source file is never modified.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  basenameAny,
  cleanText,
  firstString,
  isObject,
  projectMatch,
  projectFolderName
} = require('./agent-session-parser-core.cjs')

const FORMAT = 'ostler.agent-session'
const SCHEMA_VERSION = 1
const MESSAGE_ROLES = new Set(['user', 'assistant'])
const REASONING_ROLES = new Set(['reasoning', 'assistant_reasoning'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git'])
const FILE_EXTENSIONS = new Set([
  'c',
  'bat',
  'cc',
  'cmd',
  'cpp',
  'cjs',
  'css',
  'csv',
  'dll',
  'doc',
  'docx',
  'exe',
  'html',
  'java',
  'js',
  'json',
  'jsonl',
  'jsx',
  'lock',
  'md',
  'mjs',
  'node',
  'pdf',
  'ps1',
  'py',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'ts',
  'tsx',
  'txt',
  'vue',
  'yaml',
  'yml'
])

class SessionExtractionError extends Error {
  constructor(code, inputPath, problems) {
    const guidance =
      code === 'PROJECT_MATCH_FAILED'
        ? 'Update the Ostler project manifest or register the project before importing.'
        : 'The agent-session JSONL format may have changed. Update scripts/extract-agent-session.cjs before importing new files.'
    super(
      [
        `${code}: ${path.basename(inputPath)}`,
        'The JSONL file was not exported.',
        ...problems.map((problem) => `- ${problem}`),
        guidance
      ].join('\n')
    )
    this.name = 'SessionExtractionError'
    this.code = code
  }
}

function projectNameFromRepository(repositoryUrl) {
  const withoutQuery = repositoryUrl.split(/[?#]/, 1)[0]
  return basenameAny(withoutQuery.replace(/\.git$/, ''))
}

function addIfPresent(target, value) {
  if (value) target.add(value)
}

function trimPathCandidate(value) {
  let candidate = value
    .replace(/^['"`([{]+/, '')
    .replace(/[\]}'"`,.;:!?]+$/, '')
    .replace(/\\\\/g, '\\')

  // Diff hunks and escaped command output can trail a real filename with
  // line numbers or literal "\\n" markers. Stop at the first known file
  // extension so those display artifacts do not become folder references.
  const extensionPattern = [...FILE_EXTENSIONS].join('|')
  const fileMatch = candidate.match(
    new RegExp(`^(.*\\.(?:${extensionPattern}))(?:$|[:/\\\\])`, 'i')
  )
  if (fileMatch) candidate = fileMatch[1]
  return candidate
}

function normalizePathReference(value) {
  const cleaned = trimPathCandidate(value)
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return ''
  return cleaned.replace(/\\/g, '/')
}

function looksLikeFile(value) {
  const name = basenameAny(value)
  if (name.startsWith('.') && name.length > 1) return true
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return FILE_EXTENSIONS.has(extension)
}

function directoryReference(value) {
  const normalized = value.replace(/\\/g, '/')
  if (looksLikeFile(normalized)) return path.posix.dirname(normalized)
  return normalized.replace(/\/$/, '')
}

function sanitizePathReference(value, metadata) {
  const normalized = normalizePathReference(value)
  if (!normalized) return ''

  const root = normalizePathReference(metadata.directory).replace(/\/$/, '')
  const normalizedLower = normalized.toLowerCase()
  const rootLower = root.toLowerCase()
  if (root && (normalizedLower === rootLower || normalizedLower.startsWith(`${rootLower}/`))) {
    const relative = normalized.slice(root.length).replace(/^\/+/, '').replace(/\//g, '\\')
    return [metadata.projectName, relative].filter(Boolean).join('\\')
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) return basenameAny(normalized)

  return normalized.replace(/\//g, '\\')
}

function sanitizeText(text, metadata) {
  let sanitized = text
  if (metadata.repositoryUrl) {
    const repositoryUrls = new Set([
      metadata.repositoryUrl,
      metadata.repositoryUrl.replace(/\.git$/, '')
    ])
    for (const repositoryUrl of repositoryUrls) sanitized = sanitized.split(repositoryUrl).join('')
  }

  return sanitized.replace(/[A-Za-z]:[\\/][^\s"'`<>|]+/g, (rawPath) => {
    const trailing = rawPath.match(/[\]}'"`,.;:!?]+$/)?.[0] || ''
    const core = trailing ? rawPath.slice(0, -trailing.length) : rawPath
    return `${sanitizePathReference(core, metadata)}${trailing}`
  })
}

function extractPathCandidates(text) {
  const candidates = new Set()
  if (!text) return candidates

  // Absolute Windows paths are common in desktop-session output.
  const windowsPaths = text.match(/[A-Za-z]:[\\/][^\s"'`<>|]+/g) || []
  for (const candidate of windowsPaths) addIfPresent(candidates, candidate)

  // Relative paths such as src/shared/ostler-api.ts and docs\\progress.md.
  const relativePaths =
    text.match(
      /(?:^|[^A-Za-z0-9_])((?:\.\.?[\\/])?(?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+(?:\.[A-Za-z0-9_-]+)?)/g
    ) || []
  for (const match of relativePaths) {
    const candidate = match.replace(/^[^A-Za-z0-9_.@-]+/, '')
    if (!candidate || candidate.includes('://')) continue
    addIfPresent(candidates, candidate)
  }

  // Bare filenames such as package.json are still useful references.
  const filenames = text.match(/\b[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:[A-Za-z0-9_-]+)\b/g) || []
  for (const candidate of filenames) addIfPresent(candidates, candidate)

  return new Set([...candidates].map(normalizePathReference).filter(Boolean))
}

function addReferences(referenceText, files, folders) {
  for (const candidate of extractPathCandidates(referenceText)) {
    const file = looksLikeFile(candidate)
    const absolute = /^[A-Za-z]:\//.test(candidate) || candidate.startsWith('/')
    if (file) addIfPresent(files, candidate)
    const plausibleAbsoluteFolder =
      absolute && !/[${}]/.test(candidate) && !/^[A-Za-z]:\/n(?:\/|[A-Z]|$)/.test(candidate)
    if (file || plausibleAbsoluteFolder) {
      const directory = directoryReference(candidate)
      if (directory && directory !== '.') addIfPresent(folders, directory)
    }
  }
}

function sessionMetadata(records) {
  const payload = records.find((record) => record?.type === 'session_meta')?.payload
  const meta = isObject(payload) ? payload : {}
  const git = isObject(meta.git) ? meta.git : {}
  const directoryRecord = records.find((record) =>
    firstString(record?.cwd, record?.working_directory, record?.project_path)
  )
  const directory = firstString(
    meta.cwd,
    meta.working_directory,
    meta.project_path,
    directoryRecord?.cwd,
    directoryRecord?.working_directory,
    directoryRecord?.project_path
  )
  const repositoryUrl = firstString(
    meta.repository_url,
    git.repository_url,
    directoryRecord?.repository_url
  )
  const branch = firstString(meta.branch, git.branch)
  const id = firstString(meta.session_id, meta.id, directoryRecord?.sessionId)
  const projectName = basenameAny(directory) || projectNameFromRepository(repositoryUrl)

  return { id, directory, repositoryUrl, branch, projectName }
}

function validateProjectManifest(value, manifestPath) {
  const projects = Array.isArray(value) ? value : isObject(value) ? value.projects : null
  if (!Array.isArray(projects) || !projects.length)
    throw new Error(
      `Ostler project manifest ${path.basename(manifestPath)} must contain a non-empty projects array.`
    )

  for (const [index, project] of projects.entries()) {
    if (
      !isObject(project) ||
      !firstString(project.id) ||
      !firstString(project.path) ||
      (!firstString(project.name) && !projectFolderName(project))
    ) {
      throw new Error(
        `Invalid Ostler project at index ${index} in manifest ${path.basename(manifestPath)}. Each project needs id and path.`
      )
    }
  }
  return projects
}

function loadProjectManifest(manifestPath) {
  const resolved = path.resolve(manifestPath)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw new Error(
      `Could not read Ostler project manifest ${path.basename(resolved)}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return validateProjectManifest(parsed, resolved)
}

function genericMessages(record, metadata) {
  if (!isObject(record)) return []
  const envelope =
    record.type === 'response_item' && isObject(record.payload) ? record.payload : record
  const message = isObject(record.message) ? record.message : envelope
  const role = firstString(message.role, envelope.role, record.role, record.type).toLowerCase()
  if (!MESSAGE_ROLES.has(role)) return []
  const blocks = Array.isArray(message.content ?? message.text)
    ? (message.content ?? message.text)
    : [message.content ?? message.text ?? message.input ?? message.output]
  const messages = []
  for (const block of blocks) {
    if (isObject(block)) {
      const type = firstString(block.type).toLowerCase()
      if (type === 'tool_use' || type === 'tool_result' || type === 'image') continue
      if (type === 'thinking' || type === 'reasoning' || type === 'assistant_reasoning') {
        const thinking = sanitizeText(
          cleanText(block.thinking ?? block.summary ?? block.text ?? block.content),
          metadata
        )
        if (thinking) messages.push({ role: 'reasoning', content: thinking })
        continue
      }
    }
    const content = sanitizeText(
      conversationText(role, cleanText(isObject(block) ? (block.text ?? block.content) : block)),
      metadata
    )
    if (content) messages.push({ role, content })
  }
  return messages
}

function conversationText(role, content) {
  if (role !== 'user') return content

  // Agent rollout files can serialize the injected launch context as a
  // user-role message. It is not something the human said, so remove it while
  // preserving any actual user text that follows the context block.
  if (
    /^\s*(?:<recommended_plugins>|# AGENTS\.md instructions|<environment_context>)/i.test(content)
  ) {
    const end = content.indexOf('</environment_context>')
    return end >= 0 ? content.slice(end + '</environment_context>'.length).trim() : ''
  }
  return content
}

function extractCodexSession(raw, options = {}) {
  const includeReasoning = options.includeReasoning !== false
  const lines = String(raw)
    .split(/\r?\n/)
    .filter((line) => line.trim())
  const records = []
  let malformedLineCount = 0

  for (const line of lines) {
    try {
      const record = JSON.parse(line)
      if (isObject(record)) records.push(record)
    } catch {
      malformedLineCount++
    }
  }

  const metadata = sessionMetadata(records)
  const project = projectMatch(metadata, options.projects)
  const messages = []
  const files = new Set()
  const folders = new Set()
  const projects = new Set()
  addIfPresent(projects, metadata.projectName)
  addIfPresent(folders, normalizePathReference(metadata.directory))

  for (const record of records) {
    if (record.type === 'response_item' && isObject(record.payload)) {
      const payload = record.payload

      if (payload.type === 'message') {
        for (const message of genericMessages(record, metadata)) {
          messages.push(message)
          addReferences(message.content, files, folders)
        }
        continue
      }

      if (includeReasoning && REASONING_ROLES.has(String(payload.type).toLowerCase())) {
        // Codex may store only encrypted_content. That is deliberately not
        // read; only a readable summary belongs in a review export.
        const content = sanitizeText(cleanText(payload.summary), metadata)
        if (content) messages.push({ role: 'reasoning', content })
        addReferences(content, files, folders)
        continue
      }

      // Tool calls are not conversation messages, but their text can reveal
      // files and folders the agent worked with. Keep references only.
      if (payload.type === 'custom_tool_call')
        addReferences(cleanText(payload.input), files, folders)
      if (payload.type === 'custom_tool_call_output')
        addReferences(cleanText(payload.output), files, folders)
      continue
    }

    for (const message of genericMessages(record, metadata)) {
      messages.push(message)
      addReferences(message.content, files, folders)
    }
  }

  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    session: {
      id: metadata.id || undefined,
      project: {
        name: metadata.projectName || undefined,
        directory: sanitizePathReference(metadata.directory, metadata) || undefined,
        branch: metadata.branch || undefined,
        match: project
      }
    },
    messages,
    references: {
      projects: [...projects].sort(),
      folders: [...new Set([...folders].map((value) => sanitizePathReference(value, metadata)))]
        .filter(Boolean)
        .sort(),
      files: [...new Set([...files].map((value) => sanitizePathReference(value, metadata)))]
        .filter(Boolean)
        .sort()
    },
    extraction: {
      sourceLineCount: lines.length,
      malformedLineCount,
      messageCount: messages.length,
      reasoningIncluded: includeReasoning
    }
  }
}

function validateExtractedSession(result, inputPath, options = {}) {
  const problems = []
  const userCount = result.messages.filter((message) => message.role === 'user').length
  const assistantCount = result.messages.filter((message) => message.role === 'assistant').length

  if (result.extraction.malformedLineCount > 0)
    problems.push(`Found ${result.extraction.malformedLineCount} malformed JSONL line(s).`)
  if (userCount === 0) problems.push('No user message text was recognized.')
  if (assistantCount === 0) problems.push('No assistant/agent message text was recognized.')
  if (!result.session.project.name)
    problems.push('Could not determine the project folder name from session metadata.')
  if (options.requireProjectMatch && result.session.project.match.status !== 'matched') {
    problems.push(
      `Ostler project match is ${result.session.project.match.status}; exactly one registered project is required.`
    )
  }
  if (problems.length)
    throw new SessionExtractionError(
      options.requireProjectMatch ? 'PROJECT_MATCH_FAILED' : 'SESSION_FORMAT_CHANGED',
      inputPath,
      problems
    )
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefined(item)])
  )
}

function outputPathFor(inputPath, outputDirectory) {
  const basename = path.basename(inputPath, path.extname(inputPath)) + '.ostler.json'
  return path.resolve(outputDirectory || path.dirname(inputPath), basename)
}

function findJsonlFiles(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) visit(fullPath)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        files.push(fullPath)
      }
    }
  }
  visit(root)
  return files
}

function extractCodexSessionFile(inputPath, outputPath, options = {}) {
  const input = path.resolve(inputPath)
  const output = path.resolve(outputPath)
  if (input === output) throw new Error('Refusing to overwrite the JSONL source file.')
  const result = extractCodexSession(fs.readFileSync(input, 'utf8'), options)
  validateExtractedSession(result, input, {
    requireProjectMatch: Array.isArray(options.projects)
  })
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(
    output,
    `${JSON.stringify(removeUndefined(result), null, options.compact ? 0 : 2)}\n`
  )
  return { output, result }
}

function printHelp() {
  process.stdout.write(
    `Usage:\n  node scripts/extract-agent-session.cjs <input.jsonl> [options]\n\nOptions:\n  --output <file>       Write one export to this exact path.\n  --output-dir <dir>    Write one .ostler.json file per input in this directory.\n  --projects <file>     Match each session to an Ostler config/projects JSON file.\n  --no-reasoning        Omit readable reasoning summaries.\n  --compact             Write compact JSON.\n  --help                Show this help.\n\nThe input JSONL is read-only. The command scans JSONL records generically,\nignores tool/metadata records, and fails loudly if parsing fails, user/assistant\ntext is missing, project identity is missing, or a supplied Ostler project\nmanifest does not produce exactly one match.\n`
  )
}

function parseArguments(argv) {
  const inputPaths = []
  let output
  let outputDirectory
  let projectsPath
  let includeReasoning = true
  let compact = false

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument === '--no-reasoning') {
      includeReasoning = false
      continue
    }
    if (argument === '--compact') {
      compact = true
      continue
    }
    if (argument === '--output' || argument === '--output-dir' || argument === '--projects') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a path.`)
      if (argument === '--output') output = value
      else if (argument === '--output-dir') outputDirectory = value
      else projectsPath = value
      continue
    }
    if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    inputPaths.push(argument)
  }

  if (!inputPaths.length) throw new Error('At least one input JSONL file is required.')
  if (output && inputPaths.length !== 1)
    throw new Error('--output can only be used with one input file.')
  if (output && outputDirectory) throw new Error('Use either --output or --output-dir, not both.')
  return { inputPaths, output, outputDirectory, projectsPath, includeReasoning, compact }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv)
  if (args.help) {
    printHelp()
    return
  }

  const projects = args.projectsPath ? loadProjectManifest(args.projectsPath) : undefined

  const inputPaths = args.inputPaths.flatMap((inputPath) => {
    const resolved = path.resolve(inputPath)
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) return [resolved]
    if (args.output)
      throw new Error('--output cannot be used with a directory input; use --output-dir.')
    return findJsonlFiles(resolved)
  })
  if (!inputPaths.length)
    throw new Error('No JSONL files were found in the supplied input folder(s).')

  for (const inputPath of inputPaths) {
    const outputPath = args.output
      ? path.resolve(args.output)
      : outputPathFor(inputPath, args.outputDirectory)
    const { result, output } = extractCodexSessionFile(inputPath, outputPath, {
      ...args,
      projects
    })
    process.stdout.write(`Wrote ${path.basename(output)} (${result.messages.length} messages)\n`)
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  main,
  extractCodexSession,
  extractAgentSession: extractCodexSession,
  extractCodexSessionFile,
  loadProjectManifest,
  outputPathFor,
  parseArguments,
  projectMatch,
  validateExtractedSession
}
