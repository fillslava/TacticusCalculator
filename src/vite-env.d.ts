/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TACTICUS_API_KEY?: string;
  readonly VITE_SNOWPRINT_ID?: string;
  readonly VITE_USER_ID?: string;
  readonly VITE_PRINCIPAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
