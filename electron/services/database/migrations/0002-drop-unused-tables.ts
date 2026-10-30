import type { Migration } from './types'

/**
 * Tables the baseline still creates because early builds did, but which no
 * code has read or written since. Their indexes go with them.
 */
const UNUSED_TABLES = [
  'projects',
  'project_knowledge',
  'project_knowledge_ignores',
  'project_knowledge_folders',
  'agent_conversation_sources',
  'agent_conversations',
  'agent_conversation_reports',
  'agent_conversation_report_history',
  'agent_conversation_report_annotations'
] as const

export const dropUnusedTables: Migration = {
  version: 2,
  name: 'drop-unused-tables',
  up(db) {
    for (const table of UNUSED_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }
  }
}
