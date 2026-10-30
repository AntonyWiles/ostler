import Database from 'better-sqlite3'
import * as path from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { useTempDir } from '../helpers/temp-dir'

describe('migration 0086 contributor role', () => {
  const dir = useTempDir('ostler-contributor-')
  let dbPath: string
  const options = () => ({ backupDir: path.join(dir(), 'backups'), appVersion: 'test' })

  beforeEach(() => {
    dbPath = path.join(dir(), 'ostler.db')
  })

  it('keeps every row of sync_roles and sync_shares and accepts contributor', async () => {
    const before = MIGRATIONS.filter((migration) => migration.version < 86)
    await migrateOstlerDatabase(dbPath, options(), before)

    const old = new Database(dbPath)
    old
      .prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version,
          created_at, last_synced_at, project_key, key_generation, rotations_read, my_role, kind, joined_invite)
         VALUES ('p1', 's1', '/f', 'm1', 'd1', 1, 100, 200, 'key', 2, 1, 'editor', 'project', 'inv')`
      )
      .run()
    old
      .prepare(
        `INSERT INTO sync_roles (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
         VALUES ('s1', 'alice', 'owner', '0', NULL, NULL), ('s1', 'bob', 'viewer', '5', 'alice', '{"d1":3}')`
      )
      .run()
    const shares = old.prepare('SELECT * FROM sync_shares ORDER BY project_id').all()
    const roles = old.prepare('SELECT * FROM sync_roles ORDER BY person_public_key').all()
    expect(() => old.prepare("UPDATE sync_shares SET my_role = 'contributor'").run()).toThrow()
    old.close()
    await migrateOstlerDatabase(
      dbPath,
      options(),
      MIGRATIONS.filter((migration) => migration.version <= 86)
    )

    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT * FROM sync_shares ORDER BY project_id').all()).toEqual(shares)
      expect(db.prepare('SELECT * FROM sync_roles ORDER BY person_public_key').all()).toEqual(roles)
      db.prepare("UPDATE sync_shares SET my_role = 'contributor'").run()
      db.prepare("UPDATE sync_roles SET role = 'contributor' WHERE person_public_key = 'bob'").run()
      expect(() => db.prepare("UPDATE sync_roles SET role = 'boss'").run()).toThrow()
    } finally {
      db.close()
    }
  })
})
