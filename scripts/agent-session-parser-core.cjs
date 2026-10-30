'use strict'

const path = require('node:path')

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textFrom(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join('\n')
  if (!isObject(value)) return ''
  return [
    value.text,
    value.thinking,
    value.output_text,
    value.input_text,
    value.summary_text,
    value.content,
    value.summary,
    value.value
  ]
    .map(textFrom)
    .filter(Boolean)
    .join('\n')
}

function cleanText(value) {
  return textFrom(value).replace(/\r\n/g, '\n').trim()
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

function basenameAny(value) {
  const normalized = value.replace(/[\\/]+$/, '')
  return path.win32.basename(normalized) || path.posix.basename(normalized)
}

function normalizePathReference(value) {
  return value
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
}

function sanitizePathReference(value, metadata) {
  const normalized = normalizePathReference(value)
  if (!normalized) return ''
  const root = normalizePathReference(metadata.directory || '').replace(/\/$/, '')
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
  if (!text) return ''
  let sanitized = text
  if (metadata.repositoryUrl) {
    for (const repositoryUrl of new Set([
      metadata.repositoryUrl,
      metadata.repositoryUrl.replace(/\.git$/, '')
    ])) {
      sanitized = sanitized.split(repositoryUrl).join('')
    }
  }
  if (metadata.stripUrls) sanitized = sanitized.replace(/https?:\/\/[^\s"'`<>|]+/gi, '')
  return sanitized.replace(/[A-Za-z]:[\\/][^\s"'`<>|]+/g, (match) => {
    const trailing = match.match(/[),.;:!?]+$/)?.[0] || ''
    const core = trailing ? match.slice(0, -trailing.length) : match
    return `${sanitizePathReference(core, metadata)}${trailing}`
  })
}

function comparablePath(value) {
  if (!value) return ''
  const normalized = value.replace(/[\\/]+/g, '\\').replace(/\\$/, '')
  return normalized.toLowerCase()
}

function projectFolderName(project) {
  return basenameAny(firstString(project.path, project.name))
}

function projectMatch(metadata, projects) {
  if (!Array.isArray(projects)) return { status: 'unresolved' }
  const sessionPath = comparablePath(metadata.directory)
  const projectName = firstString(metadata.projectName)
  const exactPathMatches = sessionPath
    ? projects.filter((project) => comparablePath(project.path) === sessionPath)
    : []
  const folderMatches = projects.filter(
    (project) => projectFolderName(project).toLowerCase() === projectName.toLowerCase()
  )
  const nameMatches = projects.filter(
    (project) => firstString(project.name).toLowerCase() === projectName.toLowerCase()
  )
  const candidates = (
    exactPathMatches.length ? exactPathMatches : [...folderMatches, ...nameMatches]
  ).filter(
    (project, index, all) => all.findIndex((candidate) => candidate.id === project.id) === index
  )
  if (candidates.length === 1) {
    return {
      status: 'matched',
      id: candidates[0].id,
      name: firstString(candidates[0].name, projectFolderName(candidates[0]))
    }
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates: candidates.map((project) => ({
        id: project.id,
        name: firstString(project.name, projectFolderName(project))
      }))
    }
  }
  return { status: 'unmatched' }
}

module.exports = {
  basenameAny,
  cleanText,
  comparablePath,
  firstString,
  isObject,
  normalizePathReference,
  projectFolderName,
  projectMatch,
  sanitizePathReference,
  sanitizeText,
  textFrom
}
