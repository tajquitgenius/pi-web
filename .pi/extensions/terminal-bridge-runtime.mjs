import { basename, join } from "node:path";
import { homedir } from "node:os";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const PROTOCOL_VERSION = 1;
const SINGLETON = Symbol.for("pi-web.terminal-bridge.v1");
const MAX_MESSAGE_CHARS = 48 << 20;
const MAX_IMAGE_DATA_CHARS = 14 << 20;
const MAX_TOTAL_IMAGE_DATA_CHARS = 44 << 20;
const MAX_SEEN_REQUESTS = 256;

function defaultAgentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function defaultReadConnection() {
  const root = defaultAgentDir();
  const state = JSON.parse(
    readFileSync(join(root, "pi-web", "terminal-bridge.json"), "utf8"),
  );
  const port = Number(state?.port);
  if (
    state?.version !== PROTOCOL_VERSION ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(state?.pid)
  ) {
    throw new Error("invalid terminal bridge discovery");
  }
  process.kill(state.pid, 0);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state?.token || ""))
    throw new Error("invalid terminal bridge token");
  return { port, token: state.token };
}

function ownerMarkerPath(sessionID) {
  return join(
    defaultAgentDir(),
    "pi-web",
    "terminal-owners",
    `${sessionID}.json`,
  );
}

function defaultWriteOwner(sessionID, nonce) {
  const dir = join(defaultAgentDir(), "pi-web", "terminal-owners");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = ownerMarkerPath(sessionID);
  writeFileSync(
    path,
    JSON.stringify({
      version: PROTOCOL_VERSION,
      pid: process.pid,
      nonce,
      sessionId: sessionID,
      updatedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
}

function defaultClearOwner(sessionID, nonce) {
  if (!sessionID) return;
  const path = ownerMarkerPath(sessionID);
  try {
    const current = JSON.parse(readFileSync(path, "utf8"));
    if (current?.nonce === nonce) rmSync(path, { force: true });
  } catch {
    // Missing or malformed stale markers expire server-side.
  }
}

function statusSnapshot(pi, context, state) {
  const model = context?.model;
  return {
    state: state || (context?.isIdle?.() === false ? "running" : "idle"),
    model: model?.id || "",
    modelName: model?.name || "",
    modelProvider: model?.provider || "",
    thinkingLevel: pi.getThinkingLevel?.() || context?.thinkingLevel || "off",
  };
}

function safeError(error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error || "terminal request failed");
  return message.slice(0, 500);
}

function promptContent(chat) {
  const message = typeof chat?.message === "string" ? chat.message : "";
  const images = Array.isArray(chat?.images) ? chat.images : [];
  if (images.length > 6) throw new Error("too many image attachments");
  if (images.length === 0) {
    if (!message) throw new Error("message or image required");
    return message;
  }
  const content = [];
  let totalImageChars = 0;
  if (message) content.push({ type: "text", text: message });
  for (const image of images) {
    if (
      image?.type !== "image" ||
      typeof image.data !== "string" ||
      image.data.length > MAX_IMAGE_DATA_CHARS ||
      typeof image.mimeType !== "string" ||
      !image.mimeType.startsWith("image/")
    ) {
      throw new Error("invalid image attachment");
    }
    totalImageChars += image.data.length;
    if (totalImageChars > MAX_TOTAL_IMAGE_DATA_CHARS)
      throw new Error("image attachments are too large");
    content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  return content;
}

export function wirePiWebTerminalBridge(pi, options = {}) {
  const previous = globalThis[SINGLETON];
  previous?.dispose?.();

  const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
  const readConnection = options.readConnection || defaultReadConnection;
  const schedule =
    options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.unschedule || ((timer) => clearTimeout(timer));
  const writeOwner = options.writeOwner || defaultWriteOwner;
  const clearOwner = options.clearOwner || defaultClearOwner;
  const ownerNonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let disposed = false;
  let sessionActive = false;
  let context;
  let sessionID = "";
  let socket;
  let timer;
  let heartbeatTimer;
  let generation = 0;
  let retry = 0;
  let ready = false;
  let reconnectBlocked = false;
  let serverToken = "";
  let requestChain = Promise.resolve();
  const seen = new Map();

  const send = (value) => {
    if (!socket || socket.readyState !== 1) return false;
    socket.send(JSON.stringify(value));
    return true;
  };

  const sendState = (state) => {
    if (ready && context)
      send({ type: "state", state: statusSnapshot(pi, context, state) });
  };

  const remember = (id, response) => {
    seen.set(id, response);
    while (seen.size > MAX_SEEN_REQUESTS) seen.delete(seen.keys().next().value);
  };

  const handleRequest = async (request, requestGeneration) => {
    if (
      disposed ||
      !ready ||
      requestGeneration !== generation ||
      request?.type !== "request" ||
      typeof request.id !== "string" ||
      request.id.length < 1 ||
      request.id.length > 128
    ) {
      return;
    }
    const duplicate = seen.get(request.id);
    if (duplicate) {
      send(duplicate);
      return;
    }
    let response;
    try {
      switch (request.operation) {
        case "prompt": {
          const content = promptContent(request.chat);
          sendState("running");
          pi.sendUserMessage(content, {
            deliverAs: "steer",
            expandPromptTemplates: true,
          });
          break;
        }
        case "abort":
          context?.abort?.();
          break;
        case "get_commands": {
          const commands = (pi.getCommands?.() || []).map((command) => ({
            name: command.name,
            description: command.description || "",
            source: command.source || "extension",
          }));
          response = { type: "response", id: request.id, ok: true, commands };
          break;
        }
        case "set_model": {
          const model = context?.modelRegistry?.find?.(
            request.provider,
            request.modelId,
          );
          if (!model) throw new Error("model not found");
          const changed = await pi.setModel(model);
          if (!changed) throw new Error("model credentials unavailable");
          sendState();
          break;
        }
        case "set_thinking":
          if (
            !/^(off|minimal|low|medium|high|xhigh|max)$/.test(
              request.level || "",
            )
          ) {
            throw new Error("invalid thinking level");
          }
          pi.setThinkingLevel(request.level);
          sendState();
          break;
        case "set_session_name":
          if (typeof request.name !== "string" || !request.name.trim())
            throw new Error("session name required");
          pi.setSessionName(request.name.trim());
          break;
        case "set_label":
          if (typeof request.entryId !== "string" || !request.entryId)
            throw new Error("entry id required");
          pi.setLabel(
            request.entryId,
            typeof request.label === "string" && request.label
              ? request.label
              : undefined,
          );
          break;
        default:
          throw new Error("unsupported terminal operation");
      }
      response ||= { type: "response", id: request.id, ok: true };
    } catch (error) {
      if (request.operation === "prompt") sendState();
      response = {
        type: "response",
        id: request.id,
        ok: false,
        error: safeError(error),
      };
    }
    remember(request.id, response);
    if (requestGeneration === generation) send(response);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      unschedule(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const refreshOwner = () => {
    if (disposed || !sessionActive || !sessionID) return;
    try {
      writeOwner(sessionID, ownerNonce);
    } catch (error) {
      context?.ui?.notify?.(
        `Terminal bridge disabled: ${safeError(error)}`,
        "warning",
      );
      sessionActive = false;
      disconnect();
      return;
    }
    heartbeatTimer = schedule(() => {
      heartbeatTimer = undefined;
      refreshOwner();
    }, 2000);
  };

  const clearCurrentOwner = () => {
    stopHeartbeat();
    try {
      clearOwner(sessionID, ownerNonce);
    } catch {
      // A stale heartbeat expires server-side if cleanup is interrupted.
    }
  };

  const scheduleReconnect = () => {
    if (disposed || !sessionActive || reconnectBlocked || timer) return;
    const ceiling = Math.min(15_000, 500 * 2 ** Math.min(retry, 5));
    const delay = Math.floor(Math.random() * ceiling);
    retry += 1;
    timer = schedule(() => {
      timer = undefined;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || !sessionActive || !context || !sessionID || !WebSocketImpl)
      return;
    let connection;
    try {
      connection = readConnection();
    } catch {
      scheduleReconnect();
      return;
    }
    if (serverToken && serverToken !== connection.token) seen.clear();
    serverToken = connection.token;
    const currentGeneration = ++generation;
    ready = false;
    try {
      socket = new WebSocketImpl(
        `ws://127.0.0.1:${connection.port}/api/terminal/connect`,
        ["pi-web-terminal-v1", `token.${connection.token}`],
      );
    } catch {
      scheduleReconnect();
      return;
    }
    socket.addEventListener("open", () => {
      if (currentGeneration !== generation || disposed || !sessionActive)
        return;
      send({
        type: "hello",
        version: PROTOCOL_VERSION,
        sessionId: sessionID,
        sessionUuid: context?.sessionManager?.getSessionId?.() || "",
        leafId: context?.sessionManager?.getLeafId?.() || "",
        state: statusSnapshot(pi, context),
      });
    });
    socket.addEventListener("message", (event) => {
      if (
        currentGeneration !== generation ||
        typeof event.data !== "string" ||
        event.data.length > MAX_MESSAGE_CHARS
      ) {
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        socket?.close?.(1003, "invalid terminal bridge message");
        return;
      }
      if (message?.type === "ready") {
        ready = true;
        retry = 0;
        return;
      }
      requestChain = requestChain.then(() =>
        handleRequest(message, currentGeneration),
      );
    });
    socket.addEventListener("close", (event) => {
      if (currentGeneration !== generation) return;
      if (event?.reason?.includes?.("behind disk")) {
        reconnectBlocked = true;
        context?.ui?.notify?.(
          "This terminal session changed on disk. Quit and resume it before using pi-web chat.",
          "warning",
        );
      } else if (event?.reason?.includes?.("already has a terminal owner")) {
        reconnectBlocked = true;
        sessionActive = false;
        clearCurrentOwner();
        context?.ui?.notify?.(
          "Another terminal already owns pi-web control for this session. Close it or resume this session again.",
          "warning",
        );
      }
      ready = false;
      socket = undefined;
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      // close drives bounded reconnect; errors remain intentionally quiet.
    });
  };

  const disconnect = () => {
    generation += 1;
    ready = false;
    if (timer) {
      unschedule(timer);
      timer = undefined;
    }
    const activeSocket = socket;
    socket = undefined;
    try {
      activeSocket?.close?.(1000, "terminal session changed");
    } catch {
      // The socket may already be closing.
    }
  };

  const controller = {
    dispose() {
      disposed = true;
      sessionActive = false;
      clearCurrentOwner();
      disconnect();
      if (globalThis[SINGLETON] === controller) delete globalThis[SINGLETON];
    },
  };
  globalThis[SINGLETON] = controller;

  pi.on("session_start", (_event, nextContext) => {
    if (disposed) return;
    clearCurrentOwner();
    disconnect();
    context = nextContext;
    reconnectBlocked = false;
    sessionActive = nextContext?.mode === "tui";
    sessionID = basename(nextContext?.sessionManager?.getSessionFile?.() || "");
    if (sessionActive && sessionID) {
      refreshOwner();
      if (sessionActive) connect();
    }
  });
  pi.on("session_shutdown", () => {
    if (disposed) return;
    sessionActive = false;
    clearCurrentOwner();
    disconnect();
    sessionID = "";
    context = undefined;
  });
  pi.on("agent_start", (_event, nextContext) => {
    if (disposed) return;
    context = nextContext;
    sendState("running");
  });
  pi.on("agent_settled", (_event, nextContext) => {
    if (disposed) return;
    context = nextContext;
    if (nextContext?.isIdle?.() !== false) sendState("idle");
  });
  pi.on("model_select", (_event, nextContext) => {
    if (disposed) return;
    context = nextContext;
    sendState();
  });
  pi.on("thinking_level_select", (_event, nextContext) => {
    if (disposed) return;
    context = nextContext;
    sendState();
  });

  return controller;
}
