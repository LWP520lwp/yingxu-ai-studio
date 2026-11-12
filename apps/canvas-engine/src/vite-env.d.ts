/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly PROD: boolean;
  readonly VITE_DOC_URL?: string;
  readonly VITE_PLUGIN_REGISTRY_URL?: string;
  readonly VITE_DEV_PLUGINS?: string;
  readonly VITE_ANALYTICS_GA4_ID?: string;
  readonly VITE_ANALYTICS_BAIDU_ID?: string;
}
