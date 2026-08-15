import { expect, test } from "../lib/test";

function touch(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY, screenX: clientX, screenY: clientY };
}

test("opens from the left edge and closes with a leftward drawer swipe", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "Mobile Safari",
    "This gesture contract targets the touch-first mobile product",
  );
  testInfo.annotations.push({
    type: "acceptance-gap",
    description:
      "Synthetic WebKit touch events cover app arbitration but not Safari's native edge gesture; a physical iPhone must confirm edge-swipe ownership and vertical scrolling.",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const app = page.locator(".mobile-app");
  await expect(app).toBeVisible();

  await app.dispatchEvent("touchstart", { touches: [touch(1, 18, 220)] });
  await app.dispatchEvent("touchmove", { touches: [touch(1, 22, 278)] });
  await app.dispatchEvent("touchend", { changedTouches: [touch(1, 92, 224)] });
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);

  await app.dispatchEvent("touchstart", { touches: [touch(2, 18, 220)] });
  await app.dispatchEvent("touchend", { changedTouches: [touch(2, 92, 224)] });

  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await drawer.dispatchEvent("touchstart", { touches: [touch(3, 260, 220)] });
  await drawer.dispatchEvent("touchmove", { touches: [touch(3, 256, 278)] });
  await drawer.dispatchEvent("touchend", { changedTouches: [touch(3, 186, 224)] });
  await expect(drawer).toBeVisible();

  await drawer.dispatchEvent("touchstart", { touches: [touch(4, 260, 220)] });
  await drawer.dispatchEvent("touchend", { changedTouches: [touch(4, 186, 224)] });
  await expect(drawer).not.toBeVisible();
});
