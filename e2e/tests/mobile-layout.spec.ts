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
        Math.min(240, viewport.width - 126),
      );
      const composerLayout = await page.evaluate(() => {
        const composer =
          document.querySelector<HTMLElement>(".mobile-composer")!;
        const textarea =
          composer.querySelector<HTMLTextAreaElement>("textarea")!;
        const send = composer.querySelector<HTMLButtonElement>(
          ".mobile-send-button",
        )!;
        return {
          fontSize: Number.parseFloat(getComputedStyle(textarea).fontSize),
          hasKeyboardInset: composer.hasAttribute("data-keyboard-inset"),
          sendBottom: send.getBoundingClientRect().bottom,
          viewportBottom: window.innerHeight,
        };
      });
      expect(composerLayout.fontSize).toBeGreaterThanOrEqual(16);
      expect(composerLayout.hasKeyboardInset).toBe(false);
      expect(composerLayout.sendBottom).toBeLessThanOrEqual(
        composerLayout.viewportBottom,
      );

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
});
