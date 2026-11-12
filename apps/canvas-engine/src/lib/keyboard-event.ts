type NativeKeyboardEventLike = {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
};

type KeyboardEventLike = NativeKeyboardEventLike & {
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  nativeEvent?: NativeKeyboardEventLike;
};

export function isImeComposing(event: KeyboardEventLike) {
  return Boolean(
    event.isComposing ||
    event.nativeEvent?.isComposing ||
    event.keyCode === 229 ||
    event.which === 229 ||
    event.nativeEvent?.keyCode === 229 ||
    event.nativeEvent?.which === 229,
  );
}

export function isPlainEnterKey(event: KeyboardEventLike) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !isImeComposing(event)
  );
}
