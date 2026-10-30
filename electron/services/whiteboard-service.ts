import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { DEFAULT_AI_ACCESS, type LibraryAiAccess, type LibraryItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Refusal, isReadOnlyError } from '@shared/refusal'
import {
  WHITEBOARD_LIMITS,
  cleanWhiteboardObject,
  cleanWhiteboardSave,
  type CreateWhiteboardInput,
  type WhiteboardDocument,
  type WhiteboardObject,
  type WhiteboardObjectInput,
  type WhiteboardSaveResult
} from '@shared/whiteboard/model'
import { whiteboardOutline } from '@shared/whiteboard/outline'
import type { LibraryRepository } from './database/library-repository'
import { WhiteboardRepository } from './database/whiteboard-repository'
import { cleanTitle } from './library-title'
import { validateProjectId } from './storage-paths'

const STORAGE_LABEL = 'Library storage'

/** What a project file sets on a whiteboard it brings (D21), beside its title and objects. */
export interface WhiteboardItemFields {
  summary?: string
  aiAccess?: LibraryAiAccess
  tags?: string[]
}

/** One image object of a whiteboard and the Library image it now shows. */
export interface WhiteboardPicture {
  objectId: string
  imageItemId: string
}

/**
 * Whiteboards (plan `docs/plans/whiteboards/`): a whiteboard is a Library item of kind
 * `whiteboard` (D1) whose objects are rows of `whiteboard_objects` (D5). Its body is never typed:
 * every save rewrites it as the board's English outline (D6), so search, "Linked from", Ostler AI
 * and agent attachments read whiteboards as they read any Library item.
 *
 * Built by `LibraryService` on its own connection, so it shares the Library's foreign keys, undo
 * recorder and sync capture triggers.
 */
export class WhiteboardService {
  private readonly objects: WhiteboardRepository

  constructor(
    private readonly db: Database.Database,
    private readonly library: LibraryRepository,
    /** Called after a commit that changed a whiteboard's outline, for its attached work items. */
    private readonly onContentChanged: (projectId: string, itemId: string) => void
  ) {
    this.objects = new WhiteboardRepository(db)
  }

  /**
   * A new whiteboard with its first revision, index entry and objects. `fields` are set by a
   * project file's import (D21); the editor leaves them out.
   */
  create(
    projectId: string,
    input: CreateWhiteboardInput,
    fields: WhiteboardItemFields = {}
  ): WhiteboardDocument {
    validateProjectId(projectId, STORAGE_LABEL)
    if (!input || typeof input !== 'object') throw new Error('A new whiteboard needs a title')
    const title = cleanTitle(input.title)
    const given: unknown = input.objects ?? []
    if (!Array.isArray(given)) throw new Error('Whiteboard objects must be a list')
    if (given.length > WHITEBOARD_LIMITS.objects) {
      throw new Refusal(t('errors:whiteboard.tooManyObjects', { max: WHITEBOARD_LIMITS.objects }))
    }
    const objects = given.map(cleanWhiteboardObject)
    const ids = new Set<string>()
    for (const object of objects) {
      if (ids.has(object.id)) throw new Error(`Whiteboard object ${object.id} given twice`)
      ids.add(object.id)
    }
    if (this.objects.ownersOf([...ids]).size > 0) {
      throw new Refusal(t('errors:whiteboard.idInUse'))
    }
    this.assertPicturesInProject(projectId, objects)

    const now = new Date().toISOString()
    const item: LibraryItem = {
      id: uuidv4(),
      projectId,
      kind: 'whiteboard',
      title,
      summary: fields.summary ?? '',
      body: this.outline(projectId, objects),
      url: null,
      file: null,
      aiAccess: fields.aiAccess ?? DEFAULT_AI_ACCESS.whiteboard,
      isPrimaryBrief: false,
      tags: fields.tags ?? [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }
    this.db.transaction(() => {
      this.library.insertItem(item)
      this.library.insertRevision(item)
      this.indexItem(item)
      for (const object of objects) this.objects.insertObject(projectId, item.id, object, now)
    })()
    return { item, objects: this.objects.listObjects(item.id) }
  }

  /**
   * The whiteboard and its objects. A body that no longer matches the objects (they arrived by
   * sync, or the outline rules changed) is rewritten first, except on a Viewer's PC, where the
   * database refuses the write and the document is returned as it is.
   */
  get(projectId: string, whiteboardId: string): WhiteboardDocument {
    let item = this.whiteboard(projectId, whiteboardId)
    const objects = this.objects.listObjects(item.id)
    const outline = this.outline(projectId, objects)
    if (outline !== item.body) {
      try {
        const next = this.withOutline(item, outline, new Date().toISOString())
        this.db.transaction(() => this.saveWithOutline(next))()
        item = next
        this.onContentChanged(projectId, item.id)
      } catch (error) {
        if (!isReadOnlyError(error)) throw error
      }
    }
    return { item, objects }
  }

  /**
   * Applies one save from the editor: new objects are inserted, known ones updated, the given
   * ids of this whiteboard deleted, and the body rewritten when the outline changed (a new
   * revision and index entry only then).
   */
  save(projectId: string, whiteboardId: string, input: unknown): WhiteboardSaveResult {
    const item = this.whiteboard(projectId, whiteboardId)
    if (item.archivedAt) throw new Refusal(t('errors:whiteboard.archived'))
    const clean = cleanWhiteboardSave(input)

    const owners = this.objects.ownersOf(clean.upserts.map((object) => object.id))
    for (const owner of owners.values()) {
      if (owner !== item.id) throw new Refusal(t('errors:whiteboard.idInUse'))
    }
    const added = clean.upserts.filter((object) => !owners.has(object.id)).length
    const current = this.objects.ownersOf(clean.deletes)
    const removed = clean.deletes.filter((id) => current.get(id) === item.id).length
    if (this.objects.countObjects(item.id) + added - removed > WHITEBOARD_LIMITS.objects) {
      throw new Refusal(t('errors:whiteboard.tooManyObjects', { max: WHITEBOARD_LIMITS.objects }))
    }
    this.assertPicturesInProject(projectId, clean.upserts)

    const now = new Date().toISOString()
    let next: LibraryItem = { ...item, updatedAt: now }
    this.db.transaction(() => {
      for (const object of clean.upserts) {
        if (owners.has(object.id)) this.objects.updateObject(object, now)
        else this.objects.insertObject(projectId, item.id, object, now)
      }
      this.objects.deleteObjects(item.id, clean.deletes)
      const outline = this.outline(projectId, this.objects.listObjects(item.id))
      if (outline === item.body) {
        this.library.saveItem(next)
      } else {
        next = this.withOutline(item, outline, now)
        this.saveWithOutline(next)
      }
    })()
    if (next.revision !== item.revision) this.onContentChanged(projectId, item.id)
    return { item: next, savedAt: now }
  }

  /**
   * Shows a picture in each given image object (D21: a project file's pictures, linked once the
   * importer has added their files), through the normal save. Ids that are not image objects of
   * this whiteboard are skipped.
   */
  setPictures(
    projectId: string,
    whiteboardId: string,
    pictures: readonly WhiteboardPicture[]
  ): void {
    const shown = new Map(pictures.map((picture) => [picture.objectId, picture.imageItemId]))
    const upserts = this.listObjects(projectId, whiteboardId).flatMap(
      (object): WhiteboardObjectInput[] => {
        const imageItemId = shown.get(object.id)
        if (object.kind !== 'image' || imageItemId === undefined) return []
        return [{ ...object, data: { ...object.data, imageItemId } }]
      }
    )
    for (let at = 0; at < upserts.length; at += WHITEBOARD_LIMITS.upserts) {
      this.save(projectId, whiteboardId, {
        upserts: upserts.slice(at, at + WHITEBOARD_LIMITS.upserts),
        deletes: []
      })
    }
  }

  /** The whiteboard's objects, back to front. */
  listObjects(projectId: string, whiteboardId: string): WhiteboardObject[] {
    return this.objects.listObjects(this.whiteboard(projectId, whiteboardId).id)
  }

  /** The outline its objects give now, which may differ from a body not yet rewritten. */
  outlineOf(projectId: string, whiteboardId: string): string {
    const item = this.whiteboard(projectId, whiteboardId)
    return this.outline(projectId, this.objects.listObjects(item.id))
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** This project's whiteboard, archived or not; refused for anything else. */
  private whiteboard(projectId: string, whiteboardId: string): LibraryItem {
    validateProjectId(projectId, STORAGE_LABEL)
    const item = typeof whiteboardId === 'string' ? this.library.getItem(whiteboardId) : null
    if (!item || item.projectId !== projectId || item.kind !== 'whiteboard') {
      throw new Refusal(t('errors:whiteboard.notAWhiteboard'))
    }
    return item
  }

  /** The outline, its pictures named by their Library titles. */
  private outline(projectId: string, objects: readonly WhiteboardObjectInput[]): string {
    const imageTitles = new Map<string, string>()
    for (const object of objects) {
      if (object.kind !== 'image' || object.data.imageItemId === null) continue
      const id = object.data.imageItemId
      if (imageTitles.has(id)) continue
      const picture = this.library.getItem(id)
      if (picture && picture.projectId === projectId && picture.kind === 'image') {
        imageTitles.set(id, picture.title)
      }
    }
    return whiteboardOutline(objects, { imageTitles })
  }

  /** Every picture shown must be an image item of this project's Library. */
  private assertPicturesInProject(
    projectId: string,
    objects: readonly WhiteboardObjectInput[]
  ): void {
    for (const object of objects) {
      if (object.kind !== 'image' || object.data.imageItemId === null) continue
      const picture = this.library.getItem(object.data.imageItemId)
      if (!picture || picture.projectId !== projectId || picture.kind !== 'image') {
        throw new Refusal(t('errors:whiteboard.pictureNotInProject'))
      }
    }
  }

  private withOutline(item: LibraryItem, outline: string, now: string): LibraryItem {
    return { ...item, body: outline, revision: item.revision + 1, updatedAt: now }
  }

  /** Saves an item whose body changed: the row, a new revision and a new index entry. */
  private saveWithOutline(item: LibraryItem): void {
    this.library.saveItem(item)
    this.library.insertRevision(item)
    this.indexItem(item)
  }

  /** The same index entry `LibraryService` writes for an item with no URL or file. */
  private indexItem(item: LibraryItem): void {
    this.library.indexItem({
      itemId: item.id,
      projectId: item.projectId,
      title: item.title,
      summary: item.summary,
      body: item.body,
      tags: item.tags,
      extractedText: ''
    })
  }
}
