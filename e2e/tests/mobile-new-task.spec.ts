import { join } from "node:path";
import { expect, test } from "../lib/test";

test.use({ serviceWorkers: "block" });

test.describe("mobile New Task", () => {
  test("uses the latest recent project, creates without runtime settings, and retries after failure", async ({
    page,
    agentDir,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "Mobile Safari",
      "This journey targets a phone user on Mobile Safari",
    );

    const latestPath = join(
      agentDir,
      "e2e-new-task",
      `${testInfo.workerIndex}-${Date.now()}`,
      "latest",
    );
    const registeredPath = join(agentDir, "e2e-new-task", "registered");
    let recentRequested = false;
    let releaseRecent!: () => void;
    const recentReleased = new Promise<void>((resolve) => {
      releaseRecent = resolve;
    });

    await page.route("**/api/projects*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          projects: [{ path: registeredPath, label: "Registered project" }],
          total: 1,
          currentSessions: [],
          currentSessionsTotal: 0,
          filterEnabled: true,
        }),
      });
    });
    await page.route(/\/api\/recent-locations(?:\?|$)/, async (route) => {
      recentRequested = true;
      await recentReleased;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ locations: [latestPath] }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "New task" }).click();

    const task = page.getByRole("dialog", { name: "New task" });
    const destination = task.getByLabel("Destination folder");
    await expect.poll(() => recentRequested).toBe(true);
    await expect(destination).toHaveValue(registeredPath);

    releaseRecent();
    await expect(destination).toHaveValue(latestPath);
    const runtime = task.getByRole("button", { name: /Runtime/ });
    await expect(runtime).toHaveAttribute("aria-expanded", "false");
    await expect(task.getByLabel("Provider and model")).not.toBeVisible();

    const create = task.getByRole("button", { name: "Create task" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page).toHaveURL(/\/session\?id=/);

    await page.goto("/");
    await page.getByRole("button", { name: "New task" }).click();
    const retryTask = page.getByRole("dialog", { name: "New task" });
    const retryDestination = retryTask.getByLabel("Destination folder");
    const retryCreate = retryTask.getByRole("button", { name: "Create task" });
    await expect(retryCreate).toBeEnabled();

    await retryDestination.fill("");
    await retryCreate.click();
    await expect(retryTask.getByRole("alert")).toHaveText(
      "Please enter a path",
    );
    await expect(retryDestination).toBeEnabled();

    await retryDestination.fill("not-an-absolute-path");
    await retryCreate.click();
    await expect(retryTask.getByRole("alert")).toHaveText(
      "path must be absolute",
    );
    await expect(retryDestination).toHaveValue("not-an-absolute-path");
    await expect(retryDestination).toBeEnabled();

    const correctedPath = join(
      agentDir,
      "e2e-new-task",
      `${testInfo.workerIndex}-${Date.now()}`,
      "corrected",
    );
    await retryDestination.fill(correctedPath);
    await retryCreate.click();
    await expect(page).toHaveURL(/\/session\?id=/);
  });

  test("keeps an edited destination while runtime settings are loading", async ({
    page,
    agentDir,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "Mobile Safari",
      "This journey targets a phone user on Mobile Safari",
    );

    const editedPath = join(
      agentDir,
      "e2e-new-task",
      `${testInfo.workerIndex}-${Date.now()}`,
      "edited",
    );
    let defaultsRequested = false;
    let modelsRequested = false;
    let releaseDefaults!: () => void;
    let releaseModels!: () => void;
    const defaultsReleased = new Promise<void>((resolve) => {
      releaseDefaults = resolve;
    });
    const modelsReleased = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });

    await page.route("**/api/session-defaults*", async (route) => {
      defaultsRequested = true;
      await defaultsReleased;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          modelProvider: "openai-codex-secondary",
          modelId: "gpt-5.6-sol",
          thinkingLevel: "high",
        }),
      });
    });
    await page.route("**/api/models*", async (route) => {
      modelsRequested = true;
      await modelsReleased;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              provider: "openai-codex-secondary",
              id: "gpt-5.6-sol",
              name: "GPT 5.6 Sol",
              reasoning: true,
            },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "New task" }).click();
    const task = page.getByRole("dialog", { name: "New task" });
    const destination = task.getByLabel("Destination folder");
    await expect.poll(() => defaultsRequested && modelsRequested).toBe(true);
    await expect(
      task.getByRole("button", { name: "Create task" }),
    ).toBeDisabled();
    await destination.fill(editedPath);
    await expect(destination).toHaveValue(editedPath);

    releaseDefaults();
    releaseModels();
    await expect(
      task.getByRole("button", { name: "Create task" }),
    ).toBeEnabled();
    await expect(destination).toHaveValue(editedPath);
  });
});
