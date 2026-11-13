import { describe, expect, it, vi } from "vitest";
import {
  createStudioCamera,
  studioCameraFrame,
} from "@/atlas-engine/studio/studio-camera";
import type { ViewportTransform } from "@/types/canvas";

const size = { width: 1200, height: 800 };
const from = { x: 60, y: 40, k: 0.5 };
const to = { x: -300, y: 120, k: 2 };
function harness() {
  let view: ViewportTransform = from;
  const drivers: {
    update: (p: number) => void;
    complete: () => void;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const active = vi.fn();
  const write = vi.fn((next: ViewportTransform) => {
    view = next;
  });
  const camera = createStudioCamera({
    read: () => view,
    write,
    active,
    tween: (update, complete) => {
      const driver = { update, complete, stop: vi.fn() };
      drivers.push(driver);
      return driver;
    },
  });
  return { camera, drivers, write, active, read: () => view };
}
describe("interruptible studio camera", () => {
  it("interpolates the centre in world space and scale logarithmically, with exact endpoints", () => {
    expect(studioCameraFrame(from, to, size, 0)).toBe(from);
    expect(studioCameraFrame(from, to, size, 1)).toBe(to);
    const halfway = studioCameraFrame(from, to, size, 0.5);
    expect(halfway.k).toBeCloseTo(1);
    expect((size.width / 2 - halfway.x) / halfway.k).toBeCloseTo(
      ((600 - from.x) / from.k + (600 - to.x) / to.k) / 2,
    );
    expect((400 - halfway.y) / halfway.k).toBeCloseTo(
      ((400 - from.y) / from.k + (400 - to.y) / to.k) / 2,
    );
  });
  it("a replacement starts at the currently visible frame, and old callbacks cannot teleport it", () => {
    const h = harness();
    h.camera.move(to, size);
    h.drivers[0].update(0.4);
    const interrupted = h.read();
    const replacement = { x: 900, y: -200, k: 0.8 };
    h.camera.move(replacement, size);
    expect(h.drivers[0].stop).toHaveBeenCalledOnce();
    h.drivers[0].update(1);
    h.drivers[0].complete();
    expect(h.read()).toBe(interrupted);
    h.drivers[1].update(0.5);
    expect(h.read()).toEqual(
      studioCameraFrame(interrupted, replacement, size, 0.5),
    );
    h.drivers[1].complete();
    expect(h.read()).toBe(replacement);
    expect(h.active).toHaveBeenLastCalledWith(false);
  });
  it("direct input stops navigation without finishing the old destination", () => {
    const h = harness();
    h.camera.move(to, size);
    h.drivers[0].update(0.2);
    h.camera.stop();
    const stopped = h.read();
    h.drivers[0].update(1);
    h.drivers[0].complete();
    expect(h.read()).toBe(stopped);
    expect(h.active).toHaveBeenLastCalledWith(false);
  });
  it("reduced motion changes view immediately and invalidates a running animation", () => {
    const h = harness();
    h.camera.move(to, size);
    const immediate = { x: 0, y: 0, k: 1 };
    h.camera.move(immediate, size, true);
    expect(h.drivers).toHaveLength(1);
    expect(h.read()).toBe(immediate);
    h.drivers[0].complete();
    expect(h.read()).toBe(immediate);
  });
  it("does not start a tween for an unchanged camera", () => {
    const h = harness();
    h.camera.move({ ...from }, size);
    expect(h.drivers).toHaveLength(0);
    expect(h.write).not.toHaveBeenCalled();
  });
});
