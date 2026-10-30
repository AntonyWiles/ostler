import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { formatIsoDate } from '@shared/dates'
import { formatMoney, moneyInputText, parseMoney, type CurrencyCode } from '@shared/money'
import {
  groupBySupplier,
  MAX_SHOPPING_NAME,
  MAX_SHOPPING_QUANTITY,
  MAX_SHOPPING_UNIT,
  quantityText,
  readShoppingLine,
  stillToBuy,
  type ShoppingInput,
  type ShoppingItem
} from '@shared/shopping'
import { t } from '@shared/i18n'
import type { ProjectViewProps } from '../../navigation/view-props'
import {
  Collapse,
  useReorderMotion,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  InlineAlert,
  Select,
  TextField,
  useAnnounce,
  useToast
} from '../../ui'
import {
  chevronClass,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2
} from '../../ui/icons'
import { useMoneySummary } from '../../costs/useMoney'
import { useContacts } from '../../contacts/useContacts'
import { useShopping } from '../../shopping/useShopping'
import { BuyDialog } from '../../shopping/BuyDialog'
import '../../costs/costs.css'
import '../../shopping/shopping.css'

interface Draft {
  name: string
  quantity: string
  unit: string
  estimate: string
  contactId: string
  workItemId: string
}

function draftOf(item: ShoppingItem, currency: CurrencyCode): Draft {
  return {
    name: item.name,
    quantity: String(item.quantity),
    unit: item.unit,
    estimate: item.estimate === null ? '' : moneyInputText(item.estimate, currency),
    contactId: item.contactId ?? '',
    workItemId: item.workItemId ?? ''
  }
}

/** A quantity typed in the edit row, with a dot or a comma. */
function draftQuantity(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() && Number.isFinite(value) && value > 0 && value <= MAX_SHOPPING_QUANTITY
    ? value
    : null
}

/**
 * The Shopping list (N6.3b), from the project's More menu: what to buy,
 * grouped by supplier, each with a tick box, quantity, name, estimate and
 * task. Add item reads one line ("3 packs wall plugs £4.50"); ticking an item
 * asks for the price paid and makes a paid cost; bought items fold away
 * under Bought. Keyboard: ↑ and ↓ move between items, Alt+↑ and Alt+↓ move
 * an item, Enter edits, Space ticks and Delete deletes, with Undo.
 */
export function ShoppingView({ project, ws }: ProjectViewProps) {
  const { toast, toastUndo } = useToast()
  const announce = useAnnounce()
  const { items, error, reload } = useShopping(project.id)
  const { summary, reload: reloadSummary } = useMoneySummary(project.id)
  const { contacts } = useContacts()
  const [line, setLine] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [buying, setBuying] = useState<ShoppingItem | null>(null)
  const [showBought, setShowBought] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const viewRef = useRef<HTMLElement | null>(null)
  useReorderMotion(viewRef)

  const taskTitles = useMemo(
    () => new Map(ws.workItems.map((item) => [item.id, item.title])),
    [ws.workItems]
  )
  const currency = summary?.currency
  if (!currency || !items) {
    return error ? <InlineAlert tone="danger">{error}</InlineAlert> : null
  }
  const money = (minor: number) => formatMoney(minor, currency)
  const toBuy = items.filter((item) => item.costId === null)
  const bought = items.filter((item) => item.costId !== null)
  const groups = groupBySupplier(toBuy)
  // The rows in the order they are drawn, for ↑ and ↓.
  const shown = groups.flatMap((group) => group.items)

  const refresh = async () => {
    await Promise.all([reload(), reloadSummary()])
  }
  const focusRow = (id: string) => requestAnimationFrame(() => rowRefs.current.get(id)?.focus())

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!line.trim()) return
    const read = readShoppingLine(line, currency)
    const result = await window.ostlerAPI.createShoppingItem(project.id, read)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setLine('')
    setFormError(null)
    await refresh()
    toastUndo(t('projects:shopping.added', { name: result.value.name }), () =>
      window.ostlerAPI.deleteShoppingItem(project.id, result.value.id).then(() => refresh())
    )
  }

  const update = async (item: ShoppingItem, input: ShoppingInput, undoTitle?: string) => {
    const result = await window.ostlerAPI.updateShoppingItem(project.id, item.id, input)
    if (!result.ok) {
      toast({ title: t('projects:shopping.couldNotSave'), body: result.error, tone: 'danger' })
      return false
    }
    await refresh()
    if (undoTitle) {
      const before = result.value.before
      toastUndo(undoTitle, () =>
        window.ostlerAPI
          .updateShoppingItem(project.id, before.id, {
            name: before.name,
            quantity: before.quantity,
            unit: before.unit,
            estimate: before.estimate,
            contactId: before.contactId,
            workItemId: before.workItemId
          })
          .then(() => refresh())
      )
    }
    return true
  }

  /** Moves an item one place up or down within its supplier's group. */
  const move = async (item: ShoppingItem, step: -1 | 1) => {
    const group = groups.find((entry) => entry.contactId === item.contactId)
    if (!group) return
    const index = group.items.findIndex((entry) => entry.id === item.id)
    const neighbour = group.items[index + step]
    if (!neighbour) return
    const placed = await update(
      item,
      step < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id }
    )
    if (!placed) return
    focusRow(item.id)
    // Focus stays on the row, so a screen reader would hear nothing of the move.
    announce(t('projects:shopping.moved', { name: item.name }))
  }

  const remove = async (item: ShoppingItem) => {
    const result = await window.ostlerAPI.deleteShoppingItem(project.id, item.id)
    if (!result.ok) {
      toast({ title: t('projects:shopping.couldNotDelete'), body: result.error, tone: 'danger' })
      return
    }
    await refresh()
    toastUndo(t('projects:shopping.deleted', { name: item.name }), () =>
      window.ostlerAPI.restoreShoppingItem(project.id, result.value).then(() => refresh())
    )
  }

  const toggle = async (item: ShoppingItem) => {
    if (item.costId === null) {
      setBuying(item)
      return
    }
    const result = await window.ostlerAPI.unbuyShoppingItem(project.id, item.id)
    if (!result.ok) {
      toast({ title: t('projects:shopping.couldNotBuy'), body: result.error, tone: 'danger' })
      return
    }
    await refresh()
    toastUndo(t('projects:shopping.unboughtNamed', { name: item.name }), () =>
      window.ostlerAPI
        .rebuyShoppingItem(project.id, item.id, result.value.cost)
        .then(() => refresh())
    )
  }

  const startEditing = (item: ShoppingItem) => {
    setEditing(item.id)
    setDraft(draftOf(item, currency))
    setFormError(null)
  }

  const stopEditing = (focusId?: string) => {
    setEditing(null)
    setDraft(null)
    setFormError(null)
    if (focusId) focusRow(focusId)
  }

  const saveDraft = async (item: ShoppingItem) => {
    if (!draft) return
    if (!draft.name.trim()) return setFormError(t('projects:shopping.nameRequired'))
    const quantity = draftQuantity(draft.quantity)
    if (quantity === null) return setFormError(t('projects:shopping.quantityInvalid'))
    const estimate = draft.estimate.trim() ? parseMoney(draft.estimate, currency) : null
    if (draft.estimate.trim() && estimate === null)
      return setFormError(t('projects:shopping.estimateInvalid'))
    const saved = await update(
      item,
      {
        name: draft.name,
        quantity,
        unit: draft.unit,
        estimate,
        contactId: draft.contactId || null,
        workItemId: draft.workItemId || null
      },
      t('projects:shopping.edited')
    )
    if (saved) stopEditing(item.id)
  }

  const onRowKey = (event: KeyboardEvent<HTMLLIElement>, item: ShoppingItem) => {
    if (event.target !== event.currentTarget) return
    const index = shown.findIndex((entry) => entry.id === item.id)
    const focusAt = (to: number) => {
      const next = shown[Math.max(0, Math.min(shown.length - 1, to))]
      if (next) rowRefs.current.get(next.id)?.focus()
    }
    if (event.altKey && event.key === 'ArrowUp') void move(item, -1)
    else if (event.altKey && event.key === 'ArrowDown') void move(item, 1)
    else if (event.key === 'ArrowDown') focusAt(index + 1)
    else if (event.key === 'ArrowUp') focusAt(index - 1)
    else if (event.key === 'Home') focusAt(0)
    else if (event.key === 'End') focusAt(shown.length - 1)
    else if (event.key === 'Enter' || event.key === 'F2') startEditing(item)
    else if (event.key === ' ') void toggle(item)
    else if (event.key === 'Delete') void remove(item)
    else return
    event.preventDefault()
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, target: ShoppingItem) => {
    event.preventDefault()
    const id = dragging
    setDragging(null)
    if (!id || id === target.id) return
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    void update(item, { beforeId: target.id }).then((placed) => {
      if (placed) announce(t('projects:shopping.moved', { name: item.name }))
    })
  }

  const editRow = (item: ShoppingItem) =>
    draft && (
      <li
        key={item.id}
        className="shopping-row shopping-row--editing"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !(event.target instanceof HTMLSelectElement)) {
            event.preventDefault()
            void saveDraft(item)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            stopEditing(item.id)
          }
        }}
      >
        <TextField
          label={t('projects:shopping.quantity')}
          inputMode="decimal"
          className="shopping-row__quantity-field"
          value={draft.quantity}
          onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
        />
        <TextField
          label={t('projects:shopping.unit')}
          maxLength={MAX_SHOPPING_UNIT}
          className="shopping-row__unit-field"
          value={draft.unit}
          onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
        />
        <TextField
          label={t('projects:shopping.name')}
          autoFocus
          maxLength={MAX_SHOPPING_NAME}
          className="shopping-row__name-field"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <TextField
          label={t('projects:shopping.estimateIn', { currency })}
          inputMode="decimal"
          className="shopping-row__estimate-field"
          value={draft.estimate}
          onChange={(event) => setDraft({ ...draft, estimate: event.target.value })}
        />
        <Select
          label={t('projects:shopping.supplier')}
          size="sm"
          value={draft.contactId}
          onChange={(event) => setDraft({ ...draft, contactId: event.target.value })}
          options={[
            { value: '', label: t('projects:shopping.noSupplier') },
            ...(contacts ?? []).map((contact) => ({ value: contact.id, label: contact.name }))
          ]}
        />
        <Select
          label={t('projects:shopping.task')}
          size="sm"
          value={draft.workItemId}
          onChange={(event) => setDraft({ ...draft, workItemId: event.target.value })}
          options={[
            { value: '', label: t('projects:shopping.noTask') },
            ...ws.workItems.map((task) => ({ value: task.id, label: task.title }))
          ]}
        />
        <div className="shopping-row__actions">
          <Button size="sm" variant="primary" onClick={() => void saveDraft(item)}>
            {t('projects:shopping.save')}
          </Button>
          <Button size="sm" onClick={() => stopEditing(item.id)}>
            {t('projects:shopping.cancel')}
          </Button>
        </div>
      </li>
    )

  const row = (item: ShoppingItem, tabbable: boolean) => {
    if (editing === item.id) return editRow(item)
    const task = item.workItemId ? taskTitles.get(item.workItemId) : null
    const isBought = item.costId !== null
    return (
      <li
        key={item.id}
        data-motion-key={item.id}
        ref={(element) => {
          if (element) rowRefs.current.set(item.id, element)
          else rowRefs.current.delete(item.id)
        }}
        className="shopping-row"
        data-bought={isBought || undefined}
        data-dragging={dragging === item.id || undefined}
        tabIndex={tabbable ? 0 : -1}
        aria-label={t('projects:shopping.rowLabel', {
          quantity: quantityText(item),
          name: item.name,
          estimate:
            item.estimate === null ? t('projects:shopping.noEstimate') : money(item.estimate)
        })}
        draggable={!isBought}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          setDragging(item.id)
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(event) => {
          if (dragging) event.preventDefault()
        }}
        onDrop={(event) => onDrop(event, item)}
        onKeyDown={isBought ? undefined : (event) => onRowKey(event, item)}
        onDoubleClick={isBought ? undefined : () => startEditing(item)}
      >
        {!isBought && (
          <span className="shopping-row__grip" aria-hidden="true">
            <GripVertical size={14} />
          </span>
        )}
        <Checkbox
          label={null}
          aria-label={t('projects:shopping.markBought', { name: item.name })}
          checked={isBought}
          onChange={() => void toggle(item)}
        />
        <span className="shopping-row__quantity costs-amount">{quantityText(item)}</span>
        <span className="shopping-row__name">{item.name}</span>
        {task && <span className="shopping-row__task">{task}</span>}
        <span className="shopping-row__estimate costs-amount">
          {isBought
            ? t('projects:shopping.boughtOn', {
                date: formatIsoDate(item.boughtOn ?? ''),
                price: money(item.pricePaid ?? 0)
              })
            : item.estimate === null
              ? ''
              : money(item.estimate)}
        </span>
        <span className="shopping-row__actions">
          {!isBought && (
            <IconButton
              size="sm"
              icon={Pencil}
              label={t('projects:shopping.editNamed', { name: item.name })}
              onClick={() => startEditing(item)}
            />
          )}
          <IconButton
            size="sm"
            icon={Trash2}
            label={t('projects:shopping.deleteNamed', { name: item.name })}
            onClick={() => void remove(item)}
          />
        </span>
      </li>
    )
  }

  return (
    <section ref={viewRef} className="shopping-view" aria-label={t('projects:shopping.shopping')}>
      <p className="shopping-view__intro">{t('projects:shopping.intro')}</p>
      <form className="shopping-view__add" onSubmit={(event) => void add(event)}>
        <TextField
          label={t('projects:shopping.addLabel')}
          hint={t('projects:shopping.addHint')}
          placeholder={t('projects:shopping.addPlaceholder', { price: money(450) })}
          maxLength={MAX_SHOPPING_NAME + 40}
          value={line}
          onChange={(event) => setLine(event.target.value)}
        />
        <Button type="submit" variant="primary" icon={Plus} disabled={!line.trim()}>
          {t('projects:shopping.add')}
        </Button>
      </form>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
      {items.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={t('projects:shopping.noItems')}
          description={t('projects:shopping.noItemsDescription')}
        />
      ) : (
        <>
          <p className="shopping-view__hint">{t('projects:shopping.moveHint')}</p>
          {toBuy.length === 0 && <p>{t('projects:shopping.allBought')}</p>}
          {groups.map((group) => {
            const name = group.name ?? t('projects:shopping.noSupplier')
            return (
              <section
                key={group.contactId ?? ''}
                className="shopping-group"
                aria-label={t('projects:shopping.supplierGroup', {
                  supplier: name,
                  count: group.items.length
                })}
              >
                <h3 className="shopping-group__title">{name}</h3>
                <ul className="shopping-list" aria-label={name}>
                  {group.items.map((item) => row(item, item.id === shown[0]?.id))}
                </ul>
              </section>
            )
          })}
          <p className="shopping-view__foot costs-amount">
            {t('projects:shopping.stillToBuy', { amount: money(stillToBuy(items)) })}
          </p>
          {bought.length > 0 && (
            <section className="shopping-group shopping-group--bought">
              <Button
                variant="ghost"
                size="sm"
                icon={ChevronRight}
                iconClassName={chevronClass(showBought)}
                aria-expanded={showBought}
                onClick={() => setShowBought(!showBought)}
              >
                {t('projects:shopping.boughtCount', { count: bought.length })}
              </Button>
              <Collapse open={showBought}>
                <ul className="shopping-list" aria-label={t('projects:shopping.bought')}>
                  {bought.map((item) => row(item, false))}
                </ul>
              </Collapse>
            </section>
          )}
        </>
      )}
      {buying && (
        <BuyDialog
          projectId={project.id}
          currency={currency}
          item={buying}
          onClose={() => setBuying(null)}
          onBought={({ item }) => {
            setBuying(null)
            void refresh()
            toastUndo(t('projects:shopping.boughtNamed', { name: item.name }), () =>
              window.ostlerAPI.unbuyShoppingItem(project.id, item.id).then(() => refresh())
            )
          }}
        />
      )}
    </section>
  )
}
