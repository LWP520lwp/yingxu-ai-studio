import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowsInSimple, ArrowsOutSimple, ArrowCounterClockwise, Atom, FilmStrip, HandGrabbing, SquaresFour, TextT, Waveform } from "@phosphor-icons/react";
import { cn } from "./components";
import "./studio-sculpture.css";

const initialRotation = { x: -13, y: -24 };
/** A small CSS 3D sculpture. Direct manipulation updates a leaf without a rendering loop or WebGL. */
export const StudioSculpture = memo(function StudioSculpture() {
  const [expanded, setExpanded] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const rotation = useRef({ ...initialRotation });
  const pointer = useRef<{ id: number; x: number; y: number; fromX: number; fromY: number } | null>(null);
  const frame = useRef(0);
  const paint = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      stage.current?.style.setProperty("--sculpture-x", `${rotation.current.x}deg`);
      stage.current?.style.setProperty("--sculpture-y", `${rotation.current.y}deg`);
    });
  };
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  const reset = () => { rotation.current = { ...initialRotation }; paint(); };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, fromX: rotation.current.x, fromY: rotation.current.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const origin = pointer.current;
    if (!origin || origin.id !== event.pointerId) return;
    rotation.current = { x: Math.max(-34, Math.min(28, origin.fromX - (event.clientY - origin.y) * .19)), y: Math.max(-55, Math.min(45, origin.fromY + (event.clientX - origin.x) * .22)) };
    paint();
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") { reset(); return; }
    const next = { ...rotation.current };
    if (event.key === "ArrowLeft") next.y = Math.max(-55, next.y - 5);
    if (event.key === "ArrowRight") next.y = Math.min(45, next.y + 5);
    if (event.key === "ArrowUp") next.x = Math.max(-34, next.x - 5);
    if (event.key === "ArrowDown") next.x = Math.min(28, next.x + 5);
    rotation.current = next; paint();
  };
  return <div className="studio-sculpture">
    <div className={cn("sculpture-viewport", expanded && "is-expanded")} tabIndex={0} role="group" aria-label="三维创作结构：拖动或按方向键旋转，Home 键复位" aria-describedby="sculpture-help" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={() => { pointer.current = null; if (stage.current?.parentElement) delete stage.current.parentElement.dataset.dragging; }} onKeyDown={key}>
      <div className="sculpture-stage" ref={stage} style={{ "--sculpture-x": `${initialRotation.x}deg`, "--sculpture-y": `${initialRotation.y}deg` } as CSSProperties} aria-hidden="true">
        <div className="sculpture-foundation"><i/><i/><i/><i/><span/></div>
        <div className="sculpture-sheet sculpture-sheet-notes"><div className="sculpture-sheet-bar"><TextT size={13}/><span>想法</span><i/></div><span className="sculpture-text-line"/><span className="sculpture-text-line"/><span className="sculpture-text-line"/><div className="sculpture-source-mark"><Atom size={21} weight="thin"/><span>知识 · 证据</span></div></div>
        <div className="sculpture-sheet sculpture-sheet-canvas"><div className="sculpture-sheet-bar"><SquaresFour size={13}/><span>构建</span><i/></div><div className="sculpture-node sculpture-node-a"><TextT size={15}/></div><div className="sculpture-link sculpture-link-a"/><div className="sculpture-node sculpture-node-b"><Atom size={24} weight="thin"/></div><div className="sculpture-link sculpture-link-b"/><div className="sculpture-node sculpture-node-c"><Waveform size={18}/></div></div>
        <div className="sculpture-sheet sculpture-sheet-film"><div className="sculpture-sheet-bar"><FilmStrip size={13}/><span>表达</span><i/></div><div className="sculpture-film-orbit"><div/><i/><span/></div><div className="sculpture-film-caption"/><div className="sculpture-film-tracks"><i/><i/><i/><i/><i/></div></div>
      </div>
    </div>
    <div className="sculpture-controls"><p id="sculpture-help"><HandGrabbing size={14}/>拖动，换个角度看创作</p><div><button aria-label={expanded ? "收拢三维结构" : "展开三维结构"} aria-pressed={expanded} title={expanded ? "收拢结构" : "展开结构"} onClick={() => setExpanded(!expanded)}>{expanded ? <ArrowsInSimple size={15}/> : <ArrowsOutSimple size={15}/>}</button><button aria-label="复位三维视角" title="复位视角" onClick={reset}><ArrowCounterClockwise size={15}/></button></div></div>
  </div>;
});
