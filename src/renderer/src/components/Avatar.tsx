import type { Agent } from '@shared/types'

/**
 * 头像内容：优先显示上传的图片，否则回退到字符/emoji。
 * 外层容器负责尺寸、圆角与边框。
 */
export function AvatarContent({
  agent
}: {
  agent: Pick<Agent, 'name' | 'avatar' | 'avatarImage'>
}) {
  if (agent.avatarImage) {
    return (
      <img
        className="avatar-image"
        src={agent.avatarImage}
        alt=""
        draggable={false}
      />
    )
  }
  return <>{agent.avatar || '✦'}</>
}
