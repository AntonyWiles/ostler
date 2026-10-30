import { useCallback, useEffect, useState } from 'react'
import { formatIsoDate, isIsoDate } from '@shared/dates'
import { formatDate } from '@shared/format'
import { formatMoney } from '@shared/money'
import { formatHours } from '@shared/time/duration'
import { thisMonth, type Billing, type TimeReport } from '@shared/time/billing'
import { t } from '@shared/i18n'
import type { ProjectViewProps } from '../../navigation/view-props'
import { Button, DateField, EmptyState, InlineAlert, Toolbar, useConfirm, useToast } from '../../ui'
import { CircleCheck, FileDown, Hourglass, Printer, Undo2 } from '../../ui/icons'
import {
  reportAmount,
  TimeReportTables,
  TimeReportTotalsList
} from '../../billing/TimeReportTables'
import '../../billing/billing.css'

/**
 * The Time report (N6.4, N47), from the project's More menu: any dates (this
 * month to begin with), then hours, billable hours and the amount, a table by
 * task with each task's entries on request, unbilled and billed time apart.
 * Export CSV, Print, and Mark as billed, which asks first and locks the time
 * it bills; the billings listed beneath can be unmarked, with Undo.
 */
export function TimeReportView({ project }: ProjectViewProps) {
  const { toast, toastUndo } = useToast()
  const confirm = useConfirm()
  const [range, setRange] = useState(() => thisMonth())
  const [report, setReport] = useState<TimeReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const valid = isIsoDate(range.from) && isIsoDate(range.to) && range.from <= range.to

  const load = useCallback(async () => {
    if (!valid) return
    const result = await window.ostlerAPI.getTimeReport(project.id, range.from, range.to)
    if (result.ok) {
      setReport(result.value)
      setError(null)
    } else setError(result.error)
  }, [project.id, range.from, range.to, valid])

  useEffect(() => {
    void load()
    const offTime = window.ostlerAPI.onTimeChange((change) => {
      if (change.projectId === project.id) void load()
    })
    const offPlanning = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void load()
    })
    return () => {
      offTime()
      offPlanning()
    }
  }, [load, project.id])

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const unbilledBillable = report
    ? report.unbilled.tasks.some((task) => task.entries.some((entry) => entry.billable))
    : false
  const currency = report?.currency ?? ''
  const from = formatIsoDate(range.from)
  const to = formatIsoDate(range.to)

  const exportCsv = async () => {
    const result = await window.ostlerAPI.exportTimeReportCsv(project.id, range.from, range.to)
    if (!result.ok)
      return toast({
        title: t('views:timeReport.couldNotExport'),
        body: result.error,
        tone: 'danger'
      })
    if (result.value)
      toast({ title: t('views:timeReport.exported'), body: result.value, tone: 'success' })
  }

  const print = async (output: 'printer' | 'pdf') => {
    setBusy(true)
    const result = await window.ostlerAPI.printTimeReport({
      projectId: project.id,
      from: range.from,
      to: range.to,
      output
    })
    setBusy(false)
    if (!result.ok)
      return toast({
        title: t('views:timeReport.couldNotPrint'),
        body: result.error,
        tone: 'danger'
      })
    if (result.value)
      toast({ title: t('views:timeReport.savedPdf'), body: result.value, tone: 'success' })
  }

  const markBilled = async () => {
    if (!report) return
    const billable = report.unbilled.billableSeconds
    const ok = await confirm({
      title: t('views:timeReport.markBilledTitle'),
      body:
        report.unbilled.amount === null
          ? t('views:timeReport.markBilledBodyNoRate', {
              from,
              to,
              hours: formatHours(billable)
            })
          : t('views:timeReport.markBilledBody', {
              from,
              to,
              hours: formatHours(billable),
              amount: formatMoney(report.unbilled.amount, currency)
            }),
      confirmLabel: t('views:timeReport.markBilled')
    })
    if (!ok) return
    const result = await window.ostlerAPI.markBilled(project.id, range)
    if (!result.ok)
      return toast({
        title: t('views:timeReport.couldNotMark'),
        body: result.error,
        tone: 'danger'
      })
    void load()
    toast({ title: t('views:timeReport.markedBilled'), tone: 'success' })
  }

  const unmark = async (billing: Billing) => {
    const result = await window.ostlerAPI.unmarkBilling(project.id, billing.id)
    if (!result.ok)
      return toast({
        title: t('views:timeReport.couldNotUnmark'),
        body: result.error,
        tone: 'danger'
      })
    void load()
    toastUndo(t('views:timeReport.unmarked'), () =>
      window.ostlerAPI.restoreBilling(project.id, result.value).then(() => load())
    )
  }

  const empty =
    report !== null &&
    report.unbilled.tasks.length === 0 &&
    report.billed.tasks.length === 0 &&
    report.running.length === 0

  return (
    <section className="time-report" aria-label={t('views:timeReport.title')}>
      <p className="time-report__intro">{t('views:timeReport.intro')}</p>
      <Toolbar label={t('views:timeReport.actions')}>
        <div className="time-report__range">
          <DateField
            label={t('views:timeReport.from')}
            value={range.from}
            onChange={(value) => setRange((current) => ({ ...current, from: value }))}
            due={false}
          />
          <DateField
            label={t('views:timeReport.to')}
            value={range.to}
            onChange={(value) => setRange((current) => ({ ...current, to: value }))}
            due={false}
          />
          <Button onClick={() => setRange(thisMonth())}>{t('views:timeReport.thisMonth')}</Button>
        </div>
        <span className="time-report__spacer" />
        <Button icon={FileDown} disabled={!valid} onClick={() => void exportCsv()}>
          {t('views:timeReport.exportCsv')}
        </Button>
        <Button icon={Printer} disabled={!valid || busy} onClick={() => void print('printer')}>
          {t('views:timeReport.print')}
        </Button>
        <Button icon={FileDown} disabled={!valid || busy} onClick={() => void print('pdf')}>
          {t('views:timeReport.savePdf')}
        </Button>
        <Button
          variant="primary"
          icon={CircleCheck}
          disabled={!valid || !unbilledBillable}
          onClick={() => void markBilled()}
        >
          {t('views:timeReport.markBilled')}
        </Button>
      </Toolbar>
      {!valid && <InlineAlert tone="warning">{t('views:timeReport.rangeInvalid')}</InlineAlert>}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {report && (
        <p className="time-report__muted">
          {report.hourlyRate === null
            ? t('views:timeReport.noRate')
            : t('views:timeReport.rate', { rate: formatMoney(report.hourlyRate, currency) })}
        </p>
      )}
      {report && empty && (
        <EmptyState
          icon={Hourglass}
          title={t('views:timeReport.empty')}
          description={t('views:timeReport.emptyDescription')}
        />
      )}
      {report && !empty && (
        <>
          <TimeReportTotalsList report={report} />
          {report.running.map((entry) => (
            <InlineAlert key={entry.id} tone="info">
              {t('views:timeReport.running', { task: entry.workItemTitle })}
            </InlineAlert>
          ))}
          <TimeReportTables report={report} expanded={expanded} onToggle={toggle} />
        </>
      )}
      {report && (
        <section className="time-report__part" aria-label={t('views:timeReport.billings')}>
          <h2 className="time-report__heading">{t('views:timeReport.billings')}</h2>
          {report.billings.length === 0 ? (
            <p className="time-report__muted">{t('views:timeReport.noBillings')}</p>
          ) : (
            <ul className="time-report__billings">
              {report.billings.map((billing) => {
                const words = {
                  from: formatIsoDate(billing.from),
                  to: formatIsoDate(billing.to)
                }
                return (
                  <li key={billing.id} className="time-report__billing">
                    <span className="time-report__billing-text">
                      {billing.amount === null
                        ? t('views:timeReport.billingLineNoRate', {
                            ...words,
                            hours: formatHours(billing.billableSeconds)
                          })
                        : t('views:timeReport.billingLine', {
                            ...words,
                            hours: formatHours(billing.billableSeconds),
                            amount: reportAmount(billing.amount, billing.currency)
                          })}{' '}
                      <span className="time-report__muted">
                        {t('views:timeReport.billingMarked', {
                          date: formatDate(billing.markedAt)
                        })}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      icon={Undo2}
                      aria-label={t('views:timeReport.unmarkNamed', words)}
                      onClick={() => void unmark(billing)}
                    >
                      {t('views:timeReport.unmark')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </section>
  )
}
