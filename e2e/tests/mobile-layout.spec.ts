import { expect, test } from "../lib/test";
import type { Page } from "@playwright/test";

const phoneAndTabletWidths = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
];

async function expectNoHorizontalOverflow(page: Page) {
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

test.describe("mobile layout bounds", () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== "webkit" || !isMobile,
    "A mobile WebKit user agent is required while explicit widths cover phone and tablet bounds",
  );

  for (const viewport of phoneAndTabletWidths) {
    test(`${viewport.width}px keeps home, task, conversation, and sheets within the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        class FakeSpeechRecognition {
          continuous = false;
          interimResults = false;
          lang = "";
          maxAlternatives = 0;
          onstart = null;
          onresult = null;
          onerror = null;
          onend = null;
          start() {}
          stop() {}
          abort() {}
        }
        Object.defineProperty(window, "SpeechRecognition", {
          configurable: true,
          value: FakeSpeechRecognition,
        });
      });
      await page.goto("/");
      await expect(page.locator(".mobile-session-row").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Navigation" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "New task" }).click();
      await expect(
        page.getByRole("dialog", { name: "New task" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");

      await page
        .locator(".mobile-session-row", {
          hasText: "Fix the failing unit test",
        })
        .click();
      const textarea = page.getByRole("textbox", { name: "Message" });
      await expect(textarea).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const textareaBox = await textarea.boundingBox();
      expect(textareaBox?.width || 0).toBeGreaterThanOrEqual(
        Math.min(240, viewport.width - 174),
      );
      const composerLayout = await page.evaluate(() => {
        const composer =
          document.querySelector<HTMLElement>(".mobile-composer")!;
        const textarea =
          composer.querySelector<HTMLTextAreaElement>("textarea")!;
        const microphone = composer.querySelector<HTMLButtonElement>(
          ".mobile-dictation-button",
        )!;
        const send = composer.querySelector<HTMLButtonElement>(
          ".mobile-send-button",
        )!;
        const feed = document.querySelector<HTMLElement>(
          ".mobile-conversation-feed",
        )!;
        const floatingControls = document.querySelector<HTMLElement>(
          ".mobile-conversation-floating-controls",
        )!;
        const feedBox = feed.getBoundingClientRect();
        const microphoneBox = microphone.getBoundingClientRect();
        const sendBox = send.getBoundingClientRect();
        const composerStyle = getComputedStyle(composer);
        return {
          fontSize: Number.parseFloat(getComputedStyle(textarea).fontSize),
          hasKeyboardInset: composer.hasAttribute("data-keyboard-inset"),
          microphoneWidth: microphoneBox.width,
          microphoneHeight: microphoneBox.height,
          microphoneRight: microphoneBox.right,
          sendLeft: sendBox.left,
          sendWidth: sendBox.width,
          sendHeight: sendBox.height,
          sendBottom: sendBox.bottom,
          viewportBottom: window.innerHeight,
          feedTop: feedBox.top,
          feedBottom: feedBox.bottom,
          composerPosition: composerStyle.position,
          composerBackground: composerStyle.backgroundColor,
          composerBorderTop: composerStyle.borderTopWidth,
          controlsPosition: getComputedStyle(floatingControls).position,
        };
      });
      expect(composerLayout.fontSize).toBeGreaterThanOrEqual(16);
      expect(composerLayout.hasKeyboardInset).toBe(false);
      expect(composerLayout.microphoneWidth).toBeGreaterThanOrEqual(44);
      expect(composerLayout.microphoneHeight).toBeGreaterThanOrEqual(44);
      expect(composerLayout.sendWidth).toBeGreaterThanOrEqual(44);
      expect(composerLayout.sendHeight).toBeGreaterThanOrEqual(44);
      expect(composerLayout.microphoneRight).toBeLessThanOrEqual(
        composerLayout.sendLeft,
      );
      expect(
        composerLayout.sendLeft - composerLayout.microphoneRight,
      ).toBeLessThanOrEqual(4.1);
      expect(composerLayout.sendBottom).toBeLessThanOrEqual(
        composerLayout.viewportBottom,
      );
      expect(composerLayout.feedTop).toBeGreaterThanOrEqual(-1);
      expect(composerLayout.feedTop).toBeLessThanOrEqual(1);
      expect(composerLayout.feedBottom).toBeGreaterThanOrEqual(
        composerLayout.viewportBottom - 1,
      );
      expect(composerLayout.feedBottom).toBeLessThanOrEqual(
        composerLayout.viewportBottom + 1,
      );
      expect(composerLayout.composerPosition).toBe("absolute");
      expect(composerLayout.composerBackground).toBe("rgba(0, 0, 0, 0)");
      expect(composerLayout.composerBorderTop).toBe("0px");
      expect(composerLayout.controlsPosition).toBe("absolute");

      await page.getByRole("button", { name: "Tools" }).click();
      const tools = page.getByRole("dialog", { name: "Tools" });
      await expect(tools).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await tools.getByRole("button", { name: /Model/ }).click();
      await expect(
        page.getByRole("dialog", { name: "Model and thinking" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("keeps reconnect recovery floating above the full transcript", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".mobile-session-row").first().click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await page.evaluate(() => {
      const notice = document.createElement("div");
      notice.className = "mobile-connectivity-notice is-reconnecting";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-label", "Connection status");
      notice.innerHTML =
        '<span>Reconnecting…</span><button type="button">Retry</button>';
      document.querySelector(".mobile-session-screen")!.append(notice);
    });

    const notice = page.getByRole("status", { name: "Connection status" });
    await expect(notice).toBeVisible();
    const geometry = await page.evaluate(() => {
      const feed = document.querySelector<HTMLElement>(
        ".mobile-conversation-feed",
      )!;
      const notice = document.querySelector<HTMLElement>(
        ".mobile-connectivity-notice",
      )!;
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".mobile-conversation-floating-button",
        ),
      );
      const feedBox = feed.getBoundingClientRect();
      const noticeBox = notice.getBoundingClientRect();
      const controlBoxes = controls.map((control) =>
        control.getBoundingClientRect(),
      );
      return {
        feedTop: feedBox.top,
        feedBottom: feedBox.bottom,
        viewportBottom: window.innerHeight,
        noticeLeft: noticeBox.left,
        noticeRight: noticeBox.right,
        leftControlRight: controlBoxes[0]!.right,
        rightControlLeft: controlBoxes[1]!.left,
      };
    });
    expect(geometry.feedTop).toBeGreaterThanOrEqual(-1);
    expect(geometry.feedTop).toBeLessThanOrEqual(1);
    expect(geometry.feedBottom).toBeGreaterThanOrEqual(
      geometry.viewportBottom - 1,
    );
    expect(geometry.feedBottom).toBeLessThanOrEqual(
      geometry.viewportBottom + 1,
    );
    expect(geometry.noticeLeft).toBeGreaterThanOrEqual(
      geometry.leftControlRight,
    );
    expect(geometry.noticeRight).toBeLessThanOrEqual(geometry.rightControlLeft);
    await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
