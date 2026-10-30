import type Database from 'better-sqlite3'
import type { WhiteboardObject, WhiteboardObjectInput } from '@shared/whiteboard/model'

interface WhiteboardObjectRow {
  id: string
  project_id: string
  whiteboard_id: string
  kind: WhiteboardObject['kind']
  x: number
  y: number
  width: number
  height: number
  z: number
  colour: WhiteboardObject['colour']
  text: string
  link: string | null
  group_id: string | null
  data_json: string
  created_at: string
  updated_at: string
}

function toObject(row: WhiteboardObjectRow): WhiteboardObject {
  return {
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    colour: row.colour,
    text: row.text,
    link: row.link,
    groupId: row.group_id,
    data: JSON.parse(row.data_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } as WhiteboardObject
}

/** The columns every write sets from an object, as named parameters. */
function objectParams(object: WhiteboardObjectInput, now: string) {
  return {
    id: object.id,
    kind: object.kind,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    z: object.z,
    colour: object.colour,
    text: object.text,
    link: object.link,
    groupId: object.groupId,
    dataJson: JSON.stringify(object.data),
    now
  }
}

/**
 * The rows of `whiteboard_objects` (plan `docs/plans/whiteboards/`, D5), one per object on a
 * whiteboard. Works on the Library's connection, so its writes share the Library's foreign keys
 * and sync capture triggers. The file must already be migrated: this class contains no schema.
 */
export class WhiteboardRepository {
  constructor(private readonly db: Database.Database) {}

  /** A whiteboard's objects, back to front: by `z`, then `id`. */
  listObjects(whiteboardId: string): WhiteboardObject[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM whiteboard_objects WHERE whiteboard_id = @whiteboardId ORDER BY z ASC, id ASC'
        )
        .all({ whiteboardId }) as WhiteboardObjectRow[]
    ).map(toObject)
  }

  countObjects(whiteboardId: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM whiteboard_objects WHERE whiteboard_id = @whiteboardId'
      )
      .get({ whiteboardId }) as { count: number }
    return row.count
  }

  /** For each of `ids` that exists, the whiteboard it is on. */
  ownersOf(ids: readonly string[]): Map<string, string> {
    const owners = new Map<string, string>()
    const select = this.db.prepare('SELECT whiteboard_id FROM whiteboard_objects WHERE id = @id')
    for (const id of new Set(ids)) {
      const row = select.get({ id }) as { whiteboard_id: string } | undefined
      if (row) owners.set(id, row.whiteboard_id)
    }
    return owners
  }

  insertObject(
    projectId: string,
    whiteboardId: string,
    object: WhiteboardObjectInput,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO whiteboard_objects (
           id, project_id, whiteboard_id, kind, x, y, width, height, z, colour, text, link,
           group_id, data_json, created_at, updated_at
         ) VALUES (
           @id, @projectId, @whiteboardId, @kind, @x, @y, @width, @height, @z, @colour, @text,
           @link, @groupId, @dataJson, @now, @now
         )`
      )
      .run({ ...objectParams(object, now), projectId, whiteboardId })
  }

  /** Writes every column but `id`, `project_id`, `whiteboard_id` and `created_at`. */
  updateObject(object: WhiteboardObjectInput, now: string): void {
    this.db
      .prepare(
        `UPDATE whiteboard_objects SET
           kind = @kind, x = @x, y = @y, width = @width, height = @height, z = @z,
           colour = @colour, text = @text, link = @link, group_id = @groupId,
           data_json = @dataJson, updated_at = @now
         WHERE id = @id`
      )
      .run(objectParams(object, now))
  }

  /** Deletes the given objects of this whiteboard; ids on no or another whiteboard are ignored. */
  deleteObjects(whiteboardId: string, ids: readonly string[]): void {
    const remove = this.db.prepare(
      'DELETE FROM whiteboard_objects WHERE id = @id AND whiteboard_id = @whiteboardId'
    )
    for (const id of ids) remove.run({ id, whiteboardId })
  }
}
