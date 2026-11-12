export type AssetKind = "text" | "image" | "video";

type AssetBase<Kind extends AssetKind> = {
  id: string;
  kind: Kind;
  title: string;
  coverUrl: string;
  tags: string[];
  source?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type TextAsset = AssetBase<"text"> & {
  data: { content: string };
};

export type ImageAsset = AssetBase<"image"> & {
  data: {
    dataUrl: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  };
};

export type VideoAsset = AssetBase<"video"> & {
  data: {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  };
};

export type Asset = TextAsset | ImageAsset | VideoAsset;
