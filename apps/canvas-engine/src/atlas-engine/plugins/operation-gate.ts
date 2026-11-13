export type PluginOperationClock = Readonly<{
  begin: () => number;
  beginFor: (pluginId: string) => number;
  claim: (pluginId: string, revision: number) => boolean;
  isCurrent: (pluginId: string, revision: number) => boolean;
}>;

export function createPluginOperationClock(): PluginOperationClock {
  let revision = 0;
  const latest = new Map<string, number>();

  const nextRevision = () => ++revision;
  const beginFor = (pluginId: string) => {
    const current = nextRevision();
    latest.set(pluginId, current);
    return current;
  };

  return {
    begin: nextRevision,
    beginFor,
    claim(pluginId, candidate) {
      const current = latest.get(pluginId);
      if (current !== undefined && current > candidate) return false;
      latest.set(pluginId, candidate);
      return true;
    },
    isCurrent: (pluginId, candidate) => latest.get(pluginId) === candidate,
  };
}
