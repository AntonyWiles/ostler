import { useCallback } from 'react'
import type { YearInReviewPrintRequest } from '@shared/ostler-api'
import { localeWeekStart } from '../ui/calendar-layout'
import { useToast } from '../ui'
import { t } from '@shared/i18n'

/**
 * Print Your year (N3.6), as the progress card and the command palette offer
 * it: the same page from both, with the Calendar's week start.
 */
export function usePrintYearInReview(): (
  year: number,
  output: YearInReviewPrintRequest['output']
) => Promise<void> {
  const { toast } = useToast()
  return useCallback(
    async (year, output) => {
      const result = await window.ostlerAPI.printYearInReview({
        year,
        weekStart: localeWeekStart(),
        output
      })
      if (!result.ok)
        toast({ title: t('views:yearInReview.couldntPrint'), body: result.error, tone: 'danger' })
      else if (result.value)
        toast({ title: t('views:yearInReview.savedPdf'), body: result.value, tone: 'success' })
    },
    [toast]
  )
}
