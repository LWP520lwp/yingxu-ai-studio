import type { CanvasConnection } from "./connection";

export type ConnectionHandle = {
  nodeId: string;
  handleType: "source" | "target";
};

export type SelectionBox = {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  initialSelectedNodeIds: string[];
};

export type ContextMenuState =
  | {
      type: "node";
      x: number;
      y: number;
      nodeId: string;
    }
  | {
      type: "connection";
      x: number;
      y: number;
      connectionId: CanvasConnection["id"];
    };
