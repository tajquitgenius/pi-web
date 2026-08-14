import { test, expect } from "../lib/test";
import {
  buildSession,
  realWorkingDir,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";

function expectedSurface(projectName: string): "desktop" | "mobile" {
  return projectName.startsWith("Desktop ") ? "desktop" : "mobile";
}

test.describe("dedicated React products", () => {
  test("selects the product by UA and supports browse, conversation, and settings", async ({
    page,
  }, testInfo) => {
    const surface = expectedSurface(testInfo.project.name);
    await page.goto("/");

    await expect(page.locator("#spa-root")).toHaveAttribute(
      "data-pi-web-surface",
      surface,
    );
    await expect(
      page.locator(
        surface === "desktop"
          ? '[data-desktop-route="workspace"]'
          : '[data-mobile-route="sessions"]',
      ),
    ).toBeVisible();

    const session = page.locator(
      surface === "desktop" ? ".desktop-thread-row" : ".mobile-session-row",
      { hasText: "Fix the failing unit test" },
    );
    await expect(session).toBeVisible();
    await session.click();
    await expect(page).toHaveURL(/\/session\?id=/);

    const transcript =
      surface === "desktop"
        ? page.getByTestId("transcript")
        : page.locator(".mobile-conversation-feed");
    await expect(transcript).toContainText("Fix the failing unit test");

    await page.goto("/settings");
    await expect(
      page.locator(
        surface === "desktop"
          ? '[data-desktop-route="settings"]'
          : '[data-mobile-route="settings"]',
      ),
    ).toBeVisible();
  });

  test("renders a direct session deep link from the embedded bootstrap", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const { entries } = buildSession({ cwd: realWorkingDir() });
    const id = writeSession(sessionsDir, uniqueSessionName(testInfo, "bootstrap"), entries);
    const sessionRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/session") {
        sessionRequests.push(request.url());
      }
    });

    await page.goto(`/session?id=${encodeURIComponent(id)}`);
    const surface = expectedSurface(testInfo.project.name);
    const transcript =
      surface === "desktop"
        ? page.getByTestId("transcript")
        : page.locator(".mobile-conversation-feed");
    await expect(transcript).toContainText("Initial prompt.");
    await expect(transcript).toContainText("Initial reply.");
    expect(sessionRequests).toEqual([]);
  });
});
