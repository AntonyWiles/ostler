import { useEffect, useMemo, useState } from 'react'
import type { LibraryAiContextSummary, LibraryItem } from '@shared/ostler-api'
import { visionEnabled } from '@shared/ostler-api'
import { useConfig } from '../../hooks/useConfig'
import { LibraryAttachPicker } from '../../components/LibraryAttachPicker'
import { KIND_LABEL } from '../project-detail/library/libraryUi'
import { Badge, Button, IconButton, InlineAlert } from '../../ui'
import { Plus, X } from '../../ui/icons'
import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'

interface LibrarySourcesStepProps {
  projectId: string
  /** Selected (removable) items; Always items are added by the AI context itself. */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}

/**
 * The plan wizard's Sources step: what Ostler AI will read while it plans.
 * Always items are fixed, selected items can be removed, and more can be
 * added from the Library. The main process re-checks every id.
 */
export function LibrarySourcesStep({
  projectId,
  selectedIds,
  onChange,
  disabled
}: LibrarySourcesStepProps) {
  const { config } = useConfig()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [summary, setSummary] = useState<LibraryAiContextSummary | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    let active = true
    void window.ostlerAPI.listLibraryItems(projectId, {}).then((result) => {
      if (active && result.ok) setItems(result.value)
    })
    return () => {
      active = false
    }
  }, [projectId])

  const selectedKey = selectedIds.join(',')
  useEffect(() => {
    let active = true
    void window.ostlerAPI
      .getLibraryAiContextSummary(projectId, selectedIds, 'planning')
      .then((result) => {
        if (active && result.ok) setSummary(result.value)
      })
    return () => {
      active = false
    }
    // selectedKey stands in for selectedIds: re-ask only when the choice changes.
  }, [projectId, selectedKey])

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const always = items.filter((item) => item.aiAccess === 'always' && !item.archivedAt)
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter(
      (item): item is LibraryItem =>
        Boolean(item) && item!.aiAccess !== 'always' && item!.aiAccess !== 'human-only'
    )
  const vision = config ? visionEnabled(config.ai.vision) : null

  const remove = (id: string) => onChange(selectedIds.filter((candidate) => candidate !== id))
  const toggle = (item: LibraryItem) =>
    onChange(
      selectedIds.includes(item.id)
        ? selectedIds.filter((id) => id !== item.id)
        : [...selectedIds, item.id]
    )

  return (
    <>
      <p>{t('ai:librarySourcesStep.readsTheseWhilePlans')}</p>

      <section className="dialog-section">
        <h3 className="dialog-section__title">{t('ai:librarySourcesStep.alwaysIncluded')}</h3>
        {always.length === 0 ? (
          <p className="dialog-muted">{t('ai:librarySourcesStep.nothingSetAlwaysBriefs')}</p>
        ) : (
          <ul className="plan-sources">
            {always.map((item) => (
              <li key={item.id}>
                <Badge>{KIND_LABEL[item.kind]}</Badge>
                <span className="plan-sources__title" title={item.title}>
                  {item.title}
                </span>
                <span className="dialog-muted">
                  {t('ai:librarySourcesStep.revision', { revision: item.revision })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dialog-section">
        <h3 className="dialog-section__title">{t('ai:librarySourcesStep.chosenPlan')}</h3>
        {selected.length === 0 ? (
          <p className="dialog-muted">{t('ai:librarySourcesStep.nothingChosenYet')}</p>
        ) : (
          <ul className="plan-sources">
            {selected.map((item) => (
              <li key={item.id}>
                <Badge>{KIND_LABEL[item.kind]}</Badge>
                <span className="plan-sources__title" title={item.title}>
                  {item.title}
                </span>
                <IconButton
                  label={t('ai:librarySourcesStep.remove', { itemTitle: item.title })}
                  icon={X}
                  size="sm"
                  onClick={() => remove(item.id)}
                  disabled={disabled}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="plan-sources__add">
          <Button
            size="sm"
            icon={Plus}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
            disabled={disabled}
          >
            {t('ai:librarySourcesStep.addLibrary')}
          </Button>
          {pickerOpen && (
            <LibraryAttachPicker
              items={items.filter((item) => item.aiAccess !== 'always')}
              selectedIds={selectedIds}
              onToggle={toggle}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </section>

      {summary && (
        <>
          <p className="dialog-muted">
            {[
              summary.imagesDropped > 0
                ? t('ai:librarySourcesStep.imagesSentSomeLeftOut', {
                    count: summary.imageCount,
                    dropped: summary.imagesDropped
                  })
                : t('ai:librarySourcesStep.imagesWillSentAi', { count: summary.imageCount }),
              summary.overBudget
                ? t('ai:librarySourcesStep.charactersOverBudget', {
                    used: formatNumber(summary.totalChars),
                    budget: formatNumber(summary.budgetChars)
                  })
                : t('ai:librarySourcesStep.charactersOfBudget', {
                    used: formatNumber(summary.totalChars),
                    budget: formatNumber(summary.budgetChars)
                  }),
              vision === null && t('ai:librarySourcesStep.checkingWhetherModelReads'),
              vision === true && t('ai:librarySourcesStep.imagesSentImages')
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {vision === false && summary.imageCount > 0 && (
            <InlineAlert tone="warning">
              {t('ai:librarySourcesStep.imagesWillSentDescriptions')}
            </InlineAlert>
          )}
        </>
      )}
    </>
  )
}
