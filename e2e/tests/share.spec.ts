import { test, expect } from "../lib/test";
import {
  assistantTextEntry,
  buildSession,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";

test.describe("static conversation export", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "Desktop Chrome",
      "the self-contained export is product- and browser-independent",
    );
  });

  test("renders inside a sandboxed iframe without server assets", async ({
    page,
    request,
    sessionsDir,
  }, testInfo) => {
    const marker = "SANDBOX_RENDER_MARKER";
    const { entries, lastId } = buildSession();
    entries.push(assistantTextEntry(lastId, marker).entry);
    const id = writeSession(
      sessionsDir,
      uniqueSessionName(testInfo, "share"),
      entries,
    );

    const response = await request.get(
      `/share?id=${encodeURIComponent(id)}&preview=1`,
    );
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/html");
    const html = await response.text();
    expect(html).not.toContain('src="/static/');

    await page.setContent(
      '<iframe id="snapshot" sandbox="allow-scripts" style="width:100%;height:90vh;border:0"></iframe>',
    );
    await page.evaluate((documentHtml) => {
      (document.getElementById("snapshot") as HTMLIFrameElement).srcdoc =
        documentHtml;
    }, html);

    const frame = page.frameLocator("#snapshot");
    await expect(frame.locator("#messages")).toContainText(marker, {
      timeout: 15_000,
    });
    await expect(frame.locator("#messages")).toContainText("Initial reply.");
  });

  test("rejects a missing id without side effects", async ({ request }) => {
    const response = await request.post("/share");
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("missing id");
  });

  test("rejects non-preview GET requests", async ({ request }) => {
    const response = await request.get("/share?id=demo.jsonl");
    expect(response.status()).toBe(405);
  });
});
