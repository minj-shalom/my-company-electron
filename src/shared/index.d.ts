import type { WindowApi } from './api'

declare global {
  interface Window {
    api: WindowApi
  }
}
