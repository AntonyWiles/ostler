// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ostler-api/ipc-types'
import { clipboardKey } from '../../src/shared/off-screen-clipboard'
import { keepClipboardKeysInOstler } from '../../electron/preload-clipboard'

/**
 * Off screen the preload keeps the copy, cut and paste keys from Chromium
 * (which would write or read the Windows clipboard) and does them through
 * main's own clipboard instead. jsdom has no clipboard events or editing
 * commands, so small stand-ins record what the page was asked to do.
 */

class FakeDataTransfer {
  private data = new Map<string, string>()
  setData(type: string, value: string) {
    this.data.set(type, value)
  }
  getData(type: string) {
    return this.data.get(type) ?? ''
  }
}

class FakeClipboardEvent extends Event {
  readonly clipboardData: FakeDataTransfer
  constructor(type: string, init: EventInit & { clipboardData: FakeDataTransfer }) {
    super(type, init)
    this.clipboardData = init.clipboardData
  }
}

const invoke = vi.fn(async (channel: string, ..._args: unknown[]) =>
  channel === IPC_CHANNELS.READ_OFF_SCREEN_CLIPBOARD
    ? { ok: true, value: 'Book the venue' }
    : { ok: true, value: undefined }
)
const commands: [string, string | undefined][] = []

beforeAll(() => {
  vi.stubGlobal('DataTransfer', FakeDataTransfer)
  vi.stubGlobal('ClipboardEvent', FakeClipboardEvent)
  document.execCommand = (command: string, _ui?: boolean, value?: string) => {
    commands.push([command, value])
    return true
  }
  keepClipboardKeysInOstler(invoke)
})

afterEach(() => {
  invoke.mockClear()
  commands.length = 0
  document.body.innerHTML = ''
})

function field(value: string, type = 'text'): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  input.value = value
  document.body.append(input)
  input.focus()
  input.setSelectionRange(0, value.length)
  return input
}

function press(key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  document.activeElement!.dispatchEvent(event)
  return event.defaultPrevented
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('off screen, the clipboard keys in a page', () => {
  it("copy the selection to Ostler's own clipboard, never Chromium's", () => {
    field('Robin')
    expect(press('c', { ctrlKey: true })).toBe(true)
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.COPY_TEXT, 'Robin')
    expect(commands).toEqual([])
  })

  it('cut the selection and delete it', () => {
    field('Grace')
    expect(press('x', { ctrlKey: true })).toBe(true)
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.COPY_TEXT, 'Grace')
    expect(commands).toEqual([['delete', undefined]])
  })

  it("paste Ostler's own clipboard, through a paste event the page may take", async () => {
    field('')
    expect(press('v', { ctrlKey: true })).toBe(true)
    await flush()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.READ_OFF_SCREEN_CLIPBOARD)
    expect(commands).toEqual([['insertText', 'Book the venue']])

    // A page that handles the paste itself gets the text in its event instead.
    const taken: string[] = []
    const grid = field('')
    grid.addEventListener('paste', (event) => {
      taken.push((event as unknown as FakeClipboardEvent).clipboardData.getData('text/plain'))
      event.preventDefault()
    })
    commands.length = 0
    press('Insert', { shiftKey: true })
    await flush()
    expect(taken).toEqual(['Book the venue'])
    expect(commands).toEqual([])
  })

  it('copy nothing from a password, or when nothing is selected', () => {
    field('s3cret', 'password')
    expect(press('c', { ctrlKey: true })).toBe(true)
    field('')
    expect(press('c', { ctrlKey: true })).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('leave every other key to the page', () => {
    field('Robin')
    expect(press('k', { ctrlKey: true })).toBe(false)
    expect(press('c')).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('clipboardKey', () => {
  const key = (value: string, modifiers: Partial<KeyboardEventInit> = {}) =>
    clipboardKey({
      key: value,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ...modifiers
    })

  it('knows the keys Chromium copies, cuts and pastes with, and no others', () => {
    expect(key('c', { ctrlKey: true })).toBe('copy')
    expect(key('C', { ctrlKey: true })).toBe('copy')
    expect(key('Insert', { ctrlKey: true })).toBe('copy')
    expect(key('x', { ctrlKey: true })).toBe('cut')
    expect(key('Delete', { shiftKey: true })).toBe('cut')
    expect(key('v', { ctrlKey: true })).toBe('paste')
    expect(key('V', { ctrlKey: true, shiftKey: true })).toBe('paste')
    expect(key('Insert', { shiftKey: true })).toBe('paste')
    expect(key('c')).toBeNull()
    expect(key('C', { ctrlKey: true, shiftKey: true })).toBeNull()
    expect(key('c', { ctrlKey: true, altKey: true })).toBeNull()
    expect(key('k', { ctrlKey: true })).toBeNull()
  })
})
