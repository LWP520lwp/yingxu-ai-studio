export { createAtlasPluginStorage } from "./storage";

type EventHandler = (payload?: unknown) => void;

class PluginEventHub {
  private readonly topics = new Map<string, Set<EventHandler>>();

  subscribe(topicName: string, handler: EventHandler) {
    let subscribers = this.topics.get(topicName);
    if (!subscribers) {
      subscribers = new Set();
      this.topics.set(topicName, subscribers);
    }
    subscribers.add(handler);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      subscribers!.delete(handler);
      if (!subscribers!.size && this.topics.get(topicName) === subscribers) {
        this.topics.delete(topicName);
      }
    };
  }

  publish(topicName: string, payload?: unknown) {
    const subscribers = this.topics.get(topicName);
    if (!subscribers) return;
    for (const handler of Array.from(subscribers)) {
      if (!subscribers.has(handler)) continue;
      try {
        handler(payload);
      } catch (error) {
        console.error(
          `[atlas-plugin-event] handler for "${topicName}" failed`,
          error,
        );
      }
    }
  }
}

const hub = new PluginEventHub();

export function emitAtlasPluginEvent(topicName: string, payload?: unknown) {
  hub.publish(topicName, payload);
}

export function onAtlasPluginEvent(topicName: string, handler: EventHandler) {
  return hub.subscribe(topicName, handler);
}
