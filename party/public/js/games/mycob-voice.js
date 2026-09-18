// Where a narrator voice plugs in. There is none yet: the game is text-first and text is always
// authoritative. A future provider (a TTS service, a friend's AI voice) implements
//
//   { speak(event): Promise<void> | void }      event = { id, type, text }
//
// and is registered with setVoiceProvider(). Each narration event is spoken at most once, in
// order, and nothing in the game ever waits for audio: a slow or failing provider only skips lines.

let provider = null;
const spoken = new Set();
let queue = Promise.resolve();

export function setVoiceProvider(next) {
  provider = next && typeof next.speak === "function" ? next : null;
}

/** Hands new narration events to the provider. `scope` keeps ids unique across games (the incident code). */
export function speakNew(scope, events) {
  for (const event of events) {
    const key = `${scope}:${event.id}`;
    if (spoken.has(key)) continue;
    spoken.add(key);
    if (!provider) continue;
    const current = provider;
    // A line that never finishes can't hold up the ones after it.
    const giveUp = new Promise((resolve) => setTimeout(resolve, 20_000));
    queue = queue.then(() => Promise.race([current.speak(event), giveUp])).catch(() => {});
  }
}
