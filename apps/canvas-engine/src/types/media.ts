export interface RemoteMediaReference {
  id: string;
  name: string;
  type: string;
  url: string;
  storageKey?: string;
}

export interface ReferenceVideo extends RemoteMediaReference {
  bytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface ReferenceAudio extends RemoteMediaReference {
  durationMs?: number;
}
