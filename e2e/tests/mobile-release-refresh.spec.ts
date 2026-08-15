import { expect, test } from "../lib/test";

test("reloads a restored mobile document when its network build changes", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "Mobile Safari",
    "The stale installed-PWA report came from iPhone WebKit",
  );
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state = { serveNewBuild: sessionStorage.getItem("__pi-release-test") === "1" };
    Object.defineProperty(window, "__piReleaseTest", { value: state, configurable: true });
    window.fetch = async (input, init) => {
      const rawURL =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (state.serveNewBuild && new URL(rawURL, window.location.href).pathname === "/app-build.json") {
        return new Response(JSON.stringify({ build: "next-build" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".mobile-session-row").first()).toBeVisible();
  expect(
    await page.evaluate(() => ({
      visibility: document.visibilityState,
      build: document.querySelector<HTMLMetaElement>('meta[name="pi-web-build"]')?.content,
    })),
  ).toEqual({ visibility: "visible", build: expect.stringMatching(/^[a-f0-9]{16}$/) });
  await page.waitForTimeout(1_100);

  let reloads = 0;
  let triggered = false;
  page.on("request", (request) => {
    if (triggered && request.isNavigationRequest()) reloads += 1;
  });
  triggered = true;
  await page.evaluate(() => {
    sessionStorage.setItem("__pi-release-test", "1");
    (
      window as typeof window & { __piReleaseTest: { serveNewBuild: boolean } }
    ).__piReleaseTest.serveNewBuild = true;
    window.dispatchEvent(new Event("pageshow"));
  });

  await expect.poll(() => reloads).toBe(1);
  await expect(page.locator(".mobile-session-row").first()).toBeVisible();
  await page.waitForTimeout(1_200);
  expect(reloads).toBe(1);
});
