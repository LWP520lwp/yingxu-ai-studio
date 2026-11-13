/** Serializes plugin changes even before React has rendered a busy indicator. */
export function createPluginMutationSession() {
  let active: symbol | null = null;
  return {
    begin(): symbol | null {
      if (active) return null;
      active = Symbol("plugin-mutation");
      return active;
    },
    finish(ticket: symbol): boolean {
      if (active !== ticket) return false;
      active = null;
      return true;
    },
  };
}
