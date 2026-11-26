/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { LOGIN_ENTRY } from "./portal-html.js";

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  key?: string;
  target: FakeElement;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

class FakeElement {
  id: string;
  textContent: string;
  disabled: boolean;
  style: Record<string, string>;
  content = "";
  onclick: ((ev: FakeEvent) => void) | null = null;
  attributes: Map<string, string>;
  listeners: Map<string, Listener[]>;
  focused = false;

  constructor(
    id: string,
    opts: {
      textContent?: string;
      disabled?: boolean;
      display?: string;
      attrs?: Record<string, string>;
    } = {},
  ) {
    this.id = id;
    this.textContent = opts.textContent ?? "";
    this.disabled = opts.disabled ?? false;
    this.style = opts.display ? { display: opts.display } : {};
    this.attributes = new Map(Object.entries(opts.attrs ?? {}));
    this.listeners = new Map();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  focus(): void {
    this.focused = true;
  }

  closest(_selector: string): FakeElement | null {
    return null;
  }

  click(): FakeEvent {
    const ev: FakeEvent = {
      type: "click",
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    if (this.disabled) return ev;
    if (typeof this.onclick === "function") {
      this.onclick(ev);
    }
    for (const listener of this.listeners.get("click") ?? []) {
      listener(ev);
    }
    return ev;
  }
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Promise<{
  status: number;
  ok?: boolean;
  headers?: { get(name: string): string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

function extractMainScript(html: string): string {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  const main = scripts.find(
    (src) => src.includes("checkSession") && src.includes("performLogout"),
  );
  if (!main) {
    throw new Error("Could not find main portal <script> inside LOGIN_ENTRY");
  }
  return main;
}

function makeResponse(
  status: number,
  body: unknown,
  opts: { rawText?: string; isJson?: boolean } = {},
) {
  const isJson = opts.isJson ?? true;
  const rawText =
    opts.rawText ?? (typeof body === "string" ? body : JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? isJson
            ? "application/json"
            : "text/html"
          : null,
    },
    json: async () => {
      if (!isJson) {
        throw new SyntaxError(
          "Unexpected token '<', \"<html>...\" is not valid JSON",
        );
      }
      return body;
    },
    text: async () => rawText,
  };
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function mountPortalScript(fetchHandler: FetchHandler) {
  const elements = new Map<string, FakeElement>();
  const register = (el: FakeElement) => {
    elements.set(el.id, el);
    return el;
  };

  const splashCurtain = register(
    new FakeElement("splash-curtain", { attrs: { "data-dismissed": "false" } }),
  );
  const splashEnterBtn = register(new FakeElement("splash-enter-btn"));
  const replaySplashBtn = register(new FakeElement("replay-splash-btn"));
  const replaySplashIcon = register(new FakeElement("replay-splash-icon"));
  const brandHomeLink = register(new FakeElement("brand-home-link"));
  const statusFile = register(
    new FakeElement("statusline-file", { textContent: "~/home.ts" }),
  );
  const statusUser = register(
    new FakeElement("statusline-user", { textContent: "guest@gwrk" }),
  );
  const statusMode = register(
    new FakeElement("statusline-mode", { textContent: "dark" }),
  );
  const themeToggle = register(
    new FakeElement("theme-toggle", { textContent: "DARK" }),
  );
  const headerSignin = register(
    new FakeElement("header-signin-link", {
      textContent: "Sign in with Google",
      attrs: { href: "/oauth2/start" },
    }),
  );
  const heroSignin = register(
    new FakeElement("hero-signin-link", {
      textContent: "Sign in with Google",
      attrs: { href: "/oauth2/start" },
    }),
  );
  const navSessionTab = register(
    new FakeElement("nav-session-tab", {
      display: "none",
      attrs: { "data-view-btn": "session", "data-active": "false" },
    }),
  );
  const portalLogoutBtn = register(
    new FakeElement("portal-logout-btn", {
      textContent: "Sign Out",
      disabled: true,
    }),
  );
  const portalAuthBadge = register(
    new FakeElement("portal-auth-badge", { textContent: "SESSION" }),
  );
  const sessionOut = register(
    new FakeElement("session-json-out", {
      textContent: "Checking /api/auth/session...",
    }),
  );
  const logoutOut = register(
    new FakeElement("logout-json-out", { textContent: "Ready." }),
  );
  const probeSessionBtn = register(new FakeElement("probe-session-btn"));

  const viewButtons = [
    new FakeElement("view-btn-home", {
      attrs: { "data-view-btn": "home", "data-active": "true" },
    }),
    new FakeElement("view-btn-foxtrot", {
      attrs: { "data-view-btn": "foxtrot", "data-active": "false" },
    }),
    new FakeElement("view-btn-guides", {
      attrs: { "data-view-btn": "guides", "data-active": "false" },
    }),
    new FakeElement("view-btn-api", {
      attrs: { "data-view-btn": "api", "data-active": "false" },
    }),
    navSessionTab,
  ];
  const viewPanels = [
    new FakeElement("view-home", {
      attrs: { "data-view-panel": "home", "data-active": "true" },
    }),
    new FakeElement("view-foxtrot", {
      attrs: { "data-view-panel": "foxtrot", "data-active": "false" },
    }),
    new FakeElement("view-guides", {
      attrs: { "data-view-panel": "guides", "data-active": "false" },
    }),
    new FakeElement("view-api", {
      attrs: { "data-view-panel": "api", "data-active": "false" },
    }),
    new FakeElement("view-session", {
      attrs: { "data-view-panel": "session", "data-active": "false" },
    }),
  ];

  const metaScheme = new FakeElement("meta-color-scheme");
  metaScheme.content = "light dark";
  const docListeners = new Map<string, Listener[]>();

  const fetchCalls: FetchCall[] = [];
  const unhandledRejections: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  const locationObj = { hash: "", pathname: "/" };
  const windowObj: Record<string, unknown> = {
    location: locationObj,
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    scrollTo: () => {},
  };

  const documentObj = {
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelector: (selector: string) =>
      selector === 'meta[name="color-scheme"]' ? metaScheme : null,
    querySelectorAll: (selector: string) => {
      if (selector === "[data-view-btn]") return viewButtons;
      if (selector === "[data-view-panel]") return viewPanels;
      return [];
    },
    addEventListener: (type: string, listener: Listener) => {
      const list = docListeners.get(type) ?? [];
      list.push(listener);
      docListeners.set(type, list);
    },
  };

  const context = vm.createContext({
    window: windowObj,
    document: documentObj,
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        if (url.startsWith("#")) {
          locationObj.hash = url;
        }
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    fetch: (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return fetchHandler(url, init);
    },
    JSON,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
  });

  const scriptSource = extractMainScript(LOGIN_ENTRY);
  vm.runInContext(scriptSource, context);

  return {
    splashCurtain,
    splashEnterBtn,
    replaySplashBtn,
    replaySplashIcon,
    brandHomeLink,
    statusFile,
    statusUser,
    statusMode,
    themeToggle,
    headerSignin,
    heroSignin,
    navSessionTab,
    portalLogoutBtn,
    portalAuthBadge,
    sessionOut,
    logoutOut,
    probeSessionBtn,
    viewButtons,
    viewPanels,
    windowObj,
    fetchCalls,
    unhandledRejections,
    cleanup: () => {
      process.off("unhandledRejection", onUnhandled);
    },
    activeView: () =>
      viewPanels
        .find((p) => p.getAttribute("data-active") === "true")
        ?.getAttribute("data-view-panel") ?? null,
  };
}

describe("generated portal client script behavior (LOGIN_ENTRY)", () => {
  it("enters authenticated UI state on initial GET /api/auth/session 200", async () => {
    const portal = mountPortalScript(async (url) => {
      if (url === "/api/auth/session") {
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: "csrf-initial-1",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      expect(portal.navSessionTab.style.display).toBe("inline-flex");
      expect(portal.portalLogoutBtn.disabled).toBe(false);
      expect(portal.portalAuthBadge.textContent).toBe("AUTHENTICATED");
      expect(portal.statusUser.textContent).toBe("operator@gwrk");
      expect(portal.headerSignin.textContent).toBe("Session");
      expect(portal.headerSignin.getAttribute("href")).toBe("#session");
      expect(typeof portal.headerSignin.onclick).toBe("function");
      expect(portal.heroSignin.textContent).toBe("Open Session");
      expect(portal.heroSignin.getAttribute("href")).toBe("#session");
      expect(typeof portal.heroSignin.onclick).toBe("function");
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it("preserves authenticated UI, csrfToken, and retry on 403 AUTH_CSRF_INVALID logout", async () => {
    let logoutAttempt = 0;
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: "csrf-token-403",
        });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        logoutAttempt += 1;
        if (logoutAttempt === 1) {
          return makeResponse(403, {
            ok: false,
            code: "AUTH_CSRF_INVALID",
            error: "Invalid CSRF token",
          });
        }
        return makeResponse(200, { ok: true, proxyCleared: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      expect(portal.activeView()).toBe("session");

      portal.portalLogoutBtn.click();
      await flushAsync();

      expect(portal.navSessionTab.style.display).toBe("inline-flex");
      expect(portal.portalLogoutBtn.disabled).toBe(false);
      expect(portal.portalAuthBadge.textContent).toBe("AUTHENTICATED");
      expect(portal.statusUser.textContent).toBe("operator@gwrk");
      expect(portal.headerSignin.textContent).toBe("Session");
      expect(portal.heroSignin.textContent).toBe("Open Session");
      expect(portal.activeView()).toBe("session");
      expect(portal.logoutOut.textContent).toMatch(/403/);
      expect(portal.logoutOut.textContent).toMatch(
        /retry|failed|AUTH_CSRF_INVALID/i,
      );

      // Retrying logout still sends the preserved X-Gwrk-Csrf-Token header
      portal.portalLogoutBtn.click();
      await flushAsync();
      const postCalls = portal.fetchCalls.filter(
        (c) => c.url === "/api/auth/logout",
      );
      expect(postCalls).toHaveLength(2);
      expect(
        (postCalls[1].init?.headers as Record<string, string>)[
          "X-Gwrk-Csrf-Token"
        ],
      ).toBe("csrf-token-403");
      expect(portal.navSessionTab.style.display).toBe("none");
      expect(portal.portalLogoutBtn.disabled).toBe(true);
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it.each([
    { status: 500, body: { ok: false, code: "INTERNAL_ERROR" } },
    { status: 503, body: { ok: false, code: "AUTH_DEPENDENCY_UNAVAILABLE" } },
    { status: 503, body: { ok: true, proxyCleared: false } },
  ])(
    "preserves authenticated UI and retryability when logout returns $status ($body)",
    async ({ status, body }) => {
      const portal = mountPortalScript(async (url, init) => {
        if (url === "/api/auth/session") {
          return makeResponse(200, {
            ok: true,
            expiresAt: "2026-11-26T00:00:00.000Z",
            csrfToken: `csrf-${status}`,
          });
        }
        if (url === "/api/auth/logout" && init?.method === "POST") {
          return makeResponse(status, body);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      try {
        await flushAsync();
        portal.navSessionTab.click();
        portal.portalLogoutBtn.click();
        await flushAsync();

        expect(portal.navSessionTab.style.display).toBe("inline-flex");
        expect(portal.portalLogoutBtn.disabled).toBe(false);
        expect(portal.portalAuthBadge.textContent).toBe("AUTHENTICATED");
        expect(portal.statusUser.textContent).toBe("operator@gwrk");
        expect(portal.headerSignin.textContent).toBe("Session");
        expect(portal.heroSignin.textContent).toBe("Open Session");
        expect(portal.activeView()).toBe("session");
        expect(portal.logoutOut.textContent).toContain(`HTTP ${status}`);
        expect(portal.logoutOut.textContent).toMatch(/retry|failed/i);
        expect(portal.unhandledRejections).toEqual([]);
      } finally {
        portal.cleanup();
      }
    },
  );

  it("handles non-JSON 502 error body on logout without clearing UI or throwing", async () => {
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: "csrf-502",
        });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        return makeResponse(502, "<html><body>502 Bad Gateway</body></html>", {
          isJson: false,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      portal.portalLogoutBtn.click();
      await flushAsync();

      expect(portal.navSessionTab.style.display).toBe("inline-flex");
      expect(portal.portalLogoutBtn.disabled).toBe(false);
      expect(portal.portalAuthBadge.textContent).toBe("AUTHENTICATED");
      expect(portal.statusUser.textContent).toBe("operator@gwrk");
      expect(portal.activeView()).toBe("session");
      expect(portal.logoutOut.textContent).toMatch(/502|Bad Gateway|failed/i);
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it("handles fetch network failure on logout without clearing UI or unhandled rejection", async () => {
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: "csrf-net",
        });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        throw new Error("network down");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      portal.portalLogoutBtn.click();
      await flushAsync();

      expect(portal.navSessionTab.style.display).toBe("inline-flex");
      expect(portal.portalLogoutBtn.disabled).toBe(false);
      expect(portal.portalAuthBadge.textContent).toBe("AUTHENTICATED");
      expect(portal.statusUser.textContent).toBe("operator@gwrk");
      expect(portal.activeView()).toBe("session");
      expect(portal.logoutOut.textContent).toMatch(
        /network down|failed|retry/i,
      );
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it("on 401 logout, clears UI only when independent GET /api/auth/session confirms 401", async () => {
    let sessionCall = 0;
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        sessionCall += 1;
        if (sessionCall === 1) {
          return makeResponse(200, {
            ok: true,
            expiresAt: "2026-11-26T00:00:00.000Z",
            csrfToken: "csrf-401-revoked",
          });
        }
        return makeResponse(401, { ok: false, code: "AUTH_SESSION_REVOKED" });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        return makeResponse(401, { ok: false, code: "AUTH_SESSION_REVOKED" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      portal.portalLogoutBtn.click();
      await flushAsync();

      expect(sessionCall).toBe(2);
      expect(portal.navSessionTab.style.display).toBe("none");
      expect(portal.portalLogoutBtn.disabled).toBe(true);
      expect(portal.portalAuthBadge.textContent).toBe("UNAUTHENTICATED");
      expect(portal.statusUser.textContent).toBe("guest@gwrk");
      expect(portal.headerSignin.textContent).toBe("Sign in with Google");
      expect(portal.headerSignin.getAttribute("href")).toBe("/oauth2/start");
      expect(portal.headerSignin.onclick).toBeNull();
      expect(portal.heroSignin.textContent).toBe("Sign in with Google");
      expect(portal.heroSignin.getAttribute("href")).toBe("/oauth2/start");
      expect(portal.heroSignin.onclick).toBeNull();
      expect(portal.activeView()).toBe("home");

      // Subsequent click does not fire logout since csrfToken was cleared
      const countBefore = portal.fetchCalls.length;
      portal.portalLogoutBtn.click();
      await flushAsync();
      expect(portal.fetchCalls.length).toBe(countBefore);
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it("on 401 logout, preserves authenticated UI and updates csrfToken if independent GET /api/auth/session returns 200", async () => {
    let sessionCall = 0;
    let logoutCall = 0;
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        sessionCall += 1;
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: sessionCall === 1 ? "csrf-stale" : "csrf-refreshed-200",
        });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        logoutCall += 1;
        if (logoutCall === 1) {
          return makeResponse(401, { ok: false, code: "AUTH_REQUIRED" });
        }
        return makeResponse(200, { ok: true, proxyCleared: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      portal.portalLogoutBtn.click();
      await flushAsync();

      expect(sessionCall).toBe(2);
      expect(portal.navSessionTab.style.display).toBe("inline-flex");
      expect(portal.portalLogoutBtn.disabled).toBe(false);
      expect(portal.portalAuthBadge.textContent).toBe("AUTHENTICATED");
      expect(portal.statusUser.textContent).toBe("operator@gwrk");
      expect(portal.activeView()).toBe("session");

      // Retry uses the refreshed csrfToken from the independent session check
      portal.portalLogoutBtn.click();
      await flushAsync();
      const postCalls = portal.fetchCalls.filter(
        (c) => c.url === "/api/auth/logout",
      );
      expect(postCalls).toHaveLength(2);
      expect(
        (postCalls[1].init?.headers as Record<string, string>)[
          "X-Gwrk-Csrf-Token"
        ],
      ).toBe("csrf-refreshed-200");
      expect(portal.navSessionTab.style.display).toBe("none");
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it("clears authenticated UI and switches to home on confirmed 200 logout", async () => {
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: "csrf-confirmed",
        });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        return makeResponse(200, { ok: true, proxyCleared: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      expect(portal.activeView()).toBe("session");

      portal.portalLogoutBtn.click();
      await flushAsync();

      expect(portal.navSessionTab.style.display).toBe("none");
      expect(portal.portalLogoutBtn.disabled).toBe(true);
      expect(portal.statusUser.textContent).toBe("guest@gwrk");
      expect(portal.headerSignin.textContent).toBe("Sign in with Google");
      expect(portal.headerSignin.getAttribute("href")).toBe("/oauth2/start");
      expect(portal.headerSignin.onclick).toBeNull();
      expect(portal.heroSignin.textContent).toBe("Sign in with Google");
      expect(portal.heroSignin.getAttribute("href")).toBe("/oauth2/start");
      expect(portal.heroSignin.onclick).toBeNull();
      expect(portal.portalAuthBadge.textContent).toBe("UNAUTHENTICATED");
      expect(portal.activeView()).toBe("home");
      expect(portal.logoutOut.textContent).toContain("HTTP 200");
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });

  it("ignores duplicate clicks while a logout request is already in-flight", async () => {
    let resolveLogout!: (value: ReturnType<typeof makeResponse>) => void;
    const portal = mountPortalScript(async (url, init) => {
      if (url === "/api/auth/session") {
        return makeResponse(200, {
          ok: true,
          expiresAt: "2026-11-26T00:00:00.000Z",
          csrfToken: "csrf-inflight",
        });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        return new Promise((resolve) => {
          resolveLogout = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    try {
      await flushAsync();
      portal.navSessionTab.click();
      portal.portalLogoutBtn.click();
      portal.portalLogoutBtn.click();
      await flushAsync();

      const postCalls = portal.fetchCalls.filter(
        (c) => c.url === "/api/auth/logout",
      );
      expect(postCalls).toHaveLength(1);

      resolveLogout(makeResponse(500, { ok: false, code: "INTERNAL_ERROR" }));
      await flushAsync();
      expect(portal.portalLogoutBtn.disabled).toBe(false);
      expect(portal.unhandledRejections).toEqual([]);
    } finally {
      portal.cleanup();
    }
  });
});

describe("generated portal HTML API wire-contract integrity (LOGIN_ENTRY)", () => {
  it("preserves exact dispatch curl example with projectId from docs/site/api-reference.md", () => {
    const apiRef = readFileSync(
      path.resolve("docs/site/api-reference.md"),
      "utf-8",
    );
    expect(apiRef).toContain('"projectId":"my-project"');

    // Strip Sphinx Pygments spans to verify rendered text matches the documented curl JSON payload
    const plainText = LOGIN_ENTRY.replace(/<[^>]+>/g, "");
    expect(plainText).toContain(
      '{"projectId":"my-project","featureId":"001-my-feature","phaseId":"phase-01","backend":"agy"}',
    );
    expect(plainText).not.toContain('"workspaceId":"my-project"');
  });

  it("preserves exact OpenAPI wire identifiers without substituting workspaceId for projectId", () => {
    const rawOpenApi = readFileSync(
      path.resolve("docs/openapi/gwrk-openapi.yaml"),
      "utf-8",
    );
    const spec = parseYaml(rawOpenApi) as {
      components: { schemas: Record<string, unknown> };
    };

    const rawProjectIdCount = (rawOpenApi.match(/\bprojectId\b/g) ?? []).length;
    const rawWorkspaceIdCount = (rawOpenApi.match(/\bworkspaceId\b/g) ?? [])
      .length;
    expect(rawProjectIdCount).toBeGreaterThan(0);
    expect(rawWorkspaceIdCount).toBe(1);

    // Parameter table row for ProjectIdQuery
    expect(LOGIN_ENTRY).toContain("<tr><td><code>projectId</code></td>");
    expect(LOGIN_ENTRY).toContain("<tr><td><code>project</code></td>");

    // Raw YAML block inside OpenAPI view preserves source YAML verbatim
    const yamlMatch = LOGIN_ENTRY.match(
      /<summary class="oa-schema__summary"><code>Raw OpenAPI 3\.1 YAML \(docs\/openapi\/gwrk-openapi\.yaml\)<\/code><\/summary>\s*<pre class="oa-schema__pre"><code>([\s\S]*?)<\/code><\/pre>/,
    );
    expect(yamlMatch).not.toBeNull();
    expect(yamlMatch![1]).toContain("name: projectId");
    expect(yamlMatch![1]).toContain("projectId:\n          type: string");
    expect((yamlMatch![1].match(/\bprojectId\b/g) ?? []).length).toBe(
      rawProjectIdCount,
    );
    expect((yamlMatch![1].match(/\bworkspaceId\b/g) ?? []).length).toBe(
      rawWorkspaceIdCount,
    );

    // DispatchRequest JSON schema preserves both projectId and recipient.workspaceId
    const dispatchSchemaJson = JSON.stringify(
      spec.components.schemas.DispatchRequest,
      null,
      2,
    );
    expect(LOGIN_ENTRY).toContain(dispatchSchemaJson);

    // ADR-014 §2.2:37 table cell matches verbatim ADR-014 wording
    expect(LOGIN_ENTRY).toContain(
      "Atomically create or rotate credentials with project role bindings",
    );
  });

  it("includes Google OAuth login entry, reciprocal ecosystem links, and excludes real secrets, legacy prefixes, and unserved .html routes", () => {
    expect(LOGIN_ENTRY).toContain('href="/oauth2/start"');
    expect(LOGIN_ENTRY).toContain('href="https://github.com/gforge-esc/gwrk"');
    expect(LOGIN_ENTRY).toContain(
      'href="https://github.com/gforge-esc/gwrk/releases"',
    );
    expect(LOGIN_ENTRY).toContain(
      'href="https://github.com/gforge-esc/gwrk-plugins"',
    );
    expect(LOGIN_ENTRY).toContain(
      'href="https://github.com/gforge-esc/gwrk/blob/main/SUPPORT.md"',
    );
    expect(LOGIN_ENTRY).toContain('data-guide-target="getting-started"');
    expect(LOGIN_ENTRY).toContain('data-guide-target="agent-guide"');
    expect(LOGIN_ENTRY).not.toMatch(
      /CANARY|gwrk_ak_v1_|\bgwrk_v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/,
    );
    expect(LOGIN_ENTRY).not.toMatch(
      /href="(?!https?:\/\/)[^"]*\.html(?:[#?][^"]*)?"/,
    );
    expect(LOGIN_ENTRY).not.toContain("/var/lib/gwrk/operator-keys/");
    expect(LOGIN_ENTRY).not.toContain("Cookie: __Host-gwrk_session");
  });
});
