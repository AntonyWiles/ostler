import { Button, Dialog } from '../ui'
import { GuideMarkdown } from './GuideMarkdown'
import { whatsNew } from './guide'
import './WhatsNewDialog.css'
import { t } from '@shared/i18n'

/** What's new (P8.1): this version's section of the bundled CHANGELOG.md. */
export function WhatsNewDialog({
  open,
  version,
  onClose
}: {
  open: boolean
  version: string
  onClose: () => void
}) {
  const section = whatsNew(version)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('help:whatsNewDialog.whatsNew')}
      description={
        section?.heading ?? (version ? t('help:whatsNewDialog.version', { version }) : undefined)
      }
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('help:whatsNewDialog.close')}
        </Button>
      }
    >
      <div className="ostler-whats-new">
        {section ? (
          <GuideMarkdown>{section.body}</GuideMarkdown>
        ) : (
          <p>{t('help:whatsNewDialog.thereNoNotesVersion')}</p>
        )}
      </div>
    </Dialog>
  )
}
