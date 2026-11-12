type KeyboardState = {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
};

type KeyboardInput = KeyboardState & {
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  nativeEvent?: KeyboardState;
};

function composing(state?: KeyboardState) {
  return Boolean(state?.isComposing || state?.keyCode === 229 || state?.which === 229);
}

export function isImeComposing(event: KeyboardInput) {
  return composing(event) || composing(event.nativeEvent);
}

export function isPlainEnterKey(event: KeyboardInput) {
  return event.key === "Enter"
    && !event.shiftKey
    && !event.ctrlKey
    && !event.metaKey
    && !isImeComposing(event);
}
