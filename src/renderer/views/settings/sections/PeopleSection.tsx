import { Link } from 'react-router-dom'
import { workloadPath } from '../../../navigation/paths'
import { SettingsGroup, useSettings } from '../settings-form'
import { DaysOffGroup } from './DaysOffGroup'
import { TeamsGroup } from './TeamsGroup'
import { PeopleList } from './PeopleList'
import { t } from '@shared/i18n'

/**
 * Settings › People (P5.1): the address book, who work can be assigned to in
 * every project, and which of them is you. People are records, not accounts
 * (D5). A project's own people are in its settings instead (migration 78).
 * Archiving is reversible, so it happens at once and offers undo; an
 * archived person keeps their tasks but is no longer offered in pickers.
 * Deleting is for good, and asks what happens to their work first.
 * Each person may have a weekly capacity and working days (R3.2, D36), which
 * Workload compares planned work with; the group links to it (D35).
 */
export function PeopleSection() {
  const { markSaved, setError } = useSettings()

  return (
    <>
      <SettingsGroup
        id="people"
        description={
          <>
            {t('settings:peopleSection.peopleAssignTasksThey')}{' '}
            <Link className="ostler-settings-people-link" to={workloadPath()}>
              {t('settings:peopleSection.seeWorkload')}
            </Link>
          </>
        }
      >
        <PeopleList
          projectId={null}
          label={t('settings:peopleSection.people')}
          onSaved={markSaved}
          onError={setError}
        />
      </SettingsGroup>
      <TeamsGroup />
      <DaysOffGroup />
    </>
  )
}
