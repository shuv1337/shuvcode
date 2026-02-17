import "solid-js"

interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
declare const __COMMIT_HASH__: string

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
