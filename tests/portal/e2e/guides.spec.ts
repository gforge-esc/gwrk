/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type Page, expect, test } from "@playwright/test";

const slugs = [
  "index",
  "foxtrot-charlie",
  "getting-started",
  "agent-guide",
  "cli-reference",
  "hosted-architecture",
  "api-reference",
];
const panel = (page: Page, slug: string) =>
  page.locator(`[data-guide-panel="${slug}"]`);

async function expectGuide(page: Page, slug: string, fragment = "") {
  await expect(page).toHaveURL(
    new RegExp(`#guide-${slug}${fragment ? `/${fragment}` : ""}$`),
  );
  await expect(page.locator('[data-view-panel="guides"]')).toBeVisible();
  await expect(panel(page, slug)).toBeVisible();
  await expect(
    page.locator('[data-guide-panel][data-active="true"]'),
  ).toHaveCount(1);
  await expect(page.locator(`[data-guide-btn="${slug}"]`)).toHaveAttribute(
    "data-active",
    "true",
  );
  if (fragment) {
    const target = panel(page, slug).locator(`[id="${fragment}"]`);
    await expect(target).toBeVisible();
    await expect
      .poll(async () =>
        target.evaluate((el) => {
          const top = el.getBoundingClientRect().top;
          return top >= -1 && top < window.innerHeight - 60;
        }),
      )
      .toBe(true);
  }
}

test.beforeEach(async ({ page, baseURL }) => {
  const errors: string[] = [];
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!["GET", "HEAD"].includes(request.method())) {
      errors.push(`Blocked mutation: ${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !response.url().endsWith("/api/auth/session")
    )
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/#guides");
  await expect(page.locator("#portal-auth-badge")).toHaveText(
    "UNAUTHENTICATED",
  );
  // Check errors after every test, including navigations which would otherwise hide a 404.
  (page as Page & { portalErrors?: string[] }).portalErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { portalErrors?: string[] }).portalErrors).toEqual([]);
});

for (const slug of slugs) {
  test(`guide tab ${slug} supports reload and direct entry`, async ({
    page,
  }) => {
    await page.locator(`[data-guide-btn="${slug}"]`).click();
    await expectGuide(page, slug);
    await page.reload();
    await expectGuide(page, slug);
    await page.goto(`/#guide-${slug}`);
    await expectGuide(page, slug);
  });
}

test("overview Configuration Layering link preserves its section through reload and history", async ({
  page,
}) => {
  await panel(page, "index")
    .getByRole("link", { name: "Configuration Layering", exact: true })
    .click();
  await expectGuide(page, "getting-started", "configuration-layering");
  await page.reload();
  await expectGuide(page, "getting-started", "configuration-layering");
  await page.locator('[data-guide-btn="agent-guide"]').click();
  await expectGuide(page, "agent-guide");
  await page.goBack();
  await expectGuide(page, "getting-started", "configuration-layering");
  await page.goForward();
  await expectGuide(page, "agent-guide");
});

test("every overview TOC link selects its document and section", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const links = await panel(page, "index")
    .locator(".toctree-wrapper a")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent!,
        href: node.getAttribute("href")!,
      })),
    );
  expect(links.length).toBeGreaterThan(20);
  for (const link of links) {
    await page.goto("/#guide-index");
    await panel(page, "index")
      .locator(".toctree-wrapper a")
      .filter({ hasText: link.text })
      .first()
      .click();
    const match = link.href.match(/^#guide-([^/]+)(?:\/(.+))?$/);
    expect(match, link.href).not.toBeNull();
    await expectGuide(page, match![1], match![2]);
  }
});

test("all cross-document and same-document fragment links resolve publicly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let sameDocumentLinks = 0;
  let crossDocumentLinks = 0;
  for (const slug of slugs) {
    await page.goto(`/#guide-${slug}`);
    const links = await panel(page, slug)
      .locator('a[href^="#"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!));
    for (const href of [...new Set(links)]) {
      await page.goto(`/#guide-${slug}`);
      await panel(page, slug).locator(`a[href="${href}"]`).first().click();
      const match = href.match(/^#guide-([^/]+)(?:\/(.+))?$/);
      expect(match, `${slug}: ${href}`).not.toBeNull();
      if (match![1] === slug) sameDocumentLinks++;
      else crossDocumentLinks++;
      await expectGuide(page, match![1], match![2]);
    }
  }
  expect(sameDocumentLinks).toBeGreaterThan(0);
  expect(crossDocumentLinks).toBeGreaterThan(0);
});

test("direct section links and view history restore the selected document", async ({
  page,
}) => {
  await page.goto("/#guide-getting-started/configuration-layering");
  await expectGuide(page, "getting-started", "configuration-layering");
  await page.locator('[data-view-btn="api"]').click();
  await expect(page.locator('[data-view-panel="api"]')).toBeVisible();
  await page.goBack();
  await expectGuide(page, "getting-started", "configuration-layering");
  await page.goForward();
  await expect(page.locator('[data-view-panel="api"]')).toBeVisible();
});

test("primary Guides navigation restores the overview consistently", async ({
  page,
}) => {
  await page.locator('[data-guide-btn="agent-guide"]').click();
  await page.locator('[data-view-btn="api"]').click();
  await page.locator('[data-view-btn="guides"]').click();
  await expect(page).toHaveURL(/#guides$/);
  await expect(panel(page, "index")).toBeVisible();
  await page.reload();
  await expect(panel(page, "index")).toBeVisible();
});
