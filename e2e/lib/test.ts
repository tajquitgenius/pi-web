import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { STATE_FILE, type ServerState } from "./paths";

function readState(): ServerState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

interface Fixtures {
  /** Absolute path to the temp sessions dir the server watches. */
  sessionsDir: string;
  /** Absolute path to the isolated PI_CODING_AGENT_DIR. */
  agentDir: string;
}

export const test = base.extend<Fixtures>({
  baseURL: async ({}, use) => {
    await use(readState().baseURL);
  },
  sessionsDir: async ({}, use) => {
    await use(readState().sessionsDir);
  },
  agentDir: async ({}, use) => {
    await use(readState().agentDir);
  },
});

export { expect };
