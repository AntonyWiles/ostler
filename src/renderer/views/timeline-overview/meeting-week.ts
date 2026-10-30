import type { MeetingWeek } from '@shared/planning/timeline-overview'
import { t } from '@shared/i18n'
import { longDate } from '../planning/timeline/timeline-drawing'

/** "3 milestones from 2 projects, week of …": a meeting week's name, on its mark and its popover. */
export function meetingWeekLabel(week: MeetingWeek): string {
  return t('views:timelineOverview.meetingLabel', {
    milestones: t('views:timelineOverview.milestoneCount', { count: week.milestones.length }),
    projects: t('views:timelineOverview.projectCount', { count: week.projectCount }),
    first: longDate(week.start),
    last: longDate(week.end)
  })
}
