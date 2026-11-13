import type {
  AiConfig,
  ConfigTabKey,
  WebdavSyncConfig,
} from "./types";

export type ConfigStoreData = {
  config: AiConfig;
  webdav: WebdavSyncConfig;
  isConfigOpen: boolean;
  configTab: ConfigTabKey;
  shouldPromptContinue: boolean;
};

type ConfigStoreAction =
  | {
      type: "update-config";
      key: keyof AiConfig;
      value: AiConfig[keyof AiConfig];
    }
  | {
      type: "update-webdav";
      key: keyof WebdavSyncConfig;
      value: WebdavSyncConfig[keyof WebdavSyncConfig];
    }
  | {
      type: "open-dialog";
      shouldPromptContinue?: boolean;
      tab?: ConfigTabKey;
    }
  | { type: "set-dialog-open"; isOpen: boolean }
  | { type: "clear-prompt-continue" };

/** Applies one configuration interaction without side effects or persistence. */
export function transitionConfigStore(
  state: ConfigStoreData,
  action: ConfigStoreAction,
): ConfigStoreData {
  switch (action.type) {
    case "update-config":
      return {
        ...state,
        config: { ...state.config, [action.key]: action.value },
      };
    case "update-webdav":
      return {
        ...state,
        webdav: { ...state.webdav, [action.key]: action.value },
      };
    case "open-dialog":
      return {
        ...state,
        isConfigOpen: true,
        shouldPromptContinue: action.shouldPromptContinue ?? false,
        configTab: action.tab ?? "channels",
      };
    case "set-dialog-open":
      return { ...state, isConfigOpen: action.isOpen };
    case "clear-prompt-continue":
      return { ...state, shouldPromptContinue: false };
  }
}
