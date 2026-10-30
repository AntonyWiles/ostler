import * as path from 'path'
import { migrateOstlerDatabase } from '../../electron/services/database/migrations'

/**
 * Creates `<dir>/<fileName>` at the latest schema version through the same
 * runner start-up uses, and returns its path. Services under test open it
 * exactly as they open the real file.
 */
export async function createMigratedDatabase(dir: string, fileName = 'ostler.db'): Promise<string> {
  const dbPath = path.join(dir, fileName)
  await migrateOstlerDatabase(dbPath, {
    backupDir: path.join(dir, 'backups'),
    appVersion: 'test'
  })
  return dbPath
}
