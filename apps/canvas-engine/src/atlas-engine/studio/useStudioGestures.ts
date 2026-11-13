import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type {
  CanvasNodeData,
  Position,
  ViewportTransform,
} from "@/types/canvas";
import type { StudioCorner, StudioMarquee, StudioWire } from "./StudioScene";
import { makeStudioNode, studioId, StudioSession } from "./studio-document";

type ClientPoint = { x: number; y: number; pointerId?: number };
type WireTarget = { nodeId: string; side?: "source" | "target" };
type Options = {
  session: StudioSession;
  containerRef: RefObject<HTMLElement | null>;
  tool: "select" | "pan";
  configTitle?: string;
  onStart?(): void;
};
type Start = { client: ClientPoint; moved: boolean; pointerId?: number };
type Gesture = Start &
  (
    | { kind: "pan"; viewport: ViewportTransform }
    | {
        kind: "move";
        positions: ReadonlyMap<string, Position>;
        scale: number;
        journal: boolean;
      }
    | {
        kind: "resize";
        node: CanvasNodeData;
        corner: StudioCorner;
        scale: number;
        journal: boolean;
      }
    | { kind: "marquee"; from: Position; baseline: ReadonlySet<string> }
    | { kind: "wire"; wire: StudioWire }
  );

/** The hand uses the hit surface; Space and the middle button always navigate. */
export function studioGestureIntent(input: {
  tool: "select" | "pan";
  surface: "canvas" | "node" | "port" | "resize";
  button: number;
  shiftKey: boolean;
  space: boolean;
}): "pan" | "marquee" | "move" | "wire" | "resize" | "ignore" {
  if (input.button !== 0 && input.button !== 1) return "ignore";
  if (input.button === 1 || input.space) return "pan";
  if (input.surface === "node") return "move";
  if (input.surface === "port") return "wire";
  if (input.surface === "resize") return "resize";
  return input.shiftKey || input.tool === "select" ? "marquee" : "pan";
}

/** Group membership is a graph: expanding until stable also handles nested imported groups. */
export function studioMoveSet(
  nodes: readonly CanvasNodeData[],
  selection: ReadonlySet<string>,
): Set<string> {
  const result = new Set(selection);
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const group = node.metadata?.groupId;
    if (!group) continue;
    const members = children.get(group);
    if (members) members.push(node.id);
    else children.set(group, [node.id]);
  }
  const pending = [...result];
  for (let i = 0; i < pending.length; i++)
    for (const child of children.get(pending[i]) || []) {
      if (!result.has(child)) {
        result.add(child);
        pending.push(child);
      }
    }
  return result;
}

export function studioMarqueeSelection(
  nodes: readonly CanvasNodeData[],
  box: StudioMarquee,
  baseline: ReadonlySet<string> = new Set(),
): Set<string> {
  const left = Math.min(box.from.x, box.to.x),
    right = Math.max(box.from.x, box.to.x);
  const top = Math.min(box.from.y, box.to.y),
    bottom = Math.max(box.from.y, box.to.y);
  const picked = new Set(baseline);
  for (const node of nodes)
    if (
      node.position.x <= right &&
      node.position.x + node.width >= left &&
      node.position.y <= bottom &&
      node.position.y + node.height >= top
    )
      picked.add(node.id);
  return picked;
}

/** Resizing keeps the opposite corner fixed, including when the minimum size is reached. */
export function studioResizeGeometry(
  node: CanvasNodeData,
  corner: StudioCorner,
  delta: Position,
): Pick<CanvasNodeData, "position" | "width" | "height"> {
  const west = corner.endsWith("w"),
    north = corner.startsWith("n");
  let width = Math.max(80, node.width + delta.x * (west ? -1 : 1));
  let height = Math.max(64, node.height + delta.y * (north ? -1 : 1));
  if (
    (node.type === "image" || node.type === "video") &&
    !node.metadata?.freeResize
  ) {
    const ratio = node.width / Math.max(1, node.height);
    if (Math.abs(delta.x / node.width) >= Math.abs(delta.y / node.height))
      height = Math.max(64, width / ratio);
    else width = Math.max(80, height * ratio);
    width = Math.max(width, height * ratio);
    height = width / ratio;
  }
  return {
    width,
    height,
    position: {
      x: west ? node.position.x + node.width - width : node.position.x,
      y: north ? node.position.y + node.height - height : node.position.y,
    },
  };
}

/** One command adds both a generated task and its edge; a single undo removes both. */
export function finishStudioWire(
  session: StudioSession,
  wire: StudioWire,
  drop: Position,
  target: WireTarget | null,
  allowCreate: boolean,
  title = "生成任务",
): boolean {
  const origin = session.read().nodes.find((node) => node.id === wire.nodeId);
  if (!origin || !session.alive()) return false;
  if (target) {
    if (target.side === wire.side) return false;
    return wire.side === "source"
      ? session.connect(wire.nodeId, target.nodeId)
      : session.connect(target.nodeId, wire.nodeId);
  }
  if (!allowCreate) return false;
  const node = makeStudioNode("config", drop.x, drop.y - 74, title, {
    generationMode: origin.type === "image" ? "video" : "image",
    ...(wire.side === "source"
      ? { composerContent: `@[node:${origin.id}]` }
      : {}),
  });
  if (wire.side === "target") node.position.x -= node.width;
  const from = wire.side === "source" ? origin.id : node.id;
  const to = wire.side === "source" ? node.id : origin.id;
  session.insert([node], [{ id: studioId(), fromNodeId: from, toNodeId: to }]);
  return true;
}

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input,textarea,select,[contenteditable='true'],[role='textbox']",
      ),
    )
  );
}

export function useStudioGestures(options: Options) {
  const { session, containerRef } = options;
  const settings = useRef(options);
  settings.current = options;
  const active = useRef<Gesture | null>(null);
  const pending = useRef<ClientPoint | null>(null);
  const frame = useRef<number | null>(null);
  const space = useRef(false);
  const [wire, setWire] = useState<StudioWire | null>(null);
  const [marquee, setMarquee] = useState<StudioMarquee | null>(null);
  const [interaction, setInteraction] = useState<Gesture["kind"] | null>(null);

  const world = useCallback(
    (point: ClientPoint): Position => {
      const rect = containerRef.current?.getBoundingClientRect();
      const view = session.read().viewport;
      return {
        x: (point.x - (rect?.left || 0) - view.x) / view.k,
        y: (point.y - (rect?.top || 0) - view.y) / view.k,
      };
    },
    [containerRef, session],
  );

  const update = useCallback(
    (point: ClientPoint) => {
      const gesture = active.current;
      if (
        !gesture ||
        !session.alive() ||
        (gesture.pointerId !== undefined &&
          point.pointerId !== undefined &&
          gesture.pointerId !== point.pointerId)
      )
        return;
      const dx = point.x - gesture.client.x,
        dy = point.y - gesture.client.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
      if (!gesture.moved) setInteraction(gesture.kind);
      gesture.moved = true;
      if (gesture.kind === "move" || gesture.kind === "resize") {
        if (!gesture.journal) {
          session.beginGesture(
            gesture.kind === "move"
              ? gesture.positions.keys()
              : [gesture.node.id],
          );
          gesture.journal = true;
        }
        if (gesture.kind === "move") {
          session.changeGeometry((node) => {
            const start = gesture.positions.get(node.id);
            return start
              ? {
                  position: {
                    x: start.x + dx / gesture.scale,
                    y: start.y + dy / gesture.scale,
                  },
                }
              : undefined;
          });
        } else {
          const geometry = studioResizeGeometry(gesture.node, gesture.corner, {
            x: dx / gesture.scale,
            y: dy / gesture.scale,
          });
          session.changeGeometry((node) =>
            node.id === gesture.node.id ? geometry : undefined,
          );
        }
      } else if (gesture.kind === "pan") {
        session.moveViewport({
          ...gesture.viewport,
          x: gesture.viewport.x + dx,
          y: gesture.viewport.y + dy,
        });
      } else if (gesture.kind === "marquee") {
        const box = { from: gesture.from, to: world(point) };
        setMarquee(box);
        session.select(
          studioMarqueeSelection(session.read().nodes, box, gesture.baseline),
        );
      } else setWire({ ...gesture.wire, cursor: world(point) });
    },
    [session, world],
  );

  const clear = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    const gesture = active.current;
    active.current = null;
    if (gesture) setInteraction(null);
    if (
      (gesture?.kind === "move" || gesture?.kind === "resize") &&
      gesture.journal
    )
      session.endGesture();
    setWire(null);
    setMarquee(null);
  }, [session]);

  const start = useCallback(
    (gesture: Gesture) => {
      clear();
      settings.current.onStart?.();
      active.current = gesture;
    },
    [clear],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!active.current) return;
      if (
        active.current.pointerId !== undefined &&
        event.pointerId !== active.current.pointerId
      )
        return;
      pending.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };
      if (frame.current === null)
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const point = pending.current;
          pending.current = null;
          if (point) update(point);
        });
    };
    const up = (event: PointerEvent) => {
      const gesture = active.current;
      if (
        !gesture ||
        (gesture.pointerId !== undefined &&
          event.pointerId !== gesture.pointerId)
      )
        return;
      const point = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };
      update(point);
      if (gesture.kind === "wire" && gesture.moved) {
        const hit = document.elementFromPoint(point.x, point.y);
        const port = hit?.closest<HTMLElement>("[data-studio-port]");
        const article = hit?.closest<HTMLElement>("[data-node-id]");
        const rect = containerRef.current?.getBoundingClientRect();
        const inside = Boolean(
          rect &&
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom &&
          hit &&
          containerRef.current?.contains(hit),
        );
        const target = !inside
          ? null
          : port
            ? {
                nodeId: port.dataset.studioPort!,
                side: port.dataset.portSide as "source" | "target",
              }
            : article
              ? { nodeId: article.dataset.nodeId! }
              : null;
        finishStudioWire(
          session,
          gesture.wire,
          world(point),
          target,
          inside &&
            !hit?.closest(
              "button,input,textarea,a,[data-connection-id],[data-studio-interactive]",
            ),
          settings.current.configTitle,
        );
      }
      clear();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !editable(event.target)) {
        space.current = true;
        if (containerRef.current?.contains(event.target as Node))
          event.preventDefault();
      }
      if (event.key === "Escape") clear();
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") space.current = false;
    };
    const blur = () => {
      space.current = false;
      clear();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      clear();
    };
  }, [clear, containerRef, session, update, world]);

  const intent = (
    event: ReactPointerEvent,
    surface: "canvas" | "node" | "port" | "resize",
  ) =>
    studioGestureIntent({
      tool: settings.current.tool,
      surface,
      button: event.button,
      shiftKey: event.shiftKey,
      space: space.current,
    });
  const beginPan = (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    start({
      kind: "pan",
      client: { x: event.clientX, y: event.clientY },
      moved: false,
      pointerId: "pointerId" in event ? event.pointerId : undefined,
      viewport: { ...session.read().viewport },
    });
  };
  const onCanvasDown = (event: ReactPointerEvent<HTMLElement>) => {
    const action = intent(event, "canvas");
    if (action === "ignore") return;
    // Pointer events reach the canvas even when a node's mouse handler edits text or media.
    if (intent(event, "node") === "pan") {
      beginPan(event);
      return;
    }
    const hit = event.target as Element;
    if (
      hit.closest(
        "[data-node-id],[data-connection-id],button,input,textarea,a,[data-studio-interactive]",
      )
    )
      return;
    event.preventDefault();
    const base = {
      client: { x: event.clientX, y: event.clientY },
      moved: false,
      pointerId: event.pointerId,
    };
    if (action === "pan")
      start({ ...base, kind: "pan", viewport: { ...session.read().viewport } });
    else {
      const baseline = event.shiftKey
        ? new Set(session.snapshot().selection)
        : new Set<string>();
      if (!event.shiftKey) session.select([]);
      start({ ...base, kind: "marquee", from: world(base.client), baseline });
    }
  };
  const onNodeDown = (event: ReactPointerEvent, node: CanvasNodeData) => {
    const action = intent(event, "node");
    if (action === "ignore") return;
    if (action === "pan") {
      beginPan(event);
      return;
    }
    if (editable(event.target)) return;
    const hit = event.target as Element;
    if (
      hit.closest("video,audio,a,select,[data-studio-interactive]") ||
      (hit.closest("button") && !hit.closest(".studio-node-heading"))
    )
      return;
    event.stopPropagation();
    event.preventDefault();
    const base = {
      client: { x: event.clientX, y: event.clientY },
      moved: false,
      pointerId: event.pointerId,
    };
    const selection = new Set(session.snapshot().selection);
    if (event.shiftKey && selection.has(node.id)) {
      selection.delete(node.id);
      session.select(selection);
      return;
    }
    if (!selection.has(node.id)) {
      if (!event.shiftKey) selection.clear();
      selection.add(node.id);
    }
    session.select(selection);
    const included = studioMoveSet(session.read().nodes, selection);
    const positions = new Map(
      session
        .read()
        .nodes.filter((item) => included.has(item.id))
        .map((item) => [item.id, { ...item.position }]),
    );
    start({
      ...base,
      kind: "move",
      positions,
      scale: session.read().viewport.k,
      journal: false,
    });
  };
  const onConnect = (
    event: ReactPointerEvent,
    nodeId: string,
    side: "source" | "target",
  ) => {
    const action = intent(event, "port");
    if (action === "ignore") return;
    if (action === "pan") {
      beginPan(event);
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const client = { x: event.clientX, y: event.clientY };
    const next = { nodeId, side, cursor: world(client) };
    start({
      kind: "wire",
      client,
      moved: false,
      wire: next,
      pointerId: event.pointerId,
    });
    setWire(next);
  };
  const onResize = (
    event: ReactPointerEvent,
    node: CanvasNodeData,
    corner: StudioCorner,
  ) => {
    const action = intent(event, "resize");
    if (action === "ignore") return;
    if (action === "pan") {
      beginPan(event);
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.select([node.id]);
    start({
      kind: "resize",
      client: { x: event.clientX, y: event.clientY },
      moved: false,
      pointerId: event.pointerId,
      node: { ...node, position: { ...node.position } },
      corner,
      scale: session.read().viewport.k,
      journal: false,
    });
  };
  return {
    wire,
    marquee,
    interaction,
    isActive: useCallback(() => active.current !== null, []),
    onCanvasDown,
    onNodeDown,
    onConnect,
    onResize,
    cancel: clear,
  };
}
