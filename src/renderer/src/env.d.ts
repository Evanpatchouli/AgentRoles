import type { AgentRolesApi } from '@shared/types'

declare global {
  interface Window {
    api: AgentRolesApi
  }
}

export {}
