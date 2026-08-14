import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "../lib/test";

function findSessionFile(root: string, filename: string): string {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      try {
        return findSessionFile(path, filename);
      } catch {
        continue;
      }
    }
    if (entry === filename) return path;
  }
  throw new Error(`session file not found: ${filename}`);
}

function outputRoot(): string {
  return (
    process.env.PI_WEB_E2E_OUTPUT_DIR ||
    join(tmpdir(), "pi-web-test-output", "integration-hardening")
  );
}

test("dedicated React product accepts a full stub-Pi task flow", async (
  { page, baseURL, sessionsDir, agentDir },
  testInfo,
) => {
  test.skip(
    testInfo.project.name !== "Desktop Chrome" &&
      testInfo.project.name !== "Mobile Safari",
    "Decisive acceptance runs on desktop Chromium and Mobile Safari",
  );

  const desktop = testInfo.project.name === "Desktop Chrome";
  const expectedSurface = desktop ? "desktop" : "mobile";
  const oppositeSurface = desktop ? "mobile" : "desktop";
  const workspace = join(
    agentDir,
    "workspaces",
    `${expectedSurface}-${testInfo.workerIndex}-${Date.now()}`,
  );
  mkdirSync(workspace, { recursive: true });

  await page.goto("/");
  await expect(page.locator("#spa-root")).toHaveAttribute(
    "data-pi-web-surface",
    expectedSurface,
  );
  if (desktop) {
    await expect(page.locator('[data-desktop-route="workspace"]')).toBeVisible();
    for (const host of ["Work laptop", "Personal", "Cloud"]) {
      await expect(page.getByRole("link", { name: host })).toBeVisible();
    }
  } else {
    await expect(page.locator('[data-mobile-route="sessions"]')).toBeVisible();
    await page
      .locator('summary[aria-label="Current computer: Main. Switch computer"]')
      .click();
    for (const host of ["Work laptop", "Personal", "Cloud"]) {
      await expect(page.getByRole("link", { name: host })).toBeVisible();
    }
    await page
      .locator('summary[aria-label="Current computer: Main. Switch computer"]')
      .click();
    expect(await page.locator(".mobile-session-row").count()).toBeLessThanOrEqual(30);
  }

  await page.context().addCookies([
    {
      name: "pi-web-surface",
      value: oppositeSurface,
      url: baseURL!,
    },
  ]);
  await page.reload();
  await expect(page.locator("#spa-root")).toHaveAttribute(
    "data-pi-web-surface",
    oppositeSurface,
  );
  await page.context().addCookies([
    {
      name: "pi-web-surface",
      value: "auto",
      url: baseURL!,
    },
  ]);
  await page.reload();
  await expect(page.locator("#spa-root")).toHaveAttribute(
    "data-pi-web-surface",
    expectedSurface,
  );

  const prompt = `merged-${expectedSurface}-${Date.now()}`;
  if (desktop) {
    await page.getByLabel("Project path").fill(workspace);
    await expect(page.getByLabel("Provider account")).toHaveValue(
      "openai-codex-secondary",
    );
    await expect(page.getByLabel("Model")).toHaveValue("gpt-5.6-sol");
    await expect(page.getByLabel("Thinking")).toHaveValue("high");
    await page.getByLabel("Task description").fill(prompt);
    await page.getByRole("button", { name: "Start task" }).click();
  } else {
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Destination folder").fill(workspace);
    await page
      .getByLabel("Provider and model")
      .selectOption("openai-codex-secondary/gpt-5.6-sol");
    await page.getByLabel("Thinking level").selectOption("high");
    await expect(page.getByText("openai-codex-secondary", { exact: true })).toBeVisible();
    await expect(page.getByText("gpt-5.6-sol", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create task" }).click();
  }

  await expect(page).toHaveURL(/\/session\?id=/, { timeout: 20_000 });
  const sessionID = new URL(page.url()).searchParams.get("id");
  expect(sessionID).toBeTruthy();

  if (!desktop) {
    await expect(
      page.getByRole("button", {
        name: /openai-codex-secondary · gpt-5\.6-sol · high.*Open settings/,
      }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Send" }).click();
  }

  const conversation = desktop
    ? page.getByTestId("transcript")
    : page.locator(".mobile-conversation-feed");
  await expect(conversation).toContainText(`Stub reply: ${prompt}`, {
    timeout: 20_000,
  });

  const sessionPath = findSessionFile(sessionsDir, sessionID!);
  const jsonl = readFileSync(sessionPath, "utf8");
  expect(jsonl).toContain('"type":"model_change"');
  expect(jsonl).toContain('"provider":"openai-codex-secondary"');
  expect(jsonl).toContain('"modelId":"gpt-5.6-sol"');
  expect(jsonl).toContain('"thinkingLevel":"high"');
  expect(jsonl).toContain('"implicit":true');

  const slowPrompt = `cancel-${expectedSurface} [[slow:2000]]`;
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(slowPrompt);
  await page
    .getByRole("button", { name: desktop ? "Send message" : "Send" })
    .click();
  await page
    .getByRole("button", {
      name: desktop ? "Cancel response" : /Cancel.*response/i,
    })
    .click();

  if (desktop) {
    const layout = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".desktop-product-shell")!;
      const transcript = document.querySelector<HTMLElement>(
        ".desktop-transcript-scroll",
      )!;
      const composer = document.querySelector<HTMLElement>(
        ".desktop-composer-dock",
      )!;
      const root = document.scrollingElement!;
      return {
        bodyOverflow: getComputedStyle(document.body).overflow,
        bodyScrollable: root.scrollHeight > root.clientHeight,
        composerBottom: composer.getBoundingClientRect().bottom,
        composerVisible: composer.getBoundingClientRect().height > 0,
        shellHeight: shell.getBoundingClientRect().height,
        transcriptOverflow: getComputedStyle(transcript).overflowY,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.viewportWidth).toBe(1440);
    expect(layout.viewportHeight).toBe(900);
    expect(layout.bodyScrollable).toBe(false);
    expect(layout.bodyOverflow).toBe("hidden");
    expect(layout.shellHeight).toBe(layout.viewportHeight);
    expect(layout.composerVisible).toBe(true);
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(["auto", "scroll"]).toContain(layout.transcriptOverflow);
  } else {
    await page.getByRole("textbox", { name: "Message", exact: true }).blur();
    const mobileLayout = await page.evaluate(() => {
      const composer = document.querySelector<HTMLElement>(".mobile-composer")!;
      const visibleTargets = [
        ...document.querySelectorAll<HTMLElement>(
          'button, a, input:not([type="hidden"]):not(.mobile-file-input), select, textarea, summary',
        ),
      ].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      return {
        composerHeight: composer.getBoundingClientRect().height,
        horizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        undersized: visibleTargets
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44;
          })
          .map((element) => ({
            label:
              element.getAttribute("aria-label") ||
              element.textContent?.trim().slice(0, 80) ||
              element.tagName,
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          })),
      };
    });
    expect(mobileLayout.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileLayout.composerHeight).toBeLessThanOrEqual(72);
    expect(mobileLayout.undersized).toEqual([]);
  }

  const artifactDir = join(outputRoot(), "screenshots");
  mkdirSync(artifactDir, { recursive: true });
  const artifactName = expectedSurface.replaceAll(/[^a-z0-9-]/gi, "-");
  const screenshotPath = join(artifactDir, `${artifactName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  writeFileSync(
    join(artifactDir, `${artifactName}.json`),
    JSON.stringify(
      {
        project: testInfo.project.name,
        screenshot: screenshotPath,
        sessionID,
        surface: expectedSurface,
        url: page.url(),
      },
      null,
      2,
    ),
  );
});
