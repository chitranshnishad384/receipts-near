/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the relayer, with no trailing path.
   * Unset in the Pages build so the site never calls a relayer.
   * Example for the local full loop: http://127.0.0.1:8788
   */
  readonly VITE_RELAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
