import { t } from '@shared/i18n'
import type { ItemLinkInfo } from '@shared/ostler-api'
import { taskStatusLabel } from '@shared/task-labels'
import { mindMapPlaces, type MindMapPlace } from '@shared/whiteboard/mind-map'
import { readingOrder } from '@shared/whiteboard/outline'
import {
  isLinkable,
  objectLinkTarget,
  type MindmapObject,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import { itemKindLabel } from '../../ui/ItemLinkChip'

/** D14: a spoken name holds at most this many characters of an object's own text. */
export const NAME_TEXT_LIMIT = 80

/** Text as one line, whitespace collapsed, cut to NAME_TEXT_LIMIT characters. */
function spoken(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(line)
  return chars.length > NAME_TEXT_LIMIT
    ? `${chars.slice(0, NAME_TEXT_LIMIT).join('').trimEnd()}…`
    : line
}

/** The first line of an object's text, as a connector names its ends; '' when it has none. */
function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? ''
  return spoken(line)
}

function cardTitle(
  object: WhiteboardObjectInput,
  links: ReadonlyMap<string, ItemLinkInfo> | undefined
): string {
  const target = objectLinkTarget(object)
  const info = object.link === null ? undefined : links?.get(object.link)
  if (info && !info.exists) return t('common:itemLinks.deletedItem')
  if (info?.title) return spoken(info.title)
  return target ? itemKindLabel(target.kind) : ''
}

/** Every node's place in its map, worked out once per board state (`byId` is one state). */
const placesByBoard = new WeakMap<
  ReadonlyMap<string, WhiteboardObjectInput>,
  Map<string, MindMapPlace>
>()

function placeOf(
  node: MindmapObject,
  byId: ReadonlyMap<string, WhiteboardObjectInput>
): MindMapPlace | undefined {
  let places = placesByBoard.get(byId)
  if (!places) {
    places = mindMapPlaces([...byId.values()])
    placesByBoard.set(byId, places)
  }
  return places.get(node.id)
}

/**
 * A mind-map node (prompt 14): "Central idea: Launch plan, 3 branches", or
 * "Idea: Venue, level 1, 2 of 3, 1 branch". A node in no map (in a parent
 * cycle) is just "Idea: …".
 */
function ideaName(node: MindmapObject, byId: ReadonlyMap<string, WhiteboardObjectInput>) {
  const text = spoken(node.text)
  const place = placeOf(node, byId)
  if (place?.depth === 0) {
    const name = text
      ? t('library:whiteboard.names.centralIdea', { text })
      : t('library:whiteboard.names.centralIdeaEmpty')
    return withBranches(name, place.branches)
  }
  const name = text
    ? t('library:whiteboard.names.idea', { text })
    : t('library:whiteboard.names.ideaEmpty')
  if (!place) return name
  return withBranches(
    t('library:whiteboard.names.ideaPlace', {
      name,
      level: place.depth,
      position: place.position,
      total: place.siblings
    }),
    place.branches
  )
}

function withBranches(name: string, count: number): string {
  return count === 0 ? name : t('library:whiteboard.names.branches', { name, count })
}

type Links = ReadonlyMap<string, ItemLinkInfo> | undefined
type Pictures = ReadonlyMap<string, string> | undefined

/**
 * The name of an object on its own, without its number, link or ", in a
 * group". A connector names its ends by their full own names, numbers too.
 */
function baseName(
  object: WhiteboardObjectInput,
  byId: ReadonlyMap<string, WhiteboardObjectInput>,
  links: Links,
  pictures: Pictures
): string {
  const text = spoken(object.text)
  switch (object.kind) {
    case 'note':
      return text
        ? t('library:whiteboard.names.note', { text })
        : t('library:whiteboard.names.noteEmpty')
    case 'text':
      return text
        ? t('library:whiteboard.names.text', { text })
        : t('library:whiteboard.names.textEmpty')
    case 'shape': {
      const shape = t(`library:whiteboard.shapes.${object.data.shape}`)
      return text ? t('library:whiteboard.names.shape', { shape, text }) : shape
    }
    case 'connector': {
      const end = (objectId: string | null) => {
        const target = objectId === null ? undefined : byId.get(objectId)
        if (!target || target.id === object.id) return t('library:whiteboard.names.aPoint')
        const line = firstLine(target.text)
        if (line) return line
        // An end stuck to another connector is named as a point: no names within names.
        return target.kind === 'connector'
          ? t('library:whiteboard.names.aPoint')
          : ownName(target, byId, links, pictures)
      }
      const { from, to, startHead, endHead } = object.data
      const key = startHead === 'arrow' || endHead === 'arrow' ? 'arrow' : 'line'
      return t(`library:whiteboard.names.${key}`, {
        from: end(from.objectId),
        to: end(to.objectId)
      })
    }
    case 'pen':
      return object.data.marker
        ? t('library:whiteboard.names.markerDrawing')
        : t('library:whiteboard.names.drawing')
    case 'image': {
      const title = object.data.imageItemId && pictures?.get(object.data.imageItemId)
      return title
        ? t('library:whiteboard.names.pictureTitled', { title: spoken(title) })
        : t('library:whiteboard.names.picture')
    }
    case 'card':
      return t('library:whiteboard.names.card', { title: cardTitle(object, links) })
    case 'frame':
      return text
        ? t('library:whiteboard.names.frame', { title: text })
        : t('library:whiteboard.names.frameEmpty')
    case 'mindmap':
      return ideaName(object, byId)
  }
}

/** Each object's number among those whose names would be the same, for one board state. */
interface Numbers {
  links: Links
  pictures: Pictures
  numbers: Map<string, number>
}

const numbersByBoard = new WeakMap<ReadonlyMap<string, WhiteboardObjectInput>, Numbers>()

/** Numbers each run of the same name 1, 2, 3… in reading order; a name only one object has, none. */
function numberRuns(
  objects: readonly WhiteboardObjectInput[],
  name: (object: WhiteboardObjectInput) => string,
  into: Map<string, number>
) {
  const byName = new Map<string, string[]>()
  for (const object of objects) {
    const key = name(object)
    byName.set(key, [...(byName.get(key) ?? []), object.id])
  }
  for (const ids of byName.values()) {
    if (ids.length > 1) ids.forEach((id, index) => into.set(id, index + 1))
  }
}

function numberOf(
  object: WhiteboardObjectInput,
  byId: ReadonlyMap<string, WhiteboardObjectInput>,
  links: Links,
  pictures: Pictures
): number | undefined {
  let found = numbersByBoard.get(byId)
  if (!found || found.links !== links || found.pictures !== pictures) {
    const numbers = new Map<string, number>()
    found = { links, pictures, numbers }
    numbersByBoard.set(byId, found)
    const ordered = readingOrder([...byId.values()])
    // Objects first, then connectors, which are named by their (numbered) ends.
    numberRuns(
      ordered.filter((entry) => entry.kind !== 'connector'),
      (entry) => baseName(entry, byId, links, pictures),
      numbers
    )
    numberRuns(
      ordered.filter((entry) => entry.kind === 'connector'),
      (entry) => baseName(entry, byId, links, pictures),
      numbers
    )
  }
  return found.numbers.get(object.id)
}

/**
 * The name of an object on its own, without its link or ", in a group": its
 * base name, numbered when other objects on the board would have the same
 * one ("Rectangle 2"), so no two read alike.
 */
function ownName(
  object: WhiteboardObjectInput,
  byId: ReadonlyMap<string, WhiteboardObjectInput>,
  links: Links,
  pictures: Pictures
): string {
  const name = baseName(object, byId, links, pictures)
  const number = byId.has(object.id) ? numberOf(object, byId, links, pictures) : undefined
  return number === undefined ? name : t('library:whiteboard.names.numbered', { name, number })
}

/**
 * The spoken name of an object on a whiteboard (plan `docs/plans/whiteboards/`,
 * prompt 05, D14): its kind and its words, such as "Note: Buy milk" or "Arrow
 * from Start to End", with ", in a group" when it is grouped. Long text is cut
 * to its first 80 characters. Objects whose names would be the same are
 * numbered in reading order ("Rectangle 2"). `byId` is the board: it numbers
 * them and names a connector's ends; `links` gives a
 * card its item's title; `pictures` gives a picture its Library title
 * ("Picture: Site photo"), by image item id (prompt 11).
 */
export function objectName(
  object: WhiteboardObjectInput,
  byId: ReadonlyMap<string, WhiteboardObjectInput>,
  links?: ReadonlyMap<string, ItemLinkInfo>,
  pictures?: ReadonlyMap<string, string>
): string {
  const name = withLink(object, ownName(object, byId, links, pictures), links)
  return object.groupId === null ? name : t('library:whiteboard.names.inGroup', { name })
}

/** A web address's host ("example.com"); the address itself if it has none. */
function webHost(link: string): string {
  try {
    return new URL(link).hostname || link
  } catch {
    return link
  }
}

/**
 * `name` with the object's link after it (prompt 12): ", linked to task Fix
 * the header, In progress", ", linked to a deleted item" or ", linked to
 * example.com". A card's link is already its name.
 */
function withLink(
  object: WhiteboardObjectInput,
  name: string,
  links: ReadonlyMap<string, ItemLinkInfo> | undefined
): string {
  if (object.link === null || object.kind === 'card' || !isLinkable(object)) return name
  const target = objectLinkTarget(object)
  if (!target) return t('library:whiteboard.names.linkedWeb', { name, host: webHost(object.link) })
  const info = links?.get(object.link)
  if (info && !info.exists) return t('library:whiteboard.names.linkedDeleted', { name })
  const kind = t(`library:whiteboard.linkKinds.${target.kind}`)
  if (!info?.title) return t('library:whiteboard.names.linkedUntitled', { name, kind })
  const title = spoken(info.title)
  return target.kind === 'task' && info.status
    ? t('library:whiteboard.names.linkedStatus', {
        name,
        kind,
        title,
        status: taskStatusLabel(info.status)
      })
    : t('library:whiteboard.names.linked', { name, kind, title })
}
