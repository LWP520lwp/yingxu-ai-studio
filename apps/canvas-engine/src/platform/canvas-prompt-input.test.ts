import { describe, expect, it } from "vitest";

import {
  mentionQueryBeforeCaret,
  parsePromptInputTokens,
  promptMenuPosition,
  serializePromptContents,
} from "@/atlas-engine/agent/prompt-input";

function text(value: string) {
  return { nodeType: 3, textContent: value } as unknown as Node;
}

function element(tagName: string, children: Node[] = [], refLabel?: string) {
  return {
    nodeType: 1,
    tagName,
    childNodes: children,
    firstChild: children[0],
    dataset: refLabel ? { refLabel } : {},
  } as unknown as Node;
}

function root(...children: Node[]) {
  return {
    childNodes: children as unknown as NodeListOf<ChildNode>,
  } as Pick<ParentNode, "childNodes">;
}

describe("canvas prompt input", () => {
  it("parses overlapping and regex-special reference labels longest-first", () => {
    expect(
      parsePromptInputTokens("Use [frame] and @reference", [
        "@ref",
        "@reference",
        "[frame]",
      ]),
    ).toEqual([
      { type: "text", value: "Use " },
      { type: "reference", label: "[frame]" },
      { type: "text", value: " and " },
      { type: "reference", label: "@reference" },
    ]);
  });

  it("returns mention text only for the unfinished @ token at the caret", () => {
    expect(mentionQueryBeforeCaret("Make a scene with @forest")).toBe("forest");
    expect(mentionQueryBeforeCaret("@")).toBe("");
    expect(mentionQueryBeforeCaret("@forest path")).toBeNull();
    expect(mentionQueryBeforeCaret("email@forest")).toBe("forest");
  });

  it("serializes references, explicit line breaks, and block lines without losing content", () => {
    expect(
      serializePromptContents(root(text("A"), element("BR"), text("B"))),
    ).toBe("A\nB");
    expect(
      serializePromptContents(
        root(element("DIV", [text("first")]), element("DIV", [text("second")])),
      ),
    ).toBe("first\nsecond");
    expect(
      serializePromptContents(
        root(
          element("SPAN", [text("use ")]),
          element("SPAN", [element("SPAN", [], "@image-1")]),
        ),
      ),
    ).toBe("use @image-1");
  });

  it("ignores browser placeholder breaks in an otherwise empty editor", () => {
    expect(serializePromptContents(root(element("BR")))).toBe("");
    expect(serializePromptContents(root(element("DIV", [element("BR")])))).toBe(
      "",
    );
  });

  it("keeps mention menus inside narrow and edge-anchored viewports", () => {
    const position = promptMenuPosition(
      { left: 310, right: 315, top: 176, bottom: 188 },
      { width: 320, height: 200 },
    );

    expect(position.width).toBe(256);
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.left + position.width).toBeLessThanOrEqual(312);
    expect(position.top).toBeGreaterThanOrEqual(8);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(192);

    const phonePosition = promptMenuPosition(
      { left: 100, right: 100, top: 80, bottom: 90 },
      { width: 240, height: 160 },
    );
    expect(phonePosition.width).toBe(224);
    expect(phonePosition.left + phonePosition.width).toBeLessThanOrEqual(232);
    expect(phonePosition.top + phonePosition.maxHeight).toBeLessThanOrEqual(
      152,
    );
  });
});
