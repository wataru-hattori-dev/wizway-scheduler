/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_USE_API?: string
  readonly VITE_SLACK_CLIENT_ID?: string
  readonly VITE_SLACK_REDIRECT_URI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
