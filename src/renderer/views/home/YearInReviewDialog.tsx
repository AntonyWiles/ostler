import { useEffect, useState } from 'react'
import { usePrintYearInReview } from '../../hooks/usePrintYearInReview'
import { localeWeekStart } from '../../ui/calendar-layout'
import { Button, Dialog, Select } from '../../ui'
import { FileDown, Printer } from '../../ui/icons'
import { t } from '@shared/i18n'

/**
 * Choose a year for Your year (N3.6): this year, or any past year with
 * finished work, then print it or save it as a PDF. The years come from the
 * page's own call, read when the dialog opens.
 */
export function YearInReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const thisYear = new Date().getFullYear()
  const [years, setYears] = useState<number[]>([thisYear])
  const [year, setYear] = useState(thisYear)
  const print = usePrintYearInReview()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.ostlerAPI
      .getYearInReview({ year: thisYear, weekStart: localeWeekStart() })
      .then((result) => {
        if (!cancelled && result.ok && result.value.years.length > 0) setYears(result.value.years)
      })
    return () => {
      cancelled = true
    }
  }, [open, thisYear])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('views:yearInReview.chooseTitle')}
      description={t('views:yearInReview.chooseDescription')}
      footer={
        <>
          <Button onClick={onClose}>{t('views:yearInReview.close')}</Button>
          <Button icon={FileDown} onClick={() => void print(year, 'pdf')}>
            {t('views:yearInReview.savePdf')}
          </Button>
          <Button variant="primary" icon={Printer} onClick={() => void print(year, 'printer')}>
            {t('views:yearInReview.print')}
          </Button>
        </>
      }
    >
      <Select
        label={t('views:yearInReview.year')}
        value={String(year)}
        options={years.map((value) => ({ value: String(value), label: String(value) }))}
        onChange={(event) => setYear(Number(event.target.value))}
      />
    </Dialog>
  )
}
