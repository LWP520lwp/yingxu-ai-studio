/** Transport-ready image reference shared by editing, generation, and persistence. */
export type ReferenceImage = Readonly<{
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  url?: string;
  storageKey?: string;
}>;
