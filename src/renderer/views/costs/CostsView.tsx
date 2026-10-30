import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatIsoDate, todayIsoDate } from '@shared/dates'
import {
  formatMoney,
  MAX_COST_DESCRIPTION,
  moneyInputText,
  parseMoney,
  summarizeCosts,
  type Cost,
  type CostQuery,
  type CostState,
  type CurrencyCode
} from '@shared/money'
import { t } from '@shared/i18n'
import type { ProjectViewProps } from '../../navigation/view-props'
import {
  Button,
  DateField,
  EmptyState,
  IconButton,
  InlineAlert,
  Select,
  TextField,
  Toolbar,
  useToast
} from '../../ui'
import { CircleCheck, FileDown, Pencil, Plus, Trash2, Wallet } from '../../ui/icons'
import { BudgetDialog } from '../../costs/BudgetDialog'
import {
  CategoryField,
  MarkPaidDialog,
  costStateLabel,
  costStateOptions,
  revertCost
} from '../../costs/CostDialog'
import { budgetLeftText } from '../../costs/BudgetCard'
import { useCosts, useMoneySummary } from '../../costs/useMoney'
import '../../costs/costs.css'

const ALL = '*'
const NO_CATEGORY = ''

interface Draft {
  date: string
  description: string
  category: string
  workItemId: string
  milestoneId: string
  state: CostState
  amount: string
}

function draftOf(cost: Cost | null, currency: CurrencyCode): Draft {
  return {
    date: cost?.date ?? todayIsoDate(),
    description: cost?.description ?? '',
    category: cost?.category ?? '',
    workItemId: cost?.workItemId ?? '',
    milestoneId: cost?.milestoneId ?? '',
    state: cost?.state ?? 'planned',
    amount: cost ? moneyInputText(cost.amount, currency) : ''
  }
}

/**
 * Costs (N6.3a), from the project's More menu: every cost by date, filtered
 * by category and state, with its task or milestone. Add a cost and Edit work
 * in place in the table; Mark as paid can set the paid date and amount;
 * Delete offers Undo. Totals of what is shown sit at the foot. Keyboard as
 * the List: ↑ and ↓ move between rows, Enter edits, Escape cancels, P marks
 * paid and Delete deletes.
 */
export function CostsView({ project, ws }: ProjectViewProps) {
  const { toast, toastUndo } = useToast()
  const [category, setCategory] = useState(ALL)
  const [state, setState] = useState<CostState | typeof ALL>(ALL)
  const query = useMemo<CostQuery>(
    () => ({
      ...(category !== ALL ? { category } : {}),
      ...(state !== ALL ? { state } : {})
    }),
    [category, state]
  )
  const { costs, categories, error, reload } = useCosts(project.id, query)
  const { summary, reload: reloadSummary } = useMoneySummary(project.id)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [paying, setPaying] = useState<Cost | null>(null)
  const [settingBudget, setSettingBudget] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const currency = summary?.currency
  const taskTitles = useMemo(
    () => new Map(ws.workItems.map((item) => [item.id, item.title])),
    [ws.workItems]
  )
  const milestoneNames = useMemo(
    () => new Map(ws.milestones.map((milestone) => [milestone.id, milestone.name])),
    [ws.milestones]
  )
  if (!currency) return null
  const money = (minor: number) => formatMoney(minor, currency)
  const shown = costs ?? []
  const totals = summarizeCosts(shown, null, currency)

  const refresh = async () => {
    await Promise.all([reload(), reloadSummary()])
  }

  const startEditing = (cost: Cost | null) => {
    setEditing(cost ? cost.id : 'new')
    setDraft(draftOf(cost, currency))
    setDraftError(null)
  }

  const stopEditing = (focusId?: string) => {
    setEditing(null)
    setDraft(null)
    setDraftError(null)
    if (focusId) requestAnimationFrame(() => rowRefs.current.get(focusId)?.focus())
  }

  const saveDraft = async () => {
    if (!draft) return
    const minor = parseMoney(draft.amount, currency)
    if (!draft.description.trim()) {
      setDraftError(t('projects:costs.descriptionRequired'))
      return
    }
    if (minor === null) {
      setDraftError(t('projects:costs.amountInvalid'))
      return
    }
    const input = {
      date: draft.date,
      description: draft.description,
      category: draft.category,
      workItemId: draft.workItemId || null,
      milestoneId: draft.milestoneId || null,
      state: draft.state,
      amount: minor
    }
    if (editing === 'new') {
      const result = await window.ostlerAPI.createCost(project.id, input)
      if (!result.ok) return setDraftError(result.error)
      await refresh()
      stopEditing(result.value.id)
      toastUndo(t('projects:costs.added'), () =>
        window.ostlerAPI.deleteCost(project.id, result.value.id).then(() => refresh())
      )
    } else if (editing) {
      const result = await window.ostlerAPI.updateCost(project.id, editing, input)
      if (!result.ok) return setDraftError(result.error)
      await refresh()
      stopEditing(editing)
      const before = result.value.before
      toastUndo(t('projects:costs.edited'), () =>
        revertCost(project.id, before).then(() => refresh())
      )
    }
  }

  const remove = async (cost: Cost) => {
    const result = await window.ostlerAPI.deleteCost(project.id, cost.id)
    if (!result.ok) {
      toast({ title: t('projects:costs.couldNotDelete'), body: result.error, tone: 'danger' })
      return
    }
    await refresh()
    toastUndo(t('projects:costs.deleted'), () =>
      window.ostlerAPI.restoreCost(project.id, result.value).then(() => refresh())
    )
  }

  const exportCsv = async () => {
    const result = await window.ostlerAPI.exportCostsCsv(project.id, query)
    if (!result.ok) {
      toast({ title: t('projects:costs.couldNotExport'), body: result.error, tone: 'danger' })
      return
    }
    if (result.value)
      toast({ title: t('projects:costs.exported'), body: result.value, tone: 'success' })
  }

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, cost: Cost, index: number) => {
    if (event.target !== event.currentTarget) return
    const move = (to: number) => {
      const next = shown[Math.max(0, Math.min(shown.length - 1, to))]
      if (next) rowRefs.current.get(next.id)?.focus()
    }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(shown.length - 1)
    else if (event.key === 'Enter' || event.key === 'F2') startEditing(cost)
    else if (event.key === 'Delete') void remove(cost)
    else if ((event.key === 'p' || event.key === 'P') && cost.state === 'planned') setPaying(cost)
    else return
    event.preventDefault()
  }

  const onDraftKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault()
      void saveDraft()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      stopEditing(editing && editing !== 'new' ? editing : undefined)
    }
  }

  const linkText = (cost: Cost) =>
    [
      cost.workItemId ? taskTitles.get(cost.workItemId) : null,
      cost.milestoneId ? milestoneNames.get(cost.milestoneId) : null
    ]
      .filter(Boolean)
      .join(' · ')

  const editRow = (key: string) =>
    draft && (
      <tr key={key} className="costs-table__row costs-table__row--editing" onKeyDown={onDraftKey}>
        <td>
          <DateField
            label={t('projects:costs.date')}
            hideLabel
            value={draft.date}
            onChange={(date) => setDraft({ ...draft, date })}
            due={false}
          />
        </td>
        <td>
          <TextField
            label={t('projects:costs.description')}
            hideLabel
            autoFocus
            maxLength={MAX_COST_DESCRIPTION}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </td>
        <td>
          <CategoryField
            hideLabel
            value={draft.category}
            categories={categories}
            onChange={(value) => setDraft({ ...draft, category: value })}
          />
        </td>
        <td className="costs-table__links">
          <Select
            label={t('projects:costs.task')}
            hideLabel
            size="sm"
            value={draft.workItemId}
            onChange={(event) => setDraft({ ...draft, workItemId: event.target.value })}
            options={[
              { value: '', label: t('projects:costs.noTask') },
              ...ws.workItems.map((item) => ({ value: item.id, label: item.title }))
            ]}
          />
          <Select
            label={t('projects:costs.milestone')}
            hideLabel
            size="sm"
            value={draft.milestoneId}
            onChange={(event) => setDraft({ ...draft, milestoneId: event.target.value })}
            options={[
              { value: '', label: t('projects:costs.noMilestone') },
              ...ws.milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))
            ]}
          />
        </td>
        <td>
          <Select
            label={t('projects:costs.state')}
            hideLabel
            size="sm"
            value={draft.state}
            onChange={(event) => setDraft({ ...draft, state: event.target.value as CostState })}
            options={costStateOptions()}
          />
        </td>
        <td>
          <TextField
            label={t('projects:costs.amountIn', { currency })}
            hideLabel
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
        </td>
        <td className="costs-table__actions">
          <Button size="sm" variant="primary" onClick={() => void saveDraft()}>
            {editing === 'new' ? t('projects:costs.addCost') : t('projects:costs.save')}
          </Button>
          <Button
            size="sm"
            onClick={() => stopEditing(editing && editing !== 'new' ? editing : undefined)}
          >
            {t('projects:costs.cancel')}
          </Button>
        </td>
      </tr>
    )

  const left = summary ? budgetLeftText(summary) : null

  return (
    <section className="costs-view" aria-label={t('projects:costs.costs')}>
      <header className="costs-view__header">
        <p className="costs-view__intro">
          {summary && summary.budget !== null
            ? t('projects:costs.introWithBudget', {
                budget: money(summary.budget),
                total: money(summary.total),
                left
              })
            : t('projects:costs.intro')}
        </p>
      </header>
      <Toolbar label={t('projects:costs.costsActions')}>
        <Select
          label={t('projects:costs.category')}
          size="sm"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          options={[
            { value: ALL, label: t('projects:costs.allCategories') },
            ...categories.map((name) => ({ value: name, label: name })),
            { value: NO_CATEGORY, label: t('projects:costs.noCategory') }
          ]}
        />
        <Select
          label={t('projects:costs.state')}
          size="sm"
          value={state}
          onChange={(event) => setState(event.target.value as CostState | typeof ALL)}
          options={[{ value: ALL, label: t('projects:costs.allStates') }, ...costStateOptions()]}
        />
        <span className="costs-view__spacer" />
        <Button icon={Wallet} onClick={() => setSettingBudget(true)}>
          {summary?.budget === null
            ? t('projects:costs.setBudget')
            : t('projects:costs.changeBudget')}
        </Button>
        <Button icon={FileDown} onClick={() => void exportCsv()}>
          {t('projects:costs.exportCsv')}
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          disabled={editing !== null}
          onClick={() => startEditing(null)}
        >
          {t('projects:costs.addCost')}
        </Button>
      </Toolbar>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {draftError && <InlineAlert tone="danger">{draftError}</InlineAlert>}
      {costs !== null && shown.length === 0 && editing !== 'new' ? (
        <EmptyState
          icon={Wallet}
          title={
            category === ALL && state === ALL
              ? t('projects:costs.noCosts')
              : t('projects:costs.noCostsMatch')
          }
          description={t('projects:costs.noCostsDescription')}
        />
      ) : (
        <div className="costs-table-scroll">
          <table className="costs-table" aria-label={t('projects:costs.costs')}>
            <thead>
              <tr>
                <th scope="col">{t('projects:costs.date')}</th>
                <th scope="col">{t('projects:costs.description')}</th>
                <th scope="col">{t('projects:costs.category')}</th>
                <th scope="col">{t('projects:costs.taskOrMilestone')}</th>
                <th scope="col">{t('projects:costs.state')}</th>
                <th scope="col" className="costs-table__amount">
                  {t('projects:costs.amount')}
                </th>
                <th scope="col">
                  <span className="costs-view__sr">{t('projects:costs.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {editing === 'new' && editRow('new')}
              {shown.map((cost, index) =>
                editing === cost.id ? (
                  editRow(cost.id)
                ) : (
                  <tr
                    key={cost.id}
                    ref={(element) => {
                      if (element) rowRefs.current.set(cost.id, element)
                      else rowRefs.current.delete(cost.id)
                    }}
                    className="costs-table__row"
                    tabIndex={index === 0 ? 0 : -1}
                    aria-label={t('projects:costs.rowLabel', {
                      description: cost.description,
                      amount: money(cost.amount),
                      state: costStateLabel(cost.state)
                    })}
                    onKeyDown={(event) => onRowKey(event, cost, index)}
                    onDoubleClick={() => startEditing(cost)}
                  >
                    <td className="costs-table__date">{formatIsoDate(cost.date)}</td>
                    <td>{cost.description}</td>
                    <td className="costs-table__muted">
                      {cost.category || t('projects:costs.noCategory')}
                    </td>
                    <td className="costs-table__muted">{linkText(cost)}</td>
                    <td>
                      <span className="costs-state" data-state={cost.state}>
                        {costStateLabel(cost.state)}
                      </span>
                    </td>
                    <td className="costs-table__amount costs-amount">{money(cost.amount)}</td>
                    <td className="costs-table__actions">
                      {cost.state === 'planned' && (
                        <IconButton
                          size="sm"
                          icon={CircleCheck}
                          label={t('projects:costs.markPaidNamed', {
                            description: cost.description
                          })}
                          onClick={() => setPaying(cost)}
                        />
                      )}
                      <IconButton
                        size="sm"
                        icon={Pencil}
                        label={t('projects:costs.editNamed', { description: cost.description })}
                        onClick={() => startEditing(cost)}
                      />
                      <IconButton
                        size="sm"
                        icon={Trash2}
                        label={t('projects:costs.deleteNamed', { description: cost.description })}
                        onClick={() => void remove(cost)}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>
                  {t('projects:costs.totals', {
                    paid: money(totals.paid),
                    planned: money(totals.planned)
                  })}
                </th>
                <td
                  className="costs-table__amount costs-amount"
                  aria-label={t('projects:costs.total')}
                >
                  {money(totals.total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {paying && (
        <MarkPaidDialog
          projectId={project.id}
          currency={currency}
          cost={paying}
          onClose={() => setPaying(null)}
          onSaved={({ cost, before }) => {
            setPaying(null)
            void refresh().then(() => rowRefs.current.get(cost.id)?.focus())
            toastUndo(t('projects:costs.markedPaid'), () =>
              revertCost(project.id, before).then(() => refresh())
            )
          }}
        />
      )}
      {settingBudget && (
        <BudgetDialog
          projectId={project.id}
          onClose={() => setSettingBudget(false)}
          onSaved={() => void refresh()}
        />
      )}
    </section>
  )
}
