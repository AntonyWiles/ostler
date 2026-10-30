import { useEffect, useState } from 'react'
import type { CloudFileRead, LibraryItem } from '@shared/ostler-api'
import { cloudFileOf } from '@shared/cloud-file-link'
import { t } from '@shared/i18n'
import { Button } from '../../../ui'

/**
 * A Library link to a OneDrive, SharePoint, Google Drive or Dropbox file
 * (integrations phase 3): says which service it is in and, through a
 * connected account, what the file is called now. When that differs from the
 * item's title, **Use this name** renames the item. Ostler keeps only the link.
 */
export function CloudFileLine({
  item,
  onRename
}: {
  item: Pick<LibraryItem, 'id' | 'url' | 'title'>
  onRename(title: string): void
}) {
  const link = cloudFileOf(item.url)
  const [read, setRead] = useState<CloudFileRead | null>(null)

  useEffect(() => {
    if (!link || !item.url) return
    let current = true
    setRead(null)
    void window.ostlerAPI.readCloudFile(item.url).then((result) => {
      if (current && result.ok) setRead(result.value)
    })
    return () => {
      current = false
    }
    // Read again only when the address changes.
  }, [item.id, item.url])

  if (!link) return null
  const service = t(`library:cloudFile.service.${link.service}`)
  const renamed = read?.name && read.name !== item.title ? read.name : null
  return (
    <div className="ostler-library-cloud-file">
      <span>
        {read?.name
          ? t('library:cloudFile.named', { service, name: read.name })
          : read?.failure === 'noAccount'
            ? t('library:cloudFile.noAccount', { service })
            : read?.failure
              ? t('library:cloudFile.unread', {
                  service,
                  reason: t(`errors:accounts.failure.${read.failure}`)
                })
              : t('library:cloudFile.inService', { service })}
      </span>
      {renamed && (
        <Button size="sm" onClick={() => onRename(renamed)}>
          {t('library:cloudFile.useName')}
        </Button>
      )}
    </div>
  )
}
