import type { CanvasNodeTypeId } from "./node";

export type CanvasAssistantReference = {
  id: string;
  type: CanvasNodeTypeId;
  title: string;
  dataUrl?: string;
  storageKey?: string;
  text?: string;
};

export type CanvasAssistantImage = {
  id: string;
  dataUrl: string;
  storageKey?: string;
  prompt: string;
};

export type CanvasAssistantMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "error";
  title?: string;
  text: string;
  meta?: string;
  detail?: unknown;
  references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
  id: string;
  title: string;
  messages: CanvasAssistantMessage[];
  createdAt: string;
  updatedAt: string;
};
