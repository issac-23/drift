/// <reference types="vite/client" />
import type { DriftApi } from '../../shared/ipc'

declare global {
  interface Window {
    drift: DriftApi
  }
}
