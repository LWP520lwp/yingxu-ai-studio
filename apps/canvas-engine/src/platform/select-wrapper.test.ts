import { describe, expect, it } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

describe("project select primitives", () => {
  it("keeps a controlled root and value-change contract", () => {
    const onValueChange = () => undefined;
    const root = Select({ value: "model-a", onValueChange, children: "items" });

    expect(root.props["data-slot"]).toBe("select");
    expect(root.props.value).toBe("model-a");
    expect(root.props.onValueChange).toBe(onValueChange);
  });

  it("provides a labeled trigger with a compact size and optional chevron", () => {
    const trigger = SelectTrigger({
      size: "sm",
      hideChevron: true,
      "aria-label": "Image model",
      children: "Model A",
    });

    expect(trigger.props["data-slot"]).toBe("select-trigger");
    expect(trigger.props["data-size"]).toBe("sm");
    expect(trigger.props["aria-label"]).toBe("Image model");
    expect(trigger.props.children).toEqual(["Model A", null]);
    expect(trigger.props.className).toContain("focus-visible:ring-2");
  });

  it("retains item values and popper positioning through the wrappers", () => {
    const item = SelectItem({
      value: "model-a",
      textValue: "Model A",
      children: "Model A",
    });
    const portal = SelectContent({
      position: "popper",
      align: "start",
      sideOffset: 6,
      children: item,
    });
    const content = portal.props.children;

    expect(item.props["data-slot"]).toBe("select-item");
    expect(item.props.value).toBe("model-a");
    expect(item.props.textValue).toBe("Model A");
    expect(content.props["data-slot"]).toBe("select-content");
    expect(content.props.position).toBe("popper");
    expect(content.props.align).toBe("start");
    expect(content.props.sideOffset).toBe(6);
  });
});
