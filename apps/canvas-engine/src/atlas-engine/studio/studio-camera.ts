import { animate } from "motion/react";
import type { ViewportTransform } from "@/types/canvas";

type Size = { width: number; height: number };
type Tween = (
  update: (progress: number) => void,
  complete: () => void,
) => { stop(): void };

/** Interpolate the world point under the screen centre as well as magnification.
 * This avoids the sideways sweep produced by interpolating CSS offsets alone. */
export function studioCameraFrame(
  from: ViewportTransform,
  to: ViewportTransform,
  size: Size,
  progress: number,
): ViewportTransform {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const mix = (a: number, b: number) => a + (b - a) * progress;
  const k = Math.exp(mix(Math.log(from.k), Math.log(to.k)));
  const center = { x: size.width / 2, y: size.height / 2 };
  return {
    k,
    x:
      center.x -
      mix((center.x - from.x) / from.k, (center.x - to.x) / to.k) * k,
    y:
      center.y -
      mix((center.y - from.y) / from.k, (center.y - to.y) / to.k) * k,
  };
}

const tween: Tween = (onUpdate, onComplete) =>
  animate(0, 1, { duration: 0.32, ease: "easeOut", onUpdate, onComplete });

/** Exactly one navigation owns the camera. New navigation and direct input
 * invalidate old callbacks, including a completion already queued by the driver. */
export function createStudioCamera(options: {
  read(): ViewportTransform;
  write(view: ViewportTransform): void;
  active?(value: boolean): void;
  tween?: Tween;
}) {
  let generation = 0;
  let running: ReturnType<Tween> | undefined;
  const stop = () => {
    generation++;
    running?.stop();
    running = undefined;
    options.active?.(false);
  };
  return {
    stop,
    move(to: ViewportTransform, size: Size, reducedMotion = false) {
      stop();
      const from = options.read();
      if (from.x === to.x && from.y === to.y && from.k === to.k) return;
      if (reducedMotion) {
        options.write(to);
        return;
      }
      const token = generation;
      options.active?.(true);
      running = (options.tween || tween)(
        (progress) => {
          if (token === generation)
            options.write(studioCameraFrame(from, to, size, progress));
        },
        () => {
          if (token !== generation) return;
          options.write(to);
          running = undefined;
          options.active?.(false);
        },
      );
    },
  };
}
