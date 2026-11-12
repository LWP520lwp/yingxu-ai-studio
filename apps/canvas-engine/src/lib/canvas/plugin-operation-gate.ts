export type PluginOperationGate = {
  begin: () => number;
  beginFor: (pluginId: string) => number;
  claim: (pluginId: string, revision: number) => boolean;
  isCurrent: (pluginId: string, revision: number) => boolean;
};

export function createPluginOperationGate(): PluginOperationGate {
  let sequence = 0;
  const latestByPlugin = new Map<string, number>();

  return {
    begin: () => ++sequence,
    beginFor: (pluginId) => {
      const revision = ++sequence;
      latestByPlugin.set(pluginId, revision);
      return revision;
    },
    claim: (pluginId, revision) => {
      const latest = latestByPlugin.get(pluginId);
      if (latest !== undefined && latest > revision) return false;
      latestByPlugin.set(pluginId, revision);
      return true;
    },
    isCurrent: (pluginId, revision) =>
      latestByPlugin.get(pluginId) === revision,
  };
}
