import { beforeEach, describe, expect, it, vi } from "vitest";
import { wirePiWebTerminalBridge } from "../../.pi/extensions/terminal-bridge-runtime.mjs";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  url: string;
  protocols: string[];

  constructor(url: string, protocols: string[] = []) {
    super();
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }

  receiveRaw(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  send(value: string) {
    this.sent.push(value);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    const event = new Event("close");
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
    });
    this.dispatchEvent(event);
  }
}

function makePi() {
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  return {
    handlers,
    on: vi.fn((name: string, handler: (event: any, ctx: any) => unknown) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    }),
    sendUserMessage: vi.fn(),
    getThinkingLevel: vi.fn(() => "high"),
    getCommands: vi.fn(() => []),
    setModel: vi.fn(async () => true),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    setLabel: vi.fn(),
  };
}

function tuiContext() {
  return {
    mode: "tui",
    isIdle: () => true,
    abort: vi.fn(),
    model: { id: "gpt-5.6", name: "GPT 5.6", provider: "openai-codex" },
    modelRegistry: { find: vi.fn() },
    sessionManager: {
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionId: () => "terminal-uuid",
      getLeafId: () => "leaf-1",
    },
    ui: { notify: vi.fn() },
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  delete (globalThis as any)[Symbol.for("pi-web.terminal-bridge.v1")];
});

describe("terminal bridge extension runtime", () => {
  it("keeps only the newest bridge active when Pi discovers duplicate extension copies", async () => {
    const pi = makePi();
    const options = {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner: vi.fn(),
      clearOwner: vi.fn(),
      schedule: vi.fn(),
    };
    wirePiWebTerminalBridge(pi as any, options);
    wirePiWebTerminalBridge(pi as any, options);
    const context = tuiContext();
    for (const handler of pi.handlers.get("session_start") || []) {
      await handler({ reason: "startup" }, context);
    }

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(options.writeOwner).toHaveBeenCalledOnce();
  });

  it("registers only persisted TUI sessions and releases ownership on shutdown", async () => {
    const pi = makePi();
    const writeOwner = vi.fn();
    const clearOwner = vi.fn();
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner,
      clearOwner,
      schedule: vi.fn(),
    });
    const rpcContext = { ...tuiContext(), mode: "rpc" };
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "startup" },
      rpcContext,
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(writeOwner).not.toHaveBeenCalled();

    const context = tuiContext();
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "reload" },
      context,
    );
    expect(writeOwner).toHaveBeenCalledWith(
      "session.jsonl",
      expect.any(String),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);

    await pi.handlers.get("session_shutdown")?.[0]?.(
      { reason: "quit" },
      context,
    );
    expect(clearOwner).toHaveBeenCalledWith(
      "session.jsonl",
      expect.any(String),
    );
    expect(FakeWebSocket.instances[0].readyState).toBe(3);
  });

  it("dispatches a PWA prompt into the active terminal without replaying it", async () => {
    const pi = makePi();
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner: vi.fn(),
      clearOwner: vi.fn(),
      schedule: vi.fn(),
    });
    const ctx = tuiContext();
    await pi.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "hello",
      version: 1,
      sessionId: "session.jsonl",
      sessionUuid: "terminal-uuid",
      leafId: "leaf-1",
    });
    expect(socket.protocols).toEqual([
      "pi-web-terminal-v1",
      `token.${"t".repeat(43)}`,
    ]);
    socket.receive({ type: "ready" });

    socket.receive({
      type: "request",
      id: "terminal-1",
      operation: "prompt",
      chat: { message: "from the PWA", images: [] },
    });
    await vi.waitFor(() => expect(pi.sendUserMessage).toHaveBeenCalledOnce());

    expect(pi.sendUserMessage).toHaveBeenCalledWith("from the PWA", {
      deliverAs: "steer",
      expandPromptTemplates: true,
    });
    await vi.waitFor(() =>
      expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
        type: "response",
        id: "terminal-1",
        ok: true,
      }),
    );

    socket.receive({
      type: "request",
      id: "terminal-1",
      operation: "prompt",
      chat: { message: "duplicate", images: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
  });

  it("routes model, thinking, abort, commands, name, and labels through the terminal", async () => {
    const pi = makePi();
    pi.getCommands.mockReturnValue([
      { name: "review", description: "Review changes", source: "extension" },
    ]);
    const context = tuiContext();
    const model = { id: "claude", provider: "anthropic" };
    context.modelRegistry.find.mockReturnValue(model);
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner: vi.fn(),
      clearOwner: vi.fn(),
      schedule: vi.fn(),
    });
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "startup" },
      context,
    );
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "ready" });
    const requests = [
      {
        id: "model",
        operation: "set_model",
        provider: "anthropic",
        modelId: "claude",
      },
      { id: "thinking", operation: "set_thinking", level: "medium" },
      { id: "abort", operation: "abort" },
      { id: "commands", operation: "get_commands" },
      { id: "name", operation: "set_session_name", name: "Phone task" },
      {
        id: "label",
        operation: "set_label",
        entryId: "entry-1",
        label: "checkpoint",
      },
      { id: "bad-thinking", operation: "set_thinking", level: "turbo" },
    ];
    for (const request of requests)
      socket.receive({ type: "request", ...request });
    await vi.waitFor(() => {
      const responses = socket.sent
        .map((value) => JSON.parse(value))
        .filter((value) => value.type === "response");
      expect(responses).toHaveLength(requests.length);
    });

    expect(context.modelRegistry.find).toHaveBeenCalledWith(
      "anthropic",
      "claude",
    );
    expect(pi.setModel).toHaveBeenCalledWith(model);
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("medium");
    expect(context.abort).toHaveBeenCalledOnce();
    expect(pi.setSessionName).toHaveBeenCalledWith("Phone task");
    expect(pi.setLabel).toHaveBeenCalledWith("entry-1", "checkpoint");
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "response",
      id: "commands",
      ok: true,
      commands: [
        { name: "review", description: "Review changes", source: "extension" },
      ],
    });
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "response",
      id: "bad-thinking",
      ok: false,
      error: "invalid thinking level",
    });
  });

  it("does not replay a prompt whose acknowledgement was lost during disconnect", async () => {
    const scheduled: Array<() => void> = [];
    const pi = makePi();
    pi.sendUserMessage.mockImplementation(() => {
      FakeWebSocket.instances[0].close(1011, "connection lost");
    });
    const context = tuiContext();
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner: vi.fn(),
      clearOwner: vi.fn(),
      schedule: (callback: () => void) => {
        scheduled.push(callback);
        return callback as any;
      },
      unschedule: vi.fn(),
    });
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "startup" },
      context,
    );
    const first = FakeWebSocket.instances[0];
    first.open();
    first.receive({ type: "ready" });
    first.receive({
      type: "request",
      id: "ambiguous-request",
      operation: "prompt",
      chat: { message: "dispatch once" },
    });
    await vi.waitFor(() => expect(pi.sendUserMessage).toHaveBeenCalledOnce());
    expect(first.sent.map((value) => JSON.parse(value))).not.toContainEqual(
      expect.objectContaining({ type: "response", id: "ambiguous-request" }),
    );

    scheduled.at(-1)?.();
    const second = FakeWebSocket.instances[1];
    second.open();
    second.receive({ type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
  });

  it("fails closed on malformed frames and duplicate terminal ownership", async () => {
    const pi = makePi();
    const context = tuiContext();
    const schedule = vi.fn();
    const clearOwner = vi.fn();
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner: vi.fn(),
      clearOwner,
      schedule,
      unschedule: vi.fn(),
    });
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "startup" },
      context,
    );
    const malformed = FakeWebSocket.instances[0];
    malformed.open();
    malformed.receiveRaw("not-json");
    expect(malformed.readyState).toBe(3);
    expect(schedule).toHaveBeenCalledTimes(2);

    const reconnect = schedule.mock.calls.at(-1)?.[0];
    reconnect?.();
    const duplicate = FakeWebSocket.instances[1];
    duplicate.open();
    duplicate.close(1008, "session already has a terminal owner");
    expect(context.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Another terminal already owns"),
      "warning",
    );
    expect(clearOwner).toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it("switches ownership and identity when the terminal resumes another session", async () => {
    const pi = makePi();
    const writeOwner = vi.fn();
    const clearOwner = vi.fn();
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner,
      clearOwner,
      schedule: vi.fn(),
      unschedule: vi.fn(),
    });
    const firstContext = tuiContext();
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "startup" },
      firstContext,
    );
    const first = FakeWebSocket.instances[0];
    first.open();

    const secondContext = tuiContext();
    secondContext.sessionManager.getSessionFile = () => "/tmp/second.jsonl";
    secondContext.sessionManager.getSessionId = () => "second-uuid";
    secondContext.sessionManager.getLeafId = () => "second-leaf";
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "switch" },
      secondContext,
    );
    const second = FakeWebSocket.instances[1];
    second.open();

    expect(first.readyState).toBe(3);
    expect(clearOwner).toHaveBeenCalled();
    expect(writeOwner.mock.calls.at(-1)?.[0]).toBe("second.jsonl");
    expect(JSON.parse(second.sent[0])).toMatchObject({
      sessionId: "second.jsonl",
      sessionUuid: "second-uuid",
      leafId: "second-leaf",
    });
  });

  it("maps image prompts and returns synchronous dispatch failures without retry", async () => {
    const pi = makePi();
    pi.sendUserMessage.mockImplementationOnce(() => {
      throw new Error("terminal rejected prompt");
    });
    wirePiWebTerminalBridge(pi as any, {
      WebSocketImpl: FakeWebSocket as any,
      readConnection: () => ({ port: 31415, token: "t".repeat(43) }),
      writeOwner: vi.fn(),
      clearOwner: vi.fn(),
      schedule: vi.fn(),
    });
    await pi.handlers.get("session_start")?.[0]?.(
      { reason: "startup" },
      tuiContext(),
    );
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "ready" });
    socket.receive({
      type: "request",
      id: "image-1",
      operation: "prompt",
      chat: {
        message: "inspect",
        images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      },
    });

    await vi.waitFor(() => expect(pi.sendUserMessage).toHaveBeenCalledOnce());
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      [
        { type: "text", text: "inspect" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
      { deliverAs: "steer", expandPromptTemplates: true },
    );
    await vi.waitFor(() =>
      expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
        type: "response",
        id: "image-1",
        ok: false,
        error: "terminal rejected prompt",
      }),
    );
  });
});
