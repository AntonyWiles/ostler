import { useCallback } from 'react'
import type { MyWeekPrintRequest } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { useToast } from '../ui'
import { t } from '@shared/i18n'

/**
 * Print my week (N3.1b), as Home, the command palette and the Calendar's
 * Agenda offer it: the same sheet from all three, for today's local date
 * read when it is asked for, so a printout just after midnight starts on the
 * right day.
 */
export function usePrintMyWeek(): (output: MyWeekPrintRequest['output']) => Promise<void> {
  const { toast } = useToast()
  return useCallback(
    async (output) => {
      const result = await window.ostlerAPI.printMyWeek({ today: todayIsoDate(), output })
      if (!result.ok)
        toast({ title: t('views:myWeek.couldntPrint'), body: result.error, tone: 'danger' })
      else if (result.value)
        toast({ title: t('views:myWeek.savedPdf'), body: result.value, tone: 'success' })
    },
    [toast]
  )
}
