export type ConfigComposerToken =
  { type: "text"; value: string } | { type: "reference"; nodeId: string };

export type ComposerSearchInput = {
  title: string;
  type: string;
  text?: string;
};

export type ComposerMentionState = {
  query: string;
  activeIndex: number;
} | null;
export type ComposerMentionAction =
  | { type: "open"; query: string }
  | { type: "close" }
  | { type: "move"; itemCount: number; direction: -1 | 1 };

export const CONFIG_REFERENCE_PATTERN = /@\[node:([^\]]+)\]/g;

export function parseComposerTokens(value: string): ConfigComposerToken[] {
  const tokens: ConfigComposerToken[] = [];
  const pattern = new RegExp(CONFIG_REFERENCE_PATTERN.source, "g");
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    tokens.push({ type: "reference", nodeId: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    tokens.push({ type: "text", value: value.slice(lastIndex) });
  }
  return tokens;
}

export function mentionQueryBeforeCaret(text: string) {
  return /@([^\s@]*)$/.exec(text)?.[1] ?? null;
}

export function filterComposerInputs<T extends ComposerSearchInput>(
  inputs: readonly T[],
  query: string,
  resourceLabel: (input: T) => string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...inputs];

  return inputs.filter((input) => {
    const searchable = [
      resourceLabel(input),
      input.title,
      input.type === "group" ? "" : input.text || "",
    ]
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  });
}

export function moveComposerSelection(
  activeIndex: number,
  itemCount: number,
  direction: -1 | 1,
) {
  if (itemCount <= 0) return 0;
  return (activeIndex + direction + itemCount) % itemCount;
}

export function reduceComposerMention(
  state: ComposerMentionState,
  action: ComposerMentionAction,
): ComposerMentionState {
  switch (action.type) {
    case "open":
      return { query: action.query, activeIndex: 0 };
    case "close":
      return null;
    case "move":
      return state
        ? {
            ...state,
            activeIndex: moveComposerSelection(
              state.activeIndex,
              action.itemCount,
              action.direction,
            ),
          }
        : null;
  }
}
