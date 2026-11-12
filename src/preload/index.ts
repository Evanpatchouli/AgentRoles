import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent, AgentRolesApi } from '@shared/types'

const api: AgentRolesApi = {
  getState: () => ipcRenderer.invoke('app:state'),
  getMessages: (sessionId) => ipcRenderer.invoke('messages:list', sessionId),
  getInbox: () => ipcRenderer.invoke('inbox:list'),
  createAgent: () => ipcRenderer.invoke('agents:create'),
  saveAgent: (agent) => ipcRenderer.invoke('agents:save', agent),
  deleteAgent: (id) => ipcRenderer.invoke('agents:delete', id),
  listMemories: (agentId) => ipcRenderer.invoke('memory:list', agentId),
  saveMemory: (agentId, input) => ipcRenderer.invoke('memory:save', agentId, input),
  deleteMemory: (agentId, id) => ipcRenderer.invoke('memory:delete', agentId, id),
  confirmMemoryCandidate: (agentId, id) =>
    ipcRenderer.invoke('memory:confirm', agentId, id),
  rejectMemoryCandidate: (agentId, id) =>
    ipcRenderer.invoke('memory:reject', agentId, id),
  reindexMemories: (agentId) => ipcRenderer.invoke('memory:reindex', agentId),
  cleanupMemories: (agentId, unusedDays) =>
    ipcRenderer.invoke('memory:cleanup', agentId, unusedDays),
  exportMemories: (agentId) => ipcRenderer.invoke('memory:export', agentId),
  importMemories: (agentId) => ipcRenderer.invoke('memory:import', agentId),
  createSession: (agentId) => ipcRenderer.invoke('sessions:create', agentId),
  updateSession: (sessionId, patch) =>
    ipcRenderer.invoke('sessions:update', sessionId, patch),
  newWindow: () => ipcRenderer.invoke('window:new'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  zoomWindow: (direction) => ipcRenderer.invoke('window:zoom', direction),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  getWhatsNew: (force) => ipcRenderer.invoke('updates:whatsNew', force),
  sendMessage: (sessionId, content, attachments) =>
    ipcRenderer.invoke('messages:send', sessionId, content, attachments),
  processMessage: (sessionId, messageId) =>
    ipcRenderer.invoke('messages:process', sessionId, messageId),
  stopSession: (sessionId) => ipcRenderer.invoke('sessions:stop', sessionId),
  clearMessages: (sessionId) => ipcRenderer.invoke('messages:clear', sessionId),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  testModel: (model) => ipcRenderer.invoke('model:test', model),
  listModels: (model) => ipcRenderer.invoke('model:list', model),
  testNotion: (notion) => ipcRenderer.invoke('notion:test', notion),
  testEmbedding: (embedding) => ipcRenderer.invoke('embedding:test', embedding),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  restartIngress: () => ipcRenderer.invoke('ingress:restart'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  revealDataDir: () => ipcRenderer.invoke('app:revealDataDir'),
  getRuntimePaths: () => ipcRenderer.invoke('runtime:paths'),
  onAgentEvent: (listener) => {
    const handler = (_event: unknown, payload: AgentEvent): void => listener(payload)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
