import type { JustSayApi } from '../../preload/index'

declare global {
  interface Window {
    justSay: JustSayApi
  }
}

export {}
