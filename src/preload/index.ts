import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc'
import type { DriftApi } from '../shared/ipc'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: DriftApi = {
  getTasks: () => ipcRenderer.invoke(CH.getTasks),
  onTasks: (cb) => subscribe(CH.tasks, cb),
  addTask: (input) => ipcRenderer.invoke(CH.addTask, input),
  setStatus: (id, status) => ipcRenderer.invoke(CH.setStatus, id, status),
  deleteTask: (id) => ipcRenderer.invoke(CH.deleteTask, id),
  updateTask: (id, patch) => ipcRenderer.invoke(CH.updateTask, id, patch),
  setIgnoreMouse: (ignore) => ipcRenderer.send(CH.ignoreMouse, ignore),
  getLayout: () => ipcRenderer.invoke(CH.getLayout),
  onLayout: (cb) => subscribe(CH.layout, cb),
  dragStart: () => ipcRenderer.send(CH.dragStart),
  dragMove: (dx, dy) => ipcRenderer.send(CH.dragMove, dx, dy),
  dragEnd: () => ipcRenderer.send(CH.dragEnd),
}

contextBridge.exposeInMainWorld('drift', api)
