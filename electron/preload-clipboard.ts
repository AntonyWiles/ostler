import { IPC_CHANNELS } from '@shared/ostler-api/ipc-types'
import { clipboardKey, type ClipboardKeyPress } from '@shared/off-screen-clipboard'

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

// The few page objects this uses, typed here: main's code is built without the DOM library.
interface PageElement {
  tagName: string
  isContentEditable?: boolean
  dispatchEvent(event: unknown): boolean
}
interface PageField extends PageElement {
  type: string
  value: string
  selectionStart: number | null
  selectionEnd: number | null
  readOnly: boolean
  disabled: boolean
}
interface PageData {
  setData(type: string, value: string): void
  getData(type: string): string
}
interface Page {
  document: {
    activeElement: PageElement | null
    body: PageElement
    getSelection(): { toString(): string } | null
    execCommand(command: string, showUi?: boolean, value?: string): boolean
  }
  addEventListener(
    type: 'keydown',
    listener: (event: ClipboardKeyPress & { preventDefault(): void }) => void,
    capture: boolean
  ): void
  DataTransfer: new () => PageData
  ClipboardEvent: new (
    type: string,
    init: { clipboardData: PageData; bubbles: boolean; cancelable: boolean; composed: boolean }
  ) => unknown
}

const page = globalThis as unknown as Page

function clipboardEvent(type: 'copy' | 'cut' | 'paste', data: PageData): unknown {
  return new page.ClipboardEvent(type, {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
    composed: true
  })
}

const isField = (element: PageElement): element is PageField =>
  element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'

/** What a copy or cut takes: the page's own data if it fills the event, else the selection. */
function takeSelection(cut: boolean): string {
  const { document } = page
  const target = document.activeElement ?? document.body
  const data = new page.DataTransfer()
  if (!target.dispatchEvent(clipboardEvent(cut ? 'cut' : 'copy', data))) {
    return data.getData('text/plain')
  }
  const field = isField(target) ? target : null
  // Chromium never copies a password.
  if (field && field.type === 'password') return ''
  const text =
    field && field.selectionStart !== null
      ? field.value.slice(field.selectionStart, field.selectionEnd ?? field.selectionStart)
      : String(document.getSelection() ?? '')
  const editable = field ? !field.readOnly && !field.disabled : target.isContentEditable === true
  if (cut && text && editable) document.execCommand('delete')
  return text
}

/** A paste of `text`: a `paste` event carrying it, and unless the page took it, the text typed in. */
function pasteText(text: string): void {
  const { document } = page
  const target = document.activeElement ?? document.body
  const data = new page.DataTransfer()
  data.setData('text/plain', text)
  if (target.dispatchEvent(clipboardEvent('paste', data)) && text) {
    document.execCommand('insertText', false, text)
  }
}

/**
 * Off screen, the copy, cut and paste keys in this page use Ostler's own
 * clipboard (main's `copyText`), never the Windows one: the key's default
 * (Chromium's copy or paste) is prevented, and the same is done here, as
 * Chromium would do it, through main. Copying nothing leaves the clipboard as
 * it was. Installed by the preload only when main passes `OFF_SCREEN_ARGUMENT`.
 */
export function keepClipboardKeysInOstler(invoke: Invoke): void {
  page.addEventListener(
    'keydown',
    (event) => {
      const action = clipboardKey(event)
      if (!action) return
      event.preventDefault()
      if (action === 'paste') {
        void invoke(IPC_CHANNELS.READ_OFF_SCREEN_CLIPBOARD).then((result) => {
          const read = result as { ok: boolean; value?: unknown }
          if (read.ok && typeof read.value === 'string') pasteText(read.value)
        })
        return
      }
      const text = takeSelection(action === 'cut')
      if (text) void invoke(IPC_CHANNELS.COPY_TEXT, text)
    },
    true
  )
}
