import { useInRouterContext, useNavigate } from 'react-router-dom'
import { boardLayoutPath } from '../../../navigation/paths'
import { Button } from '../../../ui'
import { Columns3Cog } from '../../../ui/icons'
import { t } from '@shared/i18n'

/**
 * "Customise board…": opens the project's Board with Customise board open.
 * Project settings › Board shows it; `onOpen` closes what it sits in first.
 * Nothing outside a router (a dialog rendered on its own, in a test).
 */
export function CustomiseBoardLink({
  projectId,
  onOpen
}: {
  projectId: string
  onOpen?: () => void
}) {
  return useInRouterContext() ? <LinkButton projectId={projectId} onOpen={onOpen} /> : null
}

function LinkButton({ projectId, onOpen }: { projectId: string; onOpen?: () => void }) {
  const navigate = useNavigate()
  return (
    <Button
      variant="secondary"
      icon={Columns3Cog}
      onClick={() => {
        onOpen?.()
        navigate(boardLayoutPath(projectId))
      }}
    >
      {t('tasks:boardLayout.openMenu')}
    </Button>
  )
}
