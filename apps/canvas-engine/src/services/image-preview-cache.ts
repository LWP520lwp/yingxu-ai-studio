import { createImageThumbnail } from "@/lib/image-thumbnail";
import { ObjectUrlRegistry, throwIfAborted } from "./media-storage-runtime";

type PreviewRecord = { version: number; blob?: Blob };
type PreviewStorage = {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

/** Writes to one image retain call order; failures never hold its next operation. */
export class ImageWriteLanes {
  private readonly tails = new Map<string, Promise<void>>();

  wait(key: string) {
    return this.tails.get(key) ?? Promise.resolve();
  }

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = this.wait(key).then(operation);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

class ThumbnailWorkers {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const acquire = () => {
        this.active += 1;
        resolve();
      };
      if (this.active < 4) acquire();
      else this.waiting.push(acquire);
    });
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

/** A preview job can publish only into the image lifetime that requested it. */
export class ImagePreviewCache {
  private readonly urls = new ObjectUrlRegistry();
  private readonly lifetimes = new Map<string, number>();
  private readonly changed = new Set<string>();
  private readonly reads = new Map<string, Promise<string | undefined>>();
  private readonly jobs = new Map<
    string,
    { lifetime: number; promise: Promise<void> }
  >();
  private readonly workers = new ThumbnailWorkers();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(
    private readonly records: PreviewStorage,
    private readonly originals: (key: string) => Promise<Blob | null>,
    private readonly writes: ImageWriteLanes,
  ) {}

  get(key?: string) {
    return key ? this.urls.get(key) : undefined;
  }
  snapshot() {
    return this.revision;
  }
  lifetime(key: string) {
    return this.lifetimes.get(key) ?? 0;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  invalidate(key: string) {
    const visible = Boolean(this.get(key));
    this.lifetimes.set(key, this.lifetime(key) + 1);
    this.changed.add(key);
    this.reads.delete(key);
    this.jobs.delete(key);
    this.urls.invalidate(key);
    if (visible) this.notify();
    return this.lifetime(key);
  }

  async removeRecord(key: string) {
    await this.records.removeItem(key);
  }

  ensure(key?: string): Promise<string | undefined> {
    if (!key || this.get(key)) return Promise.resolve(this.get(key));
    const reading = this.reads.get(key);
    if (reading) return reading;
    const lifetime = this.lifetime(key);
    const request = this.restore(key, lifetime);
    this.reads.set(key, request);
    const release = () => {
      if (this.reads.get(key) === request) this.reads.delete(key);
    };
    void request.then(release, release);
    return request;
  }

  build(
    key: string,
    source: Blob,
    lifetime: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const existing = this.jobs.get(key);
    if (existing?.lifetime === lifetime) return existing.promise;
    const promise = this.workers.run(async () => {
      throwIfAborted(signal);
      if (!this.current(key, lifetime)) return;
      let thumbnail: Blob | undefined;
      try {
        thumbnail = await createImageThumbnail(source);
      } catch {
        return;
      }
      throwIfAborted(signal);
      if (!this.current(key, lifetime)) return;
      await this.writes.run(key, async () => {
        if (!this.current(key, lifetime)) return;
        const record: PreviewRecord = { version: 1, blob: thumbnail };
        try {
          await this.records.setItem(key, record);
        } catch {
          return;
        }
        if (!this.current(key, lifetime)) {
          await this.removeRecord(key);
          return;
        }
        this.changed.delete(key);
        if (thumbnail) this.publish(key, thumbnail);
      });
    });
    this.jobs.set(key, { lifetime, promise });
    const release = () => {
      if (this.jobs.get(key)?.promise === promise) this.jobs.delete(key);
    };
    void promise.then(release, release);
    return promise;
  }

  private current(key: string, lifetime: number) {
    return this.lifetime(key) === lifetime;
  }

  private async restore(key: string, lifetime: number) {
    await this.writes.wait(key);
    if (!this.current(key, lifetime)) return this.get(key);
    const record = this.changed.has(key)
      ? null
      : await this.records.getItem<PreviewRecord>(key).catch(() => null);
    if (!this.current(key, lifetime)) return this.get(key);
    if (this.get(key)) return this.get(key);
    if (record?.version === 1) {
      if (record.blob instanceof Blob) return this.publish(key, record.blob);
      if (!record.blob) return undefined;
    }
    // Original loading neither joins a preview-write chain nor holds a write lane.
    void this.regenerate(key, lifetime).catch(() => undefined);
    return undefined;
  }

  private async regenerate(key: string, lifetime: number) {
    const source = await this.originals(key);
    if (source && this.current(key, lifetime) && !this.get(key)) {
      await this.build(key, source, lifetime);
    }
  }

  private publish(key: string, blob: Blob) {
    const cached = this.get(key);
    if (cached) return cached;
    const url = this.urls.put(key, blob);
    this.notify();
    return url;
  }

  private notify() {
    this.revision += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[image-previews] subscriber failed", error);
      }
    }
  }
}
