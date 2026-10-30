import { useState } from 'react'
import { todayIsoDate } from '@shared/dates'
import { moneyInputText, parseMoney, type Cost, type CurrencyCode } from '@shared/money'
import type { ShoppingItem } from '@shared/shopping'
import { t } from '@shared/i18n'
import { Button, DateField, Dialog, InlineAlert, TextField } from '../ui'

/**
 * Ticking an item as bought (N6.3b): the price paid, the estimate filled in,
 * and the day, today. Saving makes the paid cost and ticks the item in one
 * call (`buyShoppingItem`).
 */
export function BuyDialog({
  projectId,
  currency,
  item,
  onClose,
  onBought
}: {
  projectId: string
  currency: CurrencyCode
  item: ShoppingItem
  onClose: () => void
  onBought: (result: { item: ShoppingItem; cost: Cost }) => void
}) {
  const [price, setPrice] = useState(
    item.estimate === null ? '' : moneyInputText(item.estimate, currency)
  )
  const [date, setDate] = useState(todayIsoDate())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const minor = parseMoney(price, currency)
    if (minor === null) {
      setError(t('projects:shopping.priceInvalid'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.buyShoppingItem(projectId, item.id, {
      pricePaid: minor,
      date
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onBought(result.value)
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t('projects:shopping.buyTitle', { name: item.name })}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('projects:shopping.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>
            {t('projects:shopping.buy')}
          </Button>
        </>
      }
    >
      <div className="shopping-form">
        <p className="shopping-form__note">{t('projects:shopping.buyDescription')}</p>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('projects:shopping.pricePaid', { currency })}
          inputMode="decimal"
          value={price}
          autoFocus
          onChange={(event) => setPrice(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
        <DateField
          label={t('projects:shopping.boughtDate')}
          value={date}
          onChange={setDate}
          due={false}
        />
      </div>
    </Dialog>
  )
}
