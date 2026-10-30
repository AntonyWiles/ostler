import { useEffect, useState } from 'react'
import type { PrintRoute } from '@shared/print-route'
import { formatDateTime } from '@shared/format'
import { formatMoney, type CurrencyCode } from '@shared/money'
import { groupBySupplier, quantityText, stillToBuy, type ShoppingItem } from '@shared/shopping'
import './PrintPage.css'
import '../../shopping/shopping.css'
import { t } from '@shared/i18n'

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

interface ShoppingPrintData {
  title: string
  currency: CurrencyCode
  items: ShoppingItem[]
}

/**
 * Print the Shopping list (N6.3b): what is still to buy, grouped by
 * supplier, with an empty tick box, the quantity, the name and the estimate,
 * in black and white for A4. Bought items are left off. No controls; main
 * prints it once the page says `data-print-ready`.
 */
export function ShoppingPrintPage({ route }: { route: PrintRoute }) {
  const [data, setData] = useState<ShoppingPrintData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      window.ostlerAPI.listShopping(route.projectId),
      window.ostlerAPI.getMoneySummary(route.projectId),
      window.ostlerAPI.getConfig()
    ]).then(([list, summary, config]) => {
      if (!list.ok || !summary.ok) {
        setError(!list.ok ? list.error : summary.ok ? '' : summary.error)
        markReady('error')
        return
      }
      setData({
        title: config.ok
          ? (config.value.projects.find((project) => project.id === route.projectId)?.name ?? '')
          : '',
        currency: summary.value.currency,
        items: list.value.filter((item) => item.costId === null)
      })
    })
  }, [route])

  useEffect(() => {
    if (!data) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [data])

  if (error !== null) return <p role="alert">{error}</p>
  if (!data) return null
  const money = (minor: number) => formatMoney(minor, data.currency)

  return (
    <div className="print-page shopping-print">
      <header className="print-page__header">
        <h1>{[data.title, t('projects:shopping.printTitle')].filter(Boolean).join(' · ')}</h1>
        <p>{t('projects:shopping.printedOn', { date: formatDateTime(Date.now()) })}</p>
      </header>
      {data.items.length === 0 && <p>{t('projects:shopping.allBought')}</p>}
      {groupBySupplier(data.items).map((group) => (
        <section key={group.contactId ?? ''} className="shopping-print__group">
          <h2>{group.name ?? t('projects:shopping.noSupplier')}</h2>
          <table className="shopping-print__table">
            <tbody>
              {group.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="shopping-print__box" aria-hidden="true" />
                  </td>
                  <td>{quantityText(item)}</td>
                  <td>{item.name}</td>
                  <td className="shopping-print__amount">
                    {item.estimate === null ? '' : money(item.estimate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {data.items.length > 0 && (
        <p className="shopping-print__amount">
          {t('projects:shopping.printTotal', { amount: money(stillToBuy(data.items)) })}
        </p>
      )}
    </div>
  )
}
