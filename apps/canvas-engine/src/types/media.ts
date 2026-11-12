/** A remote media reference shared by video and audio generation inputs. */
export type RemoteMediaReference = {
  id: string;
  name: string;
  type: string;
  url: string;
  storageKey?: string;
};

export type ReferenceVideo = RemoteMediaReference & {
  bytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type ReferenceAudio = RemoteMediaReference & {
  durationMs?: number;
};
