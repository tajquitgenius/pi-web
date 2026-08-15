import { expect, test } from "../lib/test";

test.describe("PWA", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "Desktop Chrome",
      "One Chromium run covers the service-worker contract",
    );
  });

  test("exposes install metadata for a host-local standalone shell", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Pi Sessions");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(
      page.locator('link[rel="icon"][sizes="192x192"]'),
    ).toHaveAttribute("href", "/icon-192.png");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
      "content",
      "Pi Sessions",
    );
    await expect(
      page.locator('meta[name="apple-mobile-web-app-title"]'),
    ).toHaveAttribute("content", "Pi Sessions");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/manifest.webmanifest");
      return response.json();
    });
    expect(manifest).toMatchObject({
      id: "/",
      name: "Pi Sessions",
      short_name: "Pi Sessions",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#0e0e13",
      background_color: "#0e0e13",
    });
    expect(manifest.display_override).toContain("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        }),
        expect.objectContaining({
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
        }),
      ]),
    );

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
  });

  test("reopens the current shell, updates its worker, and recovers after an offline launch", async ({
    page,
  }) => {
    await page.goto("/offline.html");
    await page.evaluate(async () => {
      await caches
        .open("pi-web-static-v5")
        .then((cache) => cache.put("/old-entry", new Response("old")));
      await caches
        .open("unrelated-app-cache")
        .then((cache) => cache.put("/keep-entry", new Response("keep")));
    });

    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );

    const cacheNamesAfterInstall = await page.evaluate(() => caches.keys());
    expect(cacheNamesAfterInstall).not.toContain("pi-web-static-v5");
    expect(cacheNamesAfterInstall).toContain("unrelated-app-cache");
    expect(cacheNamesAfterInstall).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pi-web-static-v\d+$/)]),
    );

    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      return {
        active: registration.active?.state,
        scriptURL: registration.active?.scriptURL,
      };
    });
    expect(worker.active).toBe("activated");
    expect(worker.scriptURL).toMatch(/\/sw\.js$/);

    await page.reload();
    await expect(page.locator("#spa-root")).toHaveAttribute(
      "data-pi-web-surface",
      "desktop",
    );
    await expect(
      page.locator('[data-desktop-route="workspace"]'),
    ).toBeVisible();

    await page.context().setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Pi Sessions is unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText("No session data is stored for offline use."),
    ).toBeVisible();

    await page.context().setOffline(false);
    await page.reload();
    await expect(page.locator("#spa-root")).toHaveAttribute(
      "data-pi-web-surface",
      "desktop",
    );
    await expect(
      page.locator('[data-desktop-route="workspace"]'),
    ).toBeVisible();
  });

  test("keeps live and protected responses out of Cache Storage", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );

    const requests = [
      "/api/sessions",
      "/session?id=notes.jsonl",
      "/pairing",
      "/api/pairing-status",
      "/api/devices",
      "/events?id=notes.jsonl",
      "/api/push/vapid",
      "/sounds/cat.mp3",
    ];
    const responses = await page.evaluate(async (paths) => {
      const results = [];
      for (const path of paths) {
        const response = await fetch(path);
        const result = {
          path,
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
        };
        if (path.startsWith("/events")) {
          await response.body?.cancel();
        } else {
          await response.arrayBuffer();
        }
        results.push(result);
      }
      return results;
    }, requests);

    for (const response of responses) {
      expect(response.status, response.path).toBe(200);
      expect(response.cacheControl ?? "", response.path).toContain("no-store");
    }

    const cachedPaths = await page.evaluate(async () => {
      const paths: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        paths.push(
          ...(await cache.keys()).map(
            (request) => new URL(request.url).pathname,
          ),
        );
      }
      return paths;
    });
    for (const path of requests) {
      expect(cachedPaths, path).not.toContain(path.split("?", 1)[0]);
    }
  });
});
