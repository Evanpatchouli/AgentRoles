import type { ChatAttachment } from '@shared/types'
import { formatFileSize } from '../lib/attachments'
import { Icon } from './Icons'

export function AttachmentList({
  attachments,
  onRemove,
  className = ''
}: {
  attachments: ChatAttachment[]
  onRemove?: (id: string) => void
  className?: string
}) {
  if (attachments.length === 0) return null
  return (
    <div className={'attachment-list' + (className ? ' ' + className : '')}>
      {attachments.map((attachment) =>
        attachment.kind === 'image' && attachment.dataUrl ? (
          <div className="attachment-tile attachment-image" key={attachment.id}>
            <img src={attachment.dataUrl} alt={attachment.name} title={attachment.name} />
            {onRemove ? (
              <button
                type="button"
                className="attachment-remove"
                onClick={() => onRemove(attachment.id)}
                aria-label={'移除图片 ' + attachment.name}
                title="移除"
              >
                <Icon name="x" size={11} />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="attachment-tile attachment-file" key={attachment.id}>
            <span className="attachment-file-icon">
              <Icon name="file" size={15} />
            </span>
            <span className="attachment-file-copy">
              <span className="attachment-file-name" title={attachment.name}>
                {attachment.name}
              </span>
              <span className="attachment-file-size">
                {formatFileSize(attachment.size)}
                {attachment.truncated ? ' · 已截断' : ''}
              </span>
            </span>
            {onRemove ? (
              <button
                type="button"
                className="attachment-remove is-file"
                onClick={() => onRemove(attachment.id)}
                aria-label={'移除文件 ' + attachment.name}
                title="移除"
              >
                <Icon name="x" size={11} />
              </button>
            ) : null}
          </div>
        )
      )}
    </div>
  )
}
