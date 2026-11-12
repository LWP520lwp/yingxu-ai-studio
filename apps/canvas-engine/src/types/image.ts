/** Image identity plus the local or remote payload accepted by generation APIs. */
export type ReferenceImage = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  url?: string;
  storageKey?: string;
};
