import { utimesSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../lib/test";
import {
  buildSession,
  realWorkingDir,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";
import type { Locator, Page, TestInfo } from "@playwright/test";

const iphoneViewport = { width: 320, height: 568 };
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function skipNonMobileWebKit(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== "Mobile Safari",
    "The focused composer acceptance run uses the iPhone Mobile Safari project",
  );
}

async function openTestConversation(
  page: Page,
  sessionsDir: string,
  testInfo: TestInfo,
  prefix: string,
): Promise<void> {
  const { entries } = buildSession({ cwd: realWorkingDir() });
  const id = writeSession(
    sessionsDir,
    uniqueSessionName(testInfo, prefix),
    entries,
  );
  const sessionPath = join(sessionsDir, "--home-user-demo-project--", id);
  const old = new Date(Date.now() - 2_000);
  utimesSync(sessionPath, old, old);
  await page.goto(`/session?id=${encodeURIComponent(id)}`);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
}

async function expectWithinViewport(
  page: Page,
  target: Locator,
  description: string,
): Promise<void> {
  const box = await target.boundingBox();
  expect(box, `${description} should have a visible layout box`).not.toBeNull();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(box!.x, description).toBeGreaterThanOrEqual(0);
  expect(box!.y, description).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, description).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(box!.y + box!.height, description).toBeLessThanOrEqual(
    viewport.height + 1,
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport,
  );
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport,
  );
}

async function focusAndType(
  page: Page,
  target: Locator,
  value: string,
  description: string,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  await target.fill(value);
  await expect(target, description).toBeFocused();
  await expect(target, description).toHaveValue(value);
  await expectWithinViewport(page, target, description);
  await expectNoHorizontalOverflow(page);
}

test.describe("iPhone mobile composer", () => {
  test("compensates a sticky standalone viewport after keyboard dismissal", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    skipNonMobileWebKit(testInfo);
    testInfo.annotations.push({
      type: "acceptance-gap",
      description:
        "Synthetic VisualViewport events lock down the measured iOS failure mode but do not replace physical installed-PWA keyboard acceptance.",
    });
    await page.setViewportSize({ width: 402, height: 874 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: true,
      });
      const state: { height?: number } = {};
      const viewport = new EventTarget() as VisualViewport;
      Object.defineProperties(viewport, {
        height: { configurable: true, get: () => state.height ?? window.innerHeight },
        offsetTop: { configurable: true, get: () => 0 },
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      (
        window as typeof window & { __setComposerViewport?: (height: number) => void }
      ).__setComposerViewport = (height: number) => {
        state.height = height;
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: height,
        });
        viewport.dispatchEvent(new Event("resize"));
      };
    });
    await openTestConversation(page, sessionsDir, testInfo, "sticky-viewport");

    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.focus();
    await page.evaluate(() =>
      (
        window as typeof window & { __setComposerViewport: (height: number) => void }
      ).__setComposerViewport(400),
    );
    await expect(page.locator(".mobile-session-screen")).toHaveAttribute(
      "data-keyboard-open",
      "true",
    );

    await message.blur();
    await page.evaluate(() =>
      (
        window as typeof window & { __setComposerViewport: (height: number) => void }
      ).__setComposerViewport(815),
    );
    await expect(page.locator(".mobile-session-screen")).toHaveAttribute(
      "data-keyboard-open",
      "false",
    );
    const closed = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".mobile-session-screen")!;
      const composer = document.querySelector<HTMLElement>(".mobile-composer")!;
      const chrome = document.querySelector<HTMLElement>(".mobile-composer-chrome")!;
      return {
        rootBottom: root.getBoundingClientRect().bottom,
        rootHeight: root.style.getPropertyValue("--mobile-viewport-height"),
        standalone: Boolean(
          (navigator as Navigator & { standalone?: boolean }).standalone,
        ),
        chromeGap: root.getBoundingClientRect().bottom - chrome.getBoundingClientRect().bottom,
        expectedGap: Number.parseFloat(getComputedStyle(composer).paddingBottom),
      };
    });
    expect(closed.rootBottom, JSON.stringify(closed)).toBeCloseTo(874, 0);
    expect(closed.chromeGap).toBeCloseTo(closed.expectedGap, 0);

    await message.focus();
    await page.evaluate(() =>
      (
        window as typeof window & { __setComposerViewport: (height: number) => void }
      ).__setComposerViewport(400),
    );
    await expect(page.locator(".mobile-session-screen")).toHaveAttribute(
      "data-keyboard-open",
      "true",
    );
    const reopened = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".mobile-session-screen")!;
      const chrome = document.querySelector<HTMLElement>(".mobile-composer-chrome")!;
      return {
        rootBottom: root.getBoundingClientRect().bottom,
        chromeGap: root.getBoundingClientRect().bottom - chrome.getBoundingClientRect().bottom,
      };
    });
    expect(reopened.rootBottom).toBeCloseTo(459, 0);
    expect(reopened.chromeGap).toBeCloseTo(4, 0);
  });

  test("keeps focus, attachments, Send, Stop, and Tools usable at 320x568", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    skipNonMobileWebKit(testInfo);
    testInfo.annotations.push({
      type: "acceptance-gap",
      description:
        "Playwright WebKit cannot open the iOS software keyboard; real Mobile Safari must confirm visual-viewport keyboard occlusion and composer reachability on a device.",
    });
    await page.setViewportSize(iphoneViewport);
    await openTestConversation(page, sessionsDir, testInfo, "composer");

    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await focusAndType(
      page,
      composer,
      "A short mobile prompt",
      "Message composer",
    );
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expectWithinViewport(page, send, "Send button");

    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    expect(
      await page.getByRole("button", { name: "Tools", exact: true }).count(),
    ).toBe(1);
    const tools = page.getByRole("dialog", { name: "Tools", exact: true });
    await expect(tools).toBeVisible();
    await expect(
      tools.getByRole("button", { name: "Attach images", exact: true }),
    ).toBeVisible();
    await expect(
      tools.getByRole("button", { name: "Project inspector", exact: true }),
    ).toBeVisible();
    await expect(tools.getByRole("button", { name: /Model/ })).toBeVisible();
    await expect(tools.getByRole("button", { name: /Thinking/ })).toBeVisible();
    await expect(
      tools.getByRole("button", { name: "Thread actions", exact: true }),
    ).toHaveCount(0);
    await tools
      .getByRole("button", { name: "Attach images", exact: true })
      .click();
    await (
      await fileChooser
    ).setFiles({
      name: "mobile.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    const attachments = page.getByLabel("Image attachments", { exact: true });
    await expect(attachments).toContainText("mobile.png");
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "Remove mobile.png", exact: true }),
      "Attachment remove button",
    );
    await expectWithinViewport(page, send, "Send button with attachment");
    const attachmentBox = await attachments.boundingBox();
    const sendBox = await send.boundingBox();
    expect(attachmentBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(attachmentBox!.y + attachmentBox!.height).toBeLessThanOrEqual(
      sendBox!.y + 1,
    );
    await page
      .getByRole("button", { name: "Remove mobile.png", exact: true })
      .click();
    await expect(attachments).not.toBeVisible();

    await composer.fill("cancel this mobile response [[slow:2000]]");
    await send.click();
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible({ timeout: 10_000 });
    await expectWithinViewport(page, stop, "Stop button");
    await stop.click();
    await expect(composer).toBeEnabled();
  });

  test("keeps mobile search, icon inputs, inspector controls, and pairing label usable", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    skipNonMobileWebKit(testInfo);
    await page.setViewportSize(iphoneViewport);

    await page.goto("/");
    const sessionSearch = page.getByRole("searchbox", {
      name: "Search sessions",
      exact: true,
    });
    await expect(sessionSearch).toBeVisible();
    await focusAndType(page, sessionSearch, "failing", "Session search");

    await page.getByRole("button", { name: "New task", exact: true }).click();
    const destination = page.getByLabel("Destination folder", { exact: true });
    await expect(destination).toBeVisible();
    await focusAndType(
      page,
      destination,
      "/tmp/phone-project",
      "New task destination",
    );

    await page.goto("/pairing");
    const pairingCode = page.getByLabel("8-character pairing code", {
      exact: true,
    });
    const deviceLabel = page.getByLabel("Device label", { exact: true });
    await focusAndType(page, pairingCode, "ABCDEFGH", "Pairing code");
    await focusAndType(page, deviceLabel, "My iPhone", "Pairing device label");

    await openTestConversation(page, sessionsDir, testInfo, "controls");
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Project inspector", exact: true })
      .click();
    const inspector = page.getByRole("dialog", {
      name: "Files, diff, and details",
      exact: true,
    });
    await expect(inspector).toBeVisible();
    await inspector.getByRole("tab", { name: "Files", exact: true }).click();
    await focusAndType(
      page,
      inspector.getByRole("textbox", {
        name: "Search project files",
        exact: true,
      }),
      "src",
      "Inspector file search",
    );
    await inspector
      .getByRole("tab", { name: "Scratchpad", exact: true })
      .click();
    await focusAndType(
      page,
      inspector.getByRole("textbox", {
        name: "Project scratchpad",
        exact: true,
      }),
      "A note from the phone",
      "Inspector scratchpad",
    );
    await inspector
      .getByRole("button", { name: "Close inspector", exact: true })
      .click();

    await page.getByRole("button", { name: "Thread actions", exact: true }).click();
    const actions = page
      .getByRole("dialog")
      .filter({ hasText: "Thread actions" });
    await expect(actions).toBeVisible();
    await focusAndType(
      page,
      actions.getByLabel("Thread name", { exact: true }),
      "Phone thread",
      "Thread name action",
    );
    await focusAndType(
      page,
      actions.getByLabel("Label latest entry", { exact: true }),
      "review",
      "Entry label action",
    );
  });

  test("reload leaves the conversation usable or exposes reconnect", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    skipNonMobileWebKit(testInfo);
    await page.setViewportSize(iphoneViewport);
    await openTestConversation(page, sessionsDir, testInfo, "reload");

    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await composer.fill("resume after reload");
    await page.reload();
    await expect(composer).toBeVisible();

    const reconnect = page.getByRole("button", {
      name: "Retry connection",
      exact: true,
    });
    if (await reconnect.isVisible().catch(() => false)) {
      await reconnect.click();
    }
    await expect(composer).toBeEnabled();
    await focusAndType(
      page,
      composer,
      "still usable after reload",
      "Reloaded message composer",
    );
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "Send", exact: true }),
      "Reloaded Send button",
    );
  });
});
