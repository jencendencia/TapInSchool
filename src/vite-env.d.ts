/// <reference types="vite/client" />

import type { TapinApi } from '../shared/types';

declare global {
  interface Window {
    // Exposed by electron/preload.ts when running inside Electron.
    tapin?: TapinApi;
  }
}

export {};
