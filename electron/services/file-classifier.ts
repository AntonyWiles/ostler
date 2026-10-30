import type { FileCategory } from '@shared/ostler-api'

/** Extension-to-category mapping */
const EXTENSION_MAP: Record<string, FileCategory> = {
  // source
  '.ts': 'source',
  '.tsx': 'source',
  '.js': 'source',
  '.jsx': 'source',
  '.mjs': 'source',
  '.cjs': 'source',
  '.py': 'source',
  '.cpp': 'source',
  '.c': 'source',
  '.h': 'source',
  '.hpp': 'source',
  '.rs': 'source',
  '.go': 'source',
  '.java': 'source',
  '.cs': 'source',
  '.rb': 'source',
  '.php': 'source',
  '.swift': 'source',
  '.kt': 'source',
  // style
  '.css': 'style',
  '.scss': 'style',
  '.less': 'style',
  '.sass': 'style',
  '.styl': 'style',
  // markup
  '.html': 'markup',
  '.htm': 'markup',
  '.svg': 'markup',
  '.xml': 'markup',
  '.xhtml': 'markup',
  '.vue': 'markup',
  '.svelte': 'markup',
  // config
  '.json': 'config',
  '.yaml': 'config',
  '.yml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.env': 'config',
  '.gitignore': 'config',
  '.editorconfig': 'config',
  '.prettierrc': 'config',
  '.eslintrc': 'config',
  // documentation
  '.md': 'documentation',
  '.txt': 'documentation',
  '.rst': 'documentation',
  '.adoc': 'documentation',
  // media
  '.png': 'media',
  '.jpg': 'media',
  '.jpeg': 'media',
  '.gif': 'media',
  '.ico': 'media',
  '.webp': 'media',
  '.wav': 'media',
  '.mp3': 'media',
  '.mp4': 'media',
  '.webm': 'media',
  '.ogg': 'media'
}

/**
 * Get the file extension from a path (lowercase, with dot).
 * @param filePath The file path to extract the extension from.
 * @returns The file extension, e.g., '.ts', or an empty string if none.
 */
export function getExtension(filePath: string): string {
  const match = filePath.match(/\.[0-9a-z]+$/i)
  return match ? match[0].toLowerCase() : ''
}

/**
 * Classify a file by its path into a FileCategory.
 * Takes the relative path from the project root.
 *
 * Classification logic (in priority order):
 * 1. If path starts with `node_modules/`, `__pycache__/`, `.venv/`, `venv/` → 'dependency'
 * 2. If path starts with `out/`, `dist/`, `build/`, `.next/`, `target/` → 'build'
 * 3. If path contains `test` or `spec` in directory name or filename → 'test'
 * 4. Look up extension in EXTENSION_MAP
 * 5. Default: 'other'
 *
 * @param relativePath The relative path of the file from the project root.
 * @returns The classified FileCategory.
 */
export function classifyFile(relativePath: string): FileCategory {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  const pathParts = normalizedPath.split('/')

  // 1. Dependency directories
  if (
    normalizedPath.startsWith('node_modules/') ||
    normalizedPath.startsWith('__pycache__/') ||
    normalizedPath.startsWith('.venv/') ||
    normalizedPath.startsWith('venv/')
  ) {
    return 'dependency'
  }

  // 2. Build directories
  if (
    normalizedPath.startsWith('out/') ||
    normalizedPath.startsWith('dist/') ||
    normalizedPath.startsWith('build/') ||
    normalizedPath.startsWith('.next/') ||
    normalizedPath.startsWith('target/')
  ) {
    return 'build'
  }

  // 3. Test files/directories
  // Check if any directory or the filename contains 'test' or 'spec'
  const isTest = pathParts.some((part) => {
    const lowerPart = part.toLowerCase()
    // Exclude 'e2e' or similar specific matches if needed, but going with general 'test' and 'spec'
    return lowerPart.includes('test') || lowerPart.includes('spec')
  })

  if (isTest) {
    return 'test'
  }

  // 4. Look up extension in EXTENSION_MAP
  const extension = getExtension(normalizedPath)
  if (extension && EXTENSION_MAP[extension]) {
    return EXTENSION_MAP[extension]
  }

  // 5. Default
  return 'other'
}
