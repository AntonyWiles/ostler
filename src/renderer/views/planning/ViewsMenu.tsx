import { useState } from 'react'
import type { SavedViewScope, TaskView } from '../../hooks/useTaskFilters'
import {
  Button,
  Dialog,
  InlineAlert,
  Menu,
  Radio,
  RadioGroup,
  TextField,
  type MenuEntry
} from '../../ui'
import { Check, Layers, Pencil, Plus, RefreshCw, Trash2, Undo2 } from '../../ui/icons'
import { pinEntries, usePins } from '../../pins/PinsProvider'
import { t } from '@shared/i18n'

/**
 * The Views menu every task view's toolbar starts with (P5.7): the default
 * view, the project's saved views and those for all projects, "Save view…",
 * "Update '<name>'" and "Revert changes" while the showing view has changed,
 * Rename, Delete (with undo) and "Set as default for this project". Names are
 * asked for in a small dialog (Electron has no prompt()), the same one
 * Customise board uses.
 */
export function ViewsMenu({ view }: { view: TaskView<object> }) {
  const [naming, setNaming] = useState<null | 'save' | 'rename'>(null)
  const [error, setError] = useState<string | null>(null)
  const active = view.activeView
  const pins = usePins()
  const run = async (action: () => Promise<void>) => {
    setError(null)
    try {
      await action()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('tasks:viewsMenu.didNotWorkTry'))
      return false
    }
  }

  const radio = (saved: (typeof view.views)[number]) => ({
    label: saved.name,
    checked: active?.id === saved.id,
    checkKind: 'radio' as const,
    onSelect: () => view.selectView(saved.id)
  })
  const projectViews = view.views.filter((saved) => saved.projectId !== null)
  const sharedViews = view.views.filter((saved) => saved.projectId === null)

  const items: MenuEntry[] = [
    {
      type: 'group',
      label: t('tasks:viewsMenu.views'),
      items: [
        {
          label: t('tasks:viewsMenu.defaultView'),
          checked: active === null,
          checkKind: 'radio' as const,
          onSelect: () => view.selectView(null)
        },
        ...projectViews.map(radio)
      ]
    },
    ...(sharedViews.length > 0
      ? [
          {
            type: 'group' as const,
            label: t('tasks:viewsMenu.allProjects'),
            items: sharedViews.map(radio)
          }
        ]
      : []),
    { type: 'separator' },
    {
      label: t('tasks:viewsMenu.saveView2'),
      icon: Plus,
      onSelect: () => {
        setError(null)
        setNaming('save')
      }
    },
    ...(active && view.isChanged
      ? [
          {
            label: t('tasks:viewsMenu.update', { activeName: active.name }),
            icon: RefreshCw,
            onSelect: () => void run(view.updateActive)
          },
          { label: t('tasks:viewsMenu.revert'), icon: Undo2, onSelect: view.revert }
        ]
      : []),
    ...(active
      ? [
          {
            label: t('tasks:viewsMenu.rename'),
            icon: Pencil,
            onSelect: () => {
              setError(null)
              setNaming('rename')
            }
          },
          {
            label: t('tasks:viewsMenu.delete', { activeName: active.name }),
            icon: Trash2,
            tone: 'danger' as const,
            onSelect: () => void run(() => view.remove(active.id))
          }
        ]
      : []),
    {
      label: t('tasks:viewsMenu.setDefaultProject'),
      icon: Check,
      hint: t('tasks:viewsMenu.openViewWhatShowing'),
      onSelect: () => void run(view.setAsDefault)
    },
    // Pins (N5.2a): the saved view on show.
    ...(active?.projectId
      ? pinEntries(pins, {
          kind: 'saved-view',
          targetId: active.id,
          projectId: active.projectId,
          title: active.name
        })
      : [])
  ]

  const label = active ? active.name : t('tasks:viewsMenu.defaultView')
  return (
    <>
      <Menu
        label={t('tasks:viewsMenu.views')}
        items={items}
        renderTrigger={(trigger) => (
          <Button
            {...trigger}
            size="sm"
            variant="ghost"
            icon={Layers}
            aria-label={
              view.isChanged
                ? t('tasks:viewsMenu.ariaChanged', { label })
                : t('tasks:viewsMenu.aria', { label })
            }
            className="task-toolbar__views"
          >
            {view.isChanged ? t('tasks:viewsMenu.labelChanged', { label }) : label}
          </Button>
        )}
      />
      {error && naming === null && (
        <InlineAlert tone="danger" className="task-toolbar__views-error">
          {error}
        </InlineAlert>
      )}
      <SavedViewNameDialog
        mode={naming}
        initialName={naming === 'rename' ? (active?.name ?? '') : ''}
        onClose={() => setNaming(null)}
        onSubmit={(name, scope) =>
          naming === 'rename' && active ? view.rename(active.id, name) : view.saveAs(name, scope)
        }
      />
    </>
  )
}

/**
 * Asks for a saved view's name: "Save view" (with where it is kept, this
 * project or all projects) or "Rename view". The Views menu and Customise
 * board both use it, so they ask the same way.
 */
export function SavedViewNameDialog({
  mode,
  initialName,
  onClose,
  onSubmit
}: {
  mode: null | 'save' | 'rename'
  initialName: string
  onClose: () => void
  onSubmit: (name: string, scope: SavedViewScope) => Promise<void>
}) {
  return mode === null ? null : (
    <NameDialog mode={mode} initialName={initialName} onClose={onClose} onSubmit={onSubmit} />
  )
}

function NameDialog({
  mode,
  initialName,
  onClose,
  onSubmit
}: {
  mode: 'save' | 'rename'
  initialName: string
  onClose: () => void
  onSubmit: (name: string, scope: SavedViewScope) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [scope, setScope] = useState<SavedViewScope>('project')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    try {
      await onSubmit(trimmed, scope)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('tasks:viewsMenu.didNotWorkTry'))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={mode === 'rename' ? t('tasks:viewsMenu.renameView') : t('tasks:viewsMenu.saveView')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('tasks:viewsMenu.cancel')}
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
            {mode === 'rename' ? t('tasks:viewsMenu.rename2') : t('tasks:viewsMenu.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextField
          label={t('tasks:viewsMenu.name')}
          data-autofocus
          maxLength={80}
          value={name}
          error={error ?? undefined}
          hint={mode === 'save' ? t('tasks:viewsMenu.savesFilterSearchView') : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {mode === 'save' && (
          <RadioGroup legend={t('tasks:viewsMenu.keepFor')} orientation="horizontal">
            <Radio
              name="saved-view-scope"
              label={t('tasks:viewsMenu.thisProject')}
              checked={scope === 'project'}
              onChange={() => setScope('project')}
            />
            <Radio
              name="saved-view-scope"
              label={t('tasks:viewsMenu.allProjects')}
              checked={scope === 'allProjects'}
              onChange={() => setScope('allProjects')}
            />
          </RadioGroup>
        )}
      </form>
    </Dialog>
  )
}
