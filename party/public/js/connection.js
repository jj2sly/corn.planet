// Socket.IO connection shared by the host screen and phones.

import { io } from "/socket.io/socket.io.esm.min.js";
import { getToken, initAuth } from "./auth.js";

/**
 * Connects with the current login (if any). If the login can't be verified the connection
 * falls back to guest mode rather than failing, and onAuthFallback is called once.
 */
export async function connect({ onState, onEnded, onStatus, onAuthFallback, onHello }) {
  await initAuth();
  let guestOnly = false;

  const socket = io({
    auth: (cb) => {
      if (guestOnly) return cb({});
      getToken()
        .then((token) => cb(token ? { token } : {}))
        .catch(() => cb({}));
    },
    reconnectionDelayMax: 4000,
  });

  socket.on("connect", () => onStatus?.("connected"));
  socket.on("disconnect", (reason) => onStatus?.(reason === "io client disconnect" ? "closed" : "lost"));
  socket.on("connect_error", (err) => {
    if (err.message === "AUTH_FAILED" && !guestOnly) {
      guestOnly = true;
      onAuthFallback?.();
      socket.connect();
      return;
    }
    onStatus?.("lost");
  });
  socket.on("hello", (hello) => onHello?.(hello));
  socket.on("state", (state) => onState(state));
  socket.on("session:ended", (info) => onEnded?.(info));

  /** Emits an event and resolves with the server's ack ({ ok, error, message, ... }). */
  const request = async (event, payload = {}) => {
    try {
      return await socket.timeout(8000).emitWithAck(event, payload);
    } catch {
      return { ok: false, error: "NETWORK", message: "No response from the server. Check your connection." };
    }
  };

  /** Realtime game input: no ack, and dropped rather than queued while disconnected. */
  const stream = (payload) => socket.volatile.emit("game:stream", payload);

  return { socket, request, stream };
}
