#!/usr/bin/env python3
"""Generate the gwrk.gforge.ai portal backed 100% by verbatim quotes and citations from:
- docs/product/FOXTROT-CHARLIE.md
- notes/Foxtrot Charlie Brutal (WISEcode Edit).pdf (images/lead-diagram.png)
- docs/product/WHAT_IS_GWRK.md
- docs/decisions/ADR-014-hosted-production-auth.md
- docs/openapi/gwrk-openapi.yaml

Navigation & Flow:
- `/` (no hash): Always shows the full-screen Splash (`gwrk-draft-logo.jpeg`) with ONLY `[Hit Enter]` in the corner.
- Pressing Enter or clicking `[Hit Enter]` transitions to `#home` (`HOME` — the public landing page, or if authenticated, shows the authenticated session banner and `SESSION` tab).
- Statusline matches gforge.ai's clean 3+3 WebTUI statusbar (`guest@gwrk | ~/home.ts | main` on left; `utf-8 | 1:1 | dark/light` on right).
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
SPHINX_BUILD = REPO_ROOT / "docs/site/_build/html"
OPENAPI_YAML = REPO_ROOT / "docs/openapi/gwrk-openapi.yaml"
SPLASH_IMG = REPO_ROOT / "docs/site/_static/branding/gwrk-splash.jpg"
FLAMINGO_IMG = REPO_ROOT / "docs/site/_static/branding/gwrk-flamingo.jpg"
FAVICON_IMG = REPO_ROOT / "docs/site/_static/branding/gwrk-favicon-64.png"
PORTAL_TS_OUT = REPO_ROOT / "src/server/routes/portal-html.ts"
STATIC_PREVIEW_OUT = REPO_ROOT / "docs/site/_build/portal-preview.html"


def extract_sphinx_body(page_name: str) -> str:
    html_text = (SPHINX_BUILD / page_name).read_text(encoding="utf-8")
    m = re.search(
        r'<div class="documentwrapper">\s*<div class="bodywrapper">\s*<div class="body" role="main">(.*?)</div>\s*</div>\s*</div>',
        html_text,
        re.DOTALL,
    )
    if not m:
        raise RuntimeError(f"Could not extract body from {page_name}")
    body = m.group(1).strip()
    body = re.sub(r'<a class="headerlink"[^>]*>.*?</a>', "", body)
    for slug in [
        "index",
        "foxtrot-charlie",
        "getting-started",
        "cli-reference",
        "hosted-architecture",
        "api-reference",
    ]:
        body = body.replace(
            f'href="{slug}.html"',
            f'href="#guide-{slug}" data-guide-target="{slug}"',
        )
    return body


def main() -> None:
    splash_b64 = base64.b64encode(SPLASH_IMG.read_bytes()).decode("ascii")
    flamingo_b64 = base64.b64encode(FLAMINGO_IMG.read_bytes()).decode("ascii")
    favicon_b64 = base64.b64encode(FAVICON_IMG.read_bytes()).decode("ascii")
    openapi_spec = yaml.safe_load(OPENAPI_YAML.read_text(encoding="utf-8"))
    openapi_yaml_raw = OPENAPI_YAML.read_text(encoding="utf-8")

    foxtrot_charlie_html = extract_sphinx_body("foxtrot-charlie.html")

    sphinx_pages = {
        "index": ("00_OVERVIEW.md", extract_sphinx_body("index.html")),
        "foxtrot-charlie": ("01_FOXTROT-CHARLIE.md", foxtrot_charlie_html),
        "getting-started": ("02_GETTING-STARTED.md", extract_sphinx_body("getting-started.html")),
        "cli-reference": ("03_CLI-GRAMMAR.md", extract_sphinx_body("cli-reference.html")),
        "hosted-architecture": ("04_ADR-014-SECURITY.md", extract_sphinx_body("hosted-architecture.html")),
        "api-reference": ("05_HTTP-ROUTES.md", extract_sphinx_body("api-reference.html")),
    }

    guide_nav_buttons = []
    guide_panels = []
    for idx, (slug, (tab_label, content)) in enumerate(sphinx_pages.items()):
        active_attr = ' data-active="true"' if idx == 0 else ""
        guide_nav_buttons.append(
            f'<button type="button" class="tui-subtab" data-guide-btn="{slug}"{active_attr}>{tab_label}</button>'
        )
        guide_panels.append(
            f'<article class="sphinx-article" id="guide-panel-{slug}" data-guide-panel="{slug}"{active_attr}>{content}</article>'
        )

    api_cards = []
    for route_path, methods_obj in openapi_spec.get("paths", {}).items():
        for method, op in methods_obj.items():
            m_upper = method.upper()
            summary = op.get("summary", "")
            desc = op.get("description", "").strip()
            tags = ", ".join(op.get("tags", []))
            sec_list = op.get("security", [])
            sec_badges = []
            if not sec_list:
                sec_badges.append('<span class="tui-badge tui-badge--cyan">PUBLIC</span>')
            else:
                for sec_item in sec_list:
                    for k in sec_item.keys():
                        sec_badges.append(f'<span class="tui-badge tui-badge--magenta">{k}</span>')
            params = op.get("parameters", [])
            param_rows = []
            for p in params:
                if "$ref" in p:
                    ref_name = p["$ref"].split("/")[-1]
                    p = openapi_spec["components"]["parameters"][ref_name]
                p_name = p.get("name", "")
                p_in = p.get("in", "")
                p_req = "required" if p.get("required") else "optional"
                p_desc = p.get("description", "")
                param_rows.append(
                    f"<tr><td><code>{p_name}</code></td><td>{p_in}</td><td>{p_req}</td><td>{p_desc}</td></tr>"
                )
            params_html = ""
            if param_rows:
                params_html = (
                    '<div class="oa-subhead">PARAMETERS</div>'
                    '<table class="tui-table"><thead><tr><th>Name</th><th>In</th><th>Req</th><th>Notes</th></tr></thead>'
                    f'<tbody>{"".join(param_rows)}</tbody></table>'
                )

            resp_rows = []
            for code, r_obj in op.get("responses", {}).items():
                r_desc = r_obj.get("description", "")
                code_cls = (
                    "oa-code--2xx"
                    if code.startswith("2")
                    else ("oa-code--3xx" if code.startswith("3") else "oa-code--4xx")
                )
                resp_rows.append(
                    f'<tr><td><span class="oa-status {code_cls}">{code}</span></td><td>{r_desc}</td></tr>'
                )
            resps_html = (
                '<div class="oa-subhead">RESPONSES</div>'
                '<table class="tui-table"><thead><tr><th>HTTP</th><th>Outcome</th></tr></thead>'
                f'<tbody>{"".join(resp_rows)}</tbody></table>'
            )

            api_cards.append(
                f"""
                <details class="oa-card" open>
                  <summary class="oa-card__summary">
                    <span class="oa-method oa-method--{method.lower()}">{m_upper}</span>
                    <code class="oa-path">{route_path}</code>
                    <span class="oa-title">{summary}</span>
                    <span class="oa-badges">{"".join(sec_badges)}</span>
                  </summary>
                  <div class="oa-card__body">
                    <div class="oa-tag">TAG // {tags}</div>
                    <p class="oa-desc">{desc}</p>
                    {params_html}
                    {resps_html}
                  </div>
                </details>
                """
            )

    schemas_html = []
    for s_name, s_obj in openapi_spec.get("components", {}).get("schemas", {}).items():
        s_json = json.dumps(s_obj, indent=2)
        schemas_html.append(
            f"""
            <details class="oa-schema">
              <summary class="oa-schema__summary"><code>components.schemas.{s_name}</code></summary>
              <pre class="oa-schema__pre"><code>{s_json}</code></pre>
            </details>
            """
        )

    ascii_wordmark = r"""   ██████╗ ██╗    ██╗██████╗ ██╗  ██╗    ██╗  ██╗    ██████╗ ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
  ██╔════╝ ██║    ██║██╔══██╗██║ ██╔╝    ╚██╗██╔╝   ██╔════╝ ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
  ██║  ███╗██║ █╗ ██║██████╔╝█████╔╝      ╚███╔╝    ██║  ███╗█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  
  ██║   ██║██║███╗██║██╔══██╗██╔═██╗      ██╔██╗    ██║   ██║██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  
  ╚██████╔╝╚███╔███╔╝██║  ██║██║  ██╗    ██╔╝ ██╗   ╚██████╔╝██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
   ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═╝  ╚═╝    ╚═════╝ ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝"""

    html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" type="image/png" sizes="64x64" href="data:image/png;base64,{favicon_b64}">
  <link rel="apple-touch-icon" href="data:image/png;base64,{favicon_b64}">
  <script>
    try {{
      var s = localStorage.getItem("color-scheme");
      if (s === "light" || s === "dark") {{
        document.querySelector('meta[name="color-scheme"]').content = s;
      }}
    }} catch (e) {{}}
  </script>
  <title>gwrk — gforge.ai</title>
  <style>
    :root {{
      color-scheme: light dark;
      --sol-base03: #002b36;
      --sol-base02: #073642;
      --sol-base01: #586e75;
      --sol-base00: #657b83;
      --sol-base0: #839496;
      --sol-base1: #93a1a1;
      --sol-base2: #eee8d5;
      --sol-base3: #fdf6e3;
      --sol-yellow: #b58900;
      --sol-orange: #cb4b16;
      --sol-red: #dc322f;
      --sol-magenta: #d33682;
      --sol-violet: #6c71c4;
      --sol-blue: #268bd2;
      --sol-cyan: #2aa198;
      --sol-green: #859900;

      --flamingo-hot: #ff2a85;
      --crown-gold: #f6c343;

      --bg0: var(--sol-base3);
      --bg1: var(--sol-base2);
      --bg2: #e4dec8;
      --fg0: var(--sol-base03);
      --fg1: var(--sol-base01);
      --fg2: var(--sol-base00);
      --border-strong: var(--sol-base01);
      --border-subtle: #c9c1a9;
      --surface-card: rgba(238, 232, 213, 0.94);
      --ascii-op: 0.14;
      --scrollbar-track: var(--sol-base2);
      --scrollbar-thumb: var(--sol-base01);

      @media (prefers-color-scheme: dark) {{
        --bg0: var(--sol-base03);
        --bg1: var(--sol-base02);
        --bg2: #0a404e;
        --fg0: var(--sol-base2);
        --fg1: var(--sol-base1);
        --fg2: var(--sol-base0);
        --border-strong: var(--sol-cyan);
        --border-subtle: #195466;
        --surface-card: rgba(7, 54, 66, 0.94);
        --ascii-op: 0.20;
        --scrollbar-track: var(--sol-base03);
        --scrollbar-thumb: var(--sol-base01);
      }}

      @supports (color: light-dark(white, black)) {{
        --bg0: light-dark(var(--sol-base3), var(--sol-base03));
        --bg1: light-dark(var(--sol-base2), var(--sol-base02));
        --bg2: light-dark(#e4dec8, #0a404e);
        --fg0: light-dark(var(--sol-base03), var(--sol-base2));
        --fg1: light-dark(var(--sol-base01), var(--sol-base1));
        --fg2: light-dark(var(--sol-base00), var(--sol-base0));
        --border-strong: light-dark(var(--sol-base01), var(--sol-cyan));
        --border-subtle: light-dark(#c9c1a9, #195466);
        --surface-card: light-dark(rgba(238, 232, 213, 0.94), rgba(7, 54, 66, 0.94));
        --scrollbar-track: light-dark(var(--sol-base2), var(--sol-base03));
        --scrollbar-thumb: light-dark(var(--sol-base01), var(--sol-base0));
      }}

      &:has(> head > meta[name="color-scheme"][content="dark"]) {{
        color-scheme: dark;
        --bg0: var(--sol-base03);
        --bg1: var(--sol-base02);
        --bg2: #0a404e;
        --fg0: var(--sol-base2);
        --fg1: var(--sol-base1);
        --fg2: var(--sol-base0);
        --border-strong: var(--sol-cyan);
        --border-subtle: #195466;
        --surface-card: rgba(7, 54, 66, 0.94);
      }}
      &:has(> head > meta[name="color-scheme"][content="light"]) {{
        color-scheme: light;
        --bg0: var(--sol-base3);
        --bg1: var(--sol-base2);
        --bg2: #e4dec8;
        --fg0: var(--sol-base03);
        --fg1: var(--sol-base01);
        --fg2: var(--sol-base00);
        --border-strong: var(--sol-base01);
        --border-subtle: #c9c1a9;
        --surface-card: rgba(238, 232, 213, 0.94);
      }}

      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace;
      accent-color: var(--flamingo-hot);
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    html, body {{
      min-height: 100dvh;
      background-color: var(--bg0);
      color: var(--fg0);
      font-family: var(--font-mono);
      font-size: 15px;
      line-height: 1.55;
      overflow-x: hidden;
    }}

    ::selection {{
      background-color: var(--flamingo-hot);
      color: #fff;
    }}

    /* =========================================================================
       STAGE 1: FULL-SCREEN SPLASH (`gwrk-draft-logo.jpeg`)
       Only indication that there's more: `[Hit Enter]` in monospaced corner
       ========================================================================= */
    .splash-curtain {{
      position: fixed;
      inset: 0;
      z-index: 9999;
      background-color: #d81b60;
      background-image: url("data:image/jpeg;base64,{splash_b64}");
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
      cursor: pointer;
      user-select: none;
      transition: opacity 0.25s ease, visibility 0.25s ease;
    }}
    .splash-curtain[data-dismissed="true"] {{
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }}
    .splash-enter-prompt {{
      position: absolute;
      right: clamp(1.25rem, 3.5vw, 2.5rem);
      bottom: clamp(1.25rem, 3.5dvh, 2.25rem);
      font-family: var(--font-mono);
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #fdf6e3;
      background: rgba(0, 43, 54, 0.82);
      border: 1px solid rgba(253, 246, 227, 0.75);
      padding: 0.4rem 0.8rem;
      cursor: pointer;
    }}
    .splash-enter-prompt:hover, .splash-enter-prompt:focus-visible {{
      background: rgba(0, 43, 54, 0.96);
      border-color: var(--crown-gold);
      color: var(--crown-gold);
      outline: none;
    }}

    /* =========================================================================
       STAGE 2 & 3: SOLARIZED TUI SHELL (`HOME` + DOCS + SIGNED-IN `SESSION`)
       ========================================================================= */
    .parallax-wordmark {{
      position: fixed;
      top: 4dvh;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 0;
      opacity: var(--ascii-op);
      overflow: hidden;
    }}
    .parallax-wordmark__ascii {{
      font-family: var(--font-mono);
      font-size: clamp(0.45rem, 1.05vw, 0.92rem);
      line-height: 1.05;
      white-space: pre;
      background: linear-gradient(135deg, var(--flamingo-hot) 0%, var(--sol-magenta) 45%, var(--sol-cyan) 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      -webkit-text-fill-color: transparent;
      user-select: none;
    }}

    .tui-shell {{
      position: relative;
      z-index: 2;
      width: min(1180px, 95vw);
      margin: 0 auto;
      padding: clamp(1rem, 2.5dvh, 2rem) 0 4.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
    }}

    .tui-box {{
      background: var(--surface-card);
      border: 2px solid var(--border-subtle);
      position: relative;
      backdrop-filter: blur(6px);
    }}
    .tui-box--flamingo {{
      border-color: var(--flamingo-hot);
    }}
    .tui-box--cyan {{
      border-color: var(--sol-cyan);
    }}

    /* Top Masthead */
    .masthead {{
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.65rem 1rem;
      background: var(--bg1);
      border-bottom: 2px solid var(--border-subtle);
      position: sticky;
      top: 0;
      z-index: 30;
    }}
    .brand-cluster {{
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }}
    .brand-favicon {{
      width: 28px;
      height: 28px;
      border-radius: 3px;
      border: 1px solid var(--flamingo-hot);
      background: #fff;
      object-fit: contain;
      cursor: pointer;
    }}
    .brand-link {{
      display: inline-flex;
      align-items: center;
      gap: 0.35ch;
      text-decoration: none;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--fg0);
    }}
    .brand-prompt {{
      color: var(--flamingo-hot);
      font-weight: 900;
    }}
    .brand-word {{
      color: var(--sol-cyan);
    }}
    .brand-cursor {{
      display: inline-block;
      width: 0.55ch;
      height: 1.1em;
      background: var(--flamingo-hot);
      vertical-align: text-bottom;
      animation: blink 1.1s step-end infinite;
    }}
    @keyframes blink {{
      0%, 100% {{ opacity: 1; }}
      50% {{ opacity: 0; }}
    }}

    .masthead-nav {{
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex-wrap: wrap;
    }}

    .tui-tab, .tui-btn {{
      font-family: var(--font-mono);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 0.38rem 0.7rem;
      background: var(--bg0);
      color: var(--fg0);
      border: 1.5px solid var(--border-subtle);
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.4ch;
    }}
    .tui-tab:hover, .tui-btn:hover {{
      border-color: var(--flamingo-hot);
      color: var(--flamingo-hot);
    }}
    .tui-tab[data-active="true"] {{
      background: var(--flamingo-hot);
      color: #fff;
      border-color: var(--flamingo-hot);
    }}
    .tui-btn--primary {{
      background: var(--flamingo-hot);
      color: #fff !important;
      border-color: var(--flamingo-hot);
    }}
    .tui-btn--cyan {{
      border-color: var(--sol-cyan);
      color: var(--sol-cyan);
    }}

    .cite-tag {{
      display: inline-block;
      font-size: 0.72rem;
      color: var(--sol-cyan);
      font-family: var(--font-mono);
    }}

    .view-panel {{
      display: none;
      flex-direction: column;
      gap: 1.15rem;
    }}
    .view-panel[data-active="true"] {{
      display: flex;
    }}

    /* Home Hero: Verbatim Thesis + Flamingo Mascot */
    .hero-grid {{
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 1.15rem;
      align-items: stretch;
    }}
    @media (max-width: 920px) {{
      .hero-grid {{
        grid-template-columns: 1fr;
      }}
    }}
    .hero-copy {{
      padding: 1.35rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1rem;
    }}
    .tui-kicker {{
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--flamingo-hot);
    }}
    .hero-title {{
      font-size: clamp(1.35rem, 1rem + 1.4vw, 2.15rem);
      line-height: 1.2;
      color: var(--fg0);
      font-weight: 800;
    }}
    .hero-quote {{
      padding: 0.75rem 0.95rem;
      background: var(--bg1);
      border-left: 3px solid var(--flamingo-hot);
      font-size: 0.88rem;
      color: var(--fg0);
    }}
    .hero-cta-row {{
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.55rem;
    }}

    .flamingo-card {{
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.75rem;
      background: var(--bg1);
    }}
    .flamingo-card__img-wrap {{
      background: #ffffff;
      border: 1.5px solid var(--flamingo-hot);
      padding: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .flamingo-card__img {{
      width: 100%;
      max-height: 270px;
      aspect-ratio: 1024 / 648;
      object-fit: contain;
      display: block;
    }}

    /* Exact Foxtrot Charlie Lead Diagram Card */
    .loop-card {{
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }}
    .loop-svg-wrap {{
      width: 100%;
      overflow-x: auto;
      background: var(--bg0);
      border: 1px solid var(--border-subtle);
      padding: 1rem;
    }}
    .loop-svg {{
      width: 100%;
      min-width: 720px;
      height: auto;
      display: block;
      font-family: var(--font-mono);
    }}

    .section-header {{
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem 1rem;
      background: var(--bg1);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }}
    .section-body {{
      padding: 1.1rem;
    }}

    .tui-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }}
    .tui-table th {{
      text-align: left;
      padding: 0.5rem 0.7rem;
      background: var(--bg1);
      color: var(--sol-cyan);
      border: 1px solid var(--border-subtle);
      text-transform: uppercase;
      font-size: 0.73rem;
      letter-spacing: 0.05em;
    }}
    .tui-table td {{
      padding: 0.5rem 0.7rem;
      border: 1px solid var(--border-subtle);
      color: var(--fg0);
      vertical-align: top;
    }}
    .tui-badge {{
      display: inline-block;
      padding: 0.1rem 0.45rem;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1px solid currentColor;
    }}
    .tui-badge--green {{ color: var(--sol-green); }}
    .tui-badge--cyan {{ color: var(--sol-cyan); }}
    .tui-badge--magenta {{ color: var(--flamingo-hot); }}
    .tui-badge--gold {{ color: var(--sol-yellow); }}

    /* Foxtrot Charlie Public Article Reader */
    .fc-article-container {{
      max-width: 86ch;
      margin: 0 auto;
      padding: 1.5rem clamp(1rem, 3vw, 2.25rem);
      background: var(--bg0);
      border: 1px solid var(--border-subtle);
    }}
    .fc-article-container h1 {{
      font-size: clamp(1.25rem, 1rem + 1.1vw, 1.75rem);
      color: var(--flamingo-hot);
      border-bottom: 2px solid var(--flamingo-hot);
      padding-bottom: 0.4rem;
      margin: 1.4rem 0 0.8rem;
    }}
    .fc-article-container h1:first-of-type {{
      margin-top: 0;
    }}
    .fc-article-container h2 {{
      font-size: 1.1rem;
      color: var(--sol-cyan);
      border-bottom: 1px dashed var(--border-subtle);
      padding-bottom: 0.25rem;
      margin: 1.25rem 0 0.6rem;
    }}
    .fc-article-container h3 {{
      font-size: 0.95rem;
      color: var(--sol-yellow);
      margin: 1rem 0 0.4rem;
    }}
    .fc-article-container p, .fc-article-container li {{
      color: var(--fg0);
      font-size: 0.9rem;
      line-height: 1.65;
      margin-bottom: 0.7rem;
    }}
    .fc-article-container ul, .fc-article-container ol {{
      padding-left: 1.5rem;
      margin-bottom: 0.85rem;
    }}
    .fc-article-container hr {{
      border: none;
      border-top: 1px dashed var(--border-subtle);
      margin: 1.4rem 0;
    }}

    /* Sphinx Guides Layout */
    .guides-layout {{
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 1rem;
      padding: 1rem;
    }}
    @media (max-width: 860px) {{
      .guides-layout {{
        grid-template-columns: 1fr;
      }}
    }}
    .guides-sidebar {{
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      background: var(--bg1);
      padding: 0.7rem;
      border: 1px solid var(--border-subtle);
      align-self: start;
    }}
    .guides-sidebar__title {{
      font-size: 0.73rem;
      font-weight: 700;
      color: var(--flamingo-hot);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.3rem;
    }}
    .tui-subtab {{
      font-family: var(--font-mono);
      font-size: 0.75rem;
      text-align: left;
      padding: 0.42rem 0.6rem;
      background: var(--bg0);
      color: var(--fg1);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
    }}
    .tui-subtab:hover {{
      border-color: var(--sol-cyan);
      color: var(--fg0);
    }}
    .tui-subtab[data-active="true"] {{
      border-left: 3px solid var(--flamingo-hot);
      color: var(--fg0);
      font-weight: 700;
      background: var(--bg2);
    }}

    .sphinx-article {{
      display: none;
      padding: 1.2rem;
      background: var(--bg0);
      border: 1px solid var(--border-subtle);
      overflow-x: auto;
    }}
    .sphinx-article[data-active="true"] {{
      display: block;
    }}
    .sphinx-article h1 {{
      font-size: 1.3rem;
      color: var(--flamingo-hot);
      border-bottom: 2px solid var(--border-subtle);
      padding-bottom: 0.35rem;
      margin-bottom: 0.8rem;
    }}
    .sphinx-article h2 {{
      font-size: 1.02rem;
      color: var(--sol-cyan);
      margin: 1.1rem 0 0.45rem;
      border-bottom: 1px dashed var(--border-subtle);
      padding-bottom: 0.2rem;
    }}
    .sphinx-article h3 {{
      font-size: 0.9rem;
      color: var(--sol-yellow);
      margin: 0.85rem 0 0.35rem;
    }}
    .sphinx-article p, .sphinx-article li {{
      color: var(--fg0);
      margin-bottom: 0.55rem;
      font-size: 0.86rem;
    }}
    .sphinx-article ul, .sphinx-article ol {{
      padding-left: 1.4rem;
      margin-bottom: 0.7rem;
    }}
    .sphinx-article pre {{
      background: var(--bg1);
      border: 1px solid var(--border-subtle);
      padding: 0.7rem;
      overflow-x: auto;
      margin: 0.6rem 0;
      font-size: 0.78rem;
    }}
    .sphinx-article code {{
      background: var(--bg1);
      padding: 0.1rem 0.3rem;
      border: 1px solid var(--border-subtle);
      font-size: 0.82em;
    }}
    .sphinx-article pre code {{
      border: none;
      padding: 0;
    }}
    .sphinx-article table {{
      width: 100%;
      border-collapse: collapse;
      margin: 0.7rem 0;
      font-size: 0.8rem;
    }}
    .sphinx-article th, .sphinx-article td {{
      border: 1px solid var(--border-subtle);
      padding: 0.42rem 0.6rem;
      text-align: left;
    }}
    .sphinx-article th {{
      background: var(--bg1);
      color: var(--sol-cyan);
    }}

    /* OpenAPI 3.1 Explorer */
    .oa-container {{
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }}
    .oa-card {{
      border: 1px solid var(--border-subtle);
      background: var(--bg0);
    }}
    .oa-card__summary {{
      padding: 0.6rem 0.85rem;
      background: var(--bg1);
      cursor: pointer;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem;
      list-style: none;
    }}
    .oa-method {{
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.15rem 0.5rem;
      color: #fff;
      min-width: 4.2rem;
      text-align: center;
    }}
    .oa-method--get {{ background: var(--sol-blue); }}
    .oa-method--post {{ background: var(--flamingo-hot); }}
    .oa-path {{
      font-weight: 700;
      color: var(--fg0);
      font-size: 0.86rem;
    }}
    .oa-title {{
      color: var(--fg1);
      font-size: 0.8rem;
      flex: 1 1 auto;
    }}
    .oa-badges {{
      display: inline-flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }}
    .oa-card__body {{
      padding: 0.85rem;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }}
    .oa-tag {{
      font-size: 0.7rem;
      color: var(--sol-cyan);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }}
    .oa-desc {{
      font-size: 0.84rem;
      color: var(--fg1);
      white-space: pre-line;
    }}
    .oa-subhead {{
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--flamingo-hot);
      letter-spacing: 0.06em;
      margin-top: 0.2rem;
    }}
    .oa-status {{
      font-weight: 700;
      padding: 0.1rem 0.35rem;
    }}
    .oa-code--2xx {{ color: var(--sol-green); }}
    .oa-code--3xx {{ color: var(--sol-cyan); }}
    .oa-code--4xx {{ color: var(--flamingo-hot); }}

    .oa-schema {{
      border: 1px solid var(--border-subtle);
      background: var(--bg0);
    }}
    .oa-schema__summary {{
      padding: 0.45rem 0.7rem;
      cursor: pointer;
      background: var(--bg1);
      font-size: 0.78rem;
    }}
    .oa-schema__pre {{
      padding: 0.7rem;
      font-size: 0.76rem;
      overflow-x: auto;
    }}

    /* Signed-In Session Console */
    .console-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      padding: 1rem;
    }}
    @media (max-width: 860px) {{
      .console-grid {{
        grid-template-columns: 1fr;
      }}
    }}
    .console-card {{
      background: var(--bg0);
      border: 1px solid var(--border-subtle);
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }}
    .console-pre {{
      background: var(--bg1);
      border: 1px solid var(--border-subtle);
      padding: 0.7rem;
      font-size: 0.76rem;
      min-height: 7rem;
      max-height: 16rem;
      overflow: auto;
      white-space: pre-wrap;
    }}

    /* =========================================================================
       CLEAN GFORGE.AI STATUSLINE (3 items left, 3 items right)
       Left:  guest@gwrk | ~/home.ts | main
       Right: utf-8 | 1:1 | dark
       ========================================================================= */
    .home-hero__statusbar {{
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      z-index: 40;
      padding: 0.38rem clamp(0.85rem, 3vw, 2rem);
      background: var(--bg1);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.78rem;
      backdrop-filter: blur(8px);
    }}
    .home-hero__status-left,
    .home-hero__status-right {{
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }}
    .home-hero__status-text {{
      color: var(--fg1);
    }}
    .home-hero__status-sep {{
      color: var(--fg2);
      opacity: 0.7;
    }}
    .home-hero__status-branch {{
      color: var(--fg0);
      font-weight: 600;
    }}
    .home-hero__status-meta {{
      color: var(--fg1);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }}
    .home-hero__status-mode {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.12rem 0.45rem;
      background: var(--bg0);
      border: 1px solid var(--border-subtle);
      font-size: 0.68rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      line-height: 1;
      color: var(--fg0);
    }}
  </style>
</head>
<body>
  <!-- =======================================================================
       STAGE 1: FULL-SCREEN SPLASH (`gwrk-draft-logo.jpeg`)
       Only indication that there's more: `[Hit Enter]` in monospaced corner
       ======================================================================= -->
  <div
    class="splash-curtain"
    id="splash-curtain"
    role="dialog"
    aria-label="gwrk splash screen — Hit Enter to continue"
    data-dismissed="false"
  >
    <button
      type="button"
      class="splash-enter-prompt"
      id="splash-enter-btn"
      aria-label="Hit Enter"
    >[Hit Enter]</button>
  </div>

  <!-- ASCII Backdrop -->
  <div class="parallax-wordmark" aria-hidden="true">
    <pre class="parallax-wordmark__ascii">{ascii_wordmark}</pre>
  </div>

  <!-- =======================================================================
       STAGE 2 & 3: SOLARIZED TUI SHELL (`HOME` -> `FOXTROT CHARLIE` -> `GUIDES` -> `OPENAPI`)
       ======================================================================= -->
  <div class="tui-shell">
    <!-- Top Masthead -->
    <header class="masthead tui-box">
      <div class="brand-cluster">
        <img
          class="brand-favicon"
          src="data:image/png;base64,{favicon_b64}"
          alt="gwrk Flamingo Icon"
          width="28"
          height="28"
          title="Show Splash Screen"
          id="replay-splash-icon"
        >
        <a href="#home" class="brand-link" id="brand-home-link" aria-label="Go to home">
          <span class="brand-prompt">&gt;</span>
          <span class="brand-word">GWRK</span>
          <span class="brand-cursor" aria-hidden="true"></span>
        </a>
        <span class="tui-badge tui-badge--magenta">YOU BETTER GWRK!</span>
      </div>

      <nav class="masthead-nav" aria-label="Primary navigation">
        <button type="button" class="tui-tab" data-view-btn="home" data-active="true">HOME</button>
        <button type="button" class="tui-tab" data-view-btn="foxtrot">FOXTROT CHARLIE</button>
        <button type="button" class="tui-tab" data-view-btn="guides">GUIDES</button>
        <button type="button" class="tui-tab" data-view-btn="api">OPENAPI</button>
        <button type="button" class="tui-tab" data-view-btn="session" id="nav-session-tab" style="display:none">SESSION</button>
        <button type="button" class="tui-btn" id="theme-toggle" aria-label="Switch theme">DARK</button>
        <a href="/oauth2/start" class="tui-btn tui-btn--primary" id="header-signin-link">Sign in with Google</a>
      </nav>
    </header>

    <!-- =====================================================================
         VIEW 1: HOME (PUBLIC LANDING PAGE — 100% VERBATIM CITED)
         ===================================================================== -->
    <section class="view-panel" id="view-home" data-view-panel="home" data-active="true" aria-label="Home">
      <div class="hero-grid">
        <div class="tui-box tui-box--flamingo hero-copy">
          <div>
            <div class="tui-kicker">FOXTROT CHARLIE // DOCS/PRODUCT/FOXTROT-CHARLIE.MD</div>
            <h1 class="hero-title" style="margin-top:0.4rem">
              What gets built is 1,000% more important than how it gets built.
            </h1>
            <p style="font-size:0.88rem;color:var(--fg1);margin-top:0.35rem">
              <em>Not rhetorically. Literally.</em>
              <span class="cite-tag">[FOXTROT-CHARLIE.md:15-17]</span>
            </p>
          </div>

          <blockquote class="hero-quote">
            <strong>"The scarce resource in AI-assisted engineering isn't code generation — it's architectural judgment."</strong><br>
            <span style="font-size:0.84rem;color:var(--fg1)">
              gwrk is the automation of Foxtrot Charlie — an operating model built for outcomes, not ceremony.
            </span>
            <span class="cite-tag">[WHAT_IS_GWRK.md:17, 59]</span>
          </blockquote>

          <div class="hero-quote" style="border-left-color:var(--sol-cyan)">
            <strong>Mantra: Truth &rarr; Clarity &rarr; Throughput &rarr; Value</strong>
            <span class="cite-tag">[FOXTROT-CHARLIE.md:124-131]</span>
            <ul style="list-style:none;margin-top:0.35rem;font-size:0.84rem;color:var(--fg1)">
              <li>&bull; <strong>Discovery extracts truth.</strong></li>
              <li>&bull; <strong>Definition creates clarity.</strong></li>
              <li>&bull; <strong>Shipping creates throughput.</strong></li>
              <li>&bull; <strong>Delivery creates value.</strong></li>
            </ul>
          </div>

          <div class="hero-cta-row">
            <a href="/oauth2/start" class="tui-btn tui-btn--primary" id="hero-signin-link">
              Sign in with Google
            </a>
            <button type="button" class="tui-btn tui-btn--cyan" onclick="window.switchGwrkView('foxtrot')">
              Read Foxtrot Charlie
            </button>
            <button type="button" class="tui-btn" onclick="window.switchGwrkView('guides')">
              Sphinx Guides
            </button>
            <button type="button" class="tui-btn" onclick="window.switchGwrkView('api')">
              OpenAPI 3.1
            </button>
            <button type="button" class="tui-btn" id="replay-splash-btn" title="Return to Splash">
              Splash
            </button>
          </div>
        </div>

        <!-- Flamingo Mascot & Etymology (Verbatim from WHAT_IS_GWRK.md:219-233) -->
        <div class="tui-box tui-box--flamingo flamingo-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="tui-kicker">DOCS/BRANDING/GWRK-FLAMINGO-FLAT.PNG</span>
            <span class="tui-badge tui-badge--magenta">YOU BETTER GWRK!</span>
          </div>
          <div class="flamingo-card__img-wrap">
            <img
              class="flamingo-card__img"
              src="data:image/jpeg;base64,{flamingo_b64}"
              alt="gwrk — You better gwrk!"
              width="560"
              height="354"
            >
          </div>
          <div style="font-size:0.8rem;color:var(--fg1)">
            <p>
              <strong>gwrk</strong> is pronounced <strong>"gwerk"</strong> — one syllable, rhymes with <em>work</em>. The name draws from the same well as <code>grep</code>, <code>sed</code>, <code>awk</code>, <code>gawk</code> — terse commands that do one thing ruthlessly well.
            </p>
            <p style="margin-top:0.35rem">
              <strong>The precision of GNU tooling</strong> meets the <strong>audacity of the runway</strong>. A flamingo stands on one leg in the mud and looks like it owns the place.
              <span class="cite-tag">[WHAT_IS_GWRK.md:221-232]</span>
            </p>
          </div>
        </div>
      </div>

      <!-- EXACT LEAD DIAGRAM FROM PAGE 1 OF FOXTROT CHARLIE PDF (ZERO EXTRA WORDS INSIDE BOXES) -->
      <div class="tui-box tui-box--cyan loop-card">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.5rem">
          <div>
            <span class="tui-kicker" style="color:var(--sol-cyan)">INTEGRATED LOOP: THE FOUR PILLARS IN MOTION [FOXTROT-CHARLIE.MD:372-378]</span>
            <h2 style="font-size:1.05rem;margin-top:0.2rem">
              Discovery &rarr; Definition &rarr; Shipping &rarr; Delivery &rarr; Back to Discovery
            </h2>
          </div>
          <span class="cite-tag">[Source: Foxtrot Charlie PDF Page 1 Lead Diagram]</span>
        </div>

        <div class="loop-svg-wrap" role="img" aria-label="Foxtrot Charlie Lead Diagram: Truth from Discovery -> Clarity from Definition -> Throughput from Shipping -> Value from Delivery -> back to Truth from Discovery.">
          <svg class="loop-svg" viewBox="0 0 980 275" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="fc-card-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#7aa8f8"/>
                <stop offset="100%" stop-color="#c8ddfe"/>
              </linearGradient>
              <marker id="fc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#2aa198"/>
              </marker>
            </defs>

            <!-- Curved Arch 1: Truth (top center 135, 125) -> Clarity (left center 255, 65) -->
            <path d="M 135 125 C 135 72, 185 65, 247 65" fill="none" stroke="#2aa198" stroke-width="2.5" marker-end="url(#fc-arrow)"/>

            <!-- Straight Arrow 2: Clarity (right center 475, 65) -> Throughput (left center 515, 65) -->
            <line x1="475" y1="65" x2="507" y2="65" stroke="#2aa198" stroke-width="2.5" marker-end="url(#fc-arrow)"/>

            <!-- Curved Arch 3: Throughput (right center 735, 65) -> Value (top center 845, 125) -->
            <path d="M 735 65 C 805 65, 845 72, 845 117" fill="none" stroke="#2aa198" stroke-width="2.5" marker-end="url(#fc-arrow)"/>

            <!-- Sweeping Bottom Return Curve 4: Value (bottom center 845, 215) -> Truth (bottom center 135, 215) -->
            <path d="M 845 215 C 845 268, 135 268, 135 223" fill="none" stroke="#2aa198" stroke-width="2.5" marker-end="url(#fc-arrow)"/>

            <!-- BOX 1: Truth from Discovery -->
            <rect x="25" y="125" width="220" height="90" rx="8" fill="url(#fc-card-grad)" stroke="#268bd2" stroke-width="2"/>
            <text x="45" y="170" fill="#002b36" font-size="22" font-weight="800">Truth</text>
            <text x="45" y="192" fill="#073642" font-size="14">from <tspan font-weight="800">Discovery</tspan></text>

            <!-- BOX 2: Clarity from Definition -->
            <rect x="255" y="20" width="220" height="90" rx="8" fill="url(#fc-card-grad)" stroke="#268bd2" stroke-width="2"/>
            <text x="275" y="65" fill="#002b36" font-size="22" font-weight="800">Clarity</text>
            <text x="275" y="87" fill="#073642" font-size="14">from <tspan font-weight="800">Definition</tspan></text>

            <!-- BOX 3: Throughput from Shipping -->
            <rect x="515" y="20" width="220" height="90" rx="8" fill="url(#fc-card-grad)" stroke="#268bd2" stroke-width="2"/>
            <text x="535" y="65" fill="#002b36" font-size="22" font-weight="800">Throughput</text>
            <text x="535" y="87" fill="#073642" font-size="14">from <tspan font-weight="800">Shipping</tspan></text>

            <!-- BOX 4: Value from Delivery -->
            <rect x="735" y="125" width="220" height="90" rx="8" fill="url(#fc-card-grad)" stroke="#268bd2" stroke-width="2"/>
            <text x="755" y="170" fill="#002b36" font-size="22" font-weight="800">Value</text>
            <text x="755" y="192" fill="#073642" font-size="14">from <tspan font-weight="800">Delivery</tspan></text>
          </svg>
        </div>

        <!-- THE FOUR PILLARS: 100% VERBATIM FROM FOXTROT-CHARLIE.MD -->
        <div style="overflow-x:auto">
          <table class="tui-table">
            <thead>
              <tr>
                <th>Pillar</th>
                <th>What It Answers (Verbatim)</th>
                <th>Operating Principles (Verbatim)</th>
                <th>Citation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Pillar 1: Discovery (Truth Extraction)</strong><br>
                  <span style="color:var(--flamingo-hot)">Extract truth. Don't wait for it.</span>
                </td>
                <td>"What progress is the customer trying to make, and what's blocking it?"</td>
                <td>
                  Messy truth &gt; clean narratives &bull; Direct exposure &gt; filtered reports &bull; Every insight maps to progress &bull; Rapid probes: prototypes, instrumentation, small tests &bull; Compress information: shared shorthand, simple truths
                </td>
                <td><span class="cite-tag">FOXTROT-CHARLIE.md:135-183</span></td>
              </tr>
              <tr>
                <td>
                  <strong>Pillar 2: Definition (Clarity &amp; Commitments)</strong><br>
                  <span style="color:var(--sol-blue)">Say what we will do, and when.</span>
                </td>
                <td>"What are we building, for whom, what is 'done', and when will it be completed?"</td>
                <td>
                  Specs and commitments are written artifacts, not conversations &bull; ACs describe testable behavior, not interpretation &bull; Internal Roadmap = The Commitment Spine &bull; Strong Definition eliminates 70% of rework
                </td>
                <td><span class="cite-tag">FOXTROT-CHARLIE.md:187-240</span></td>
              </tr>
              <tr>
                <td>
                  <strong>Pillar 3: Shipping (Execution &amp; Learning)</strong><br>
                  <span style="color:var(--sol-yellow)">Learn fast, fix fast.</span>
                </td>
                <td>"How do we build and ship well, and learn fast?"</td>
                <td>
                  Ship to learn &bull; Fast reds: surface problems early &bull; State &gt; story — tickets, tests, dashboards are truth &bull; QA + automation daily, not a phase &bull; No heroics; shipping is a reflex
                </td>
                <td><span class="cite-tag">FOXTROT-CHARLIE.md:244-282</span></td>
              </tr>
              <tr>
                <td>
                  <strong>Pillar 4: Delivery (Value Realization)</strong><br>
                  <span style="color:var(--sol-green)">Prove value, not activity.</span>
                </td>
                <td>"Did this create value in the real world, and how do we know?"</td>
                <td>
                  Shipped &ne; delivered &bull; Value = adoption + outcomes &bull; External Roadmap = Delivery's Trust Artifact &bull; Field-facing truth must match product reality &bull; Delivery produces value signal that becomes new Discovery truth
                </td>
                <td><span class="cite-tag">FOXTROT-CHARLIE.md:286-330</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- FIVE OPERATING INVARIANTS & FAILURE MODES: 100% VERBATIM FROM FOXTROT-CHARLIE.MD -->
        <div style="overflow-x:auto">
          <table class="tui-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Foxtrot Charlie Operating Invariants (Verbatim)</th>
                <th>Failure Modes &amp; Self-Correction (Verbatim)</th>
                <th>Citation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>1</strong></td>
                <td><strong>Every initiative has a single accountable owner.</strong> No shared ownership. No rotating responsibility.</td>
                <td rowspan="5" style="vertical-align:middle">
                  When execution degrades, Foxtrot Charlie assumes <strong>one of three failures</strong>:<br><br>
                  &bull; <strong>Truth is missing</strong> &rarr; return to Discovery.<br>
                  &bull; <strong>Clarity is broken</strong> &rarr; rewrite commitments.<br>
                  &bull; <strong>Throughput is stalled</strong> &rarr; reduce batch size and ship.<br><br>
                  No new process is added. No ceremonies are created. The system tightens around reality.
                </td>
                <td rowspan="5" style="vertical-align:middle">
                  <span class="cite-tag">FOXTROT-CHARLIE.md:98-120</span><br><br>
                  <span class="cite-tag">FOXTROT-CHARLIE.md:334-346</span>
                </td>
              </tr>
              <tr>
                <td><strong>2</strong></td>
                <td><strong>Reality is expressed as state, not narrative.</strong> If it cannot be pointed to, it does not exist.</td>
              </tr>
              <tr>
                <td><strong>3</strong></td>
                <td><strong>All commitments exist as written artifacts.</strong> If it is not written, it is not committed.</td>
              </tr>
              <tr>
                <td><strong>4</strong></td>
                <td><strong>Shipping happens frequently enough to surface truth.</strong> Long cycles hide error. Short cycles reveal it.</td>
              </tr>
              <tr>
                <td><strong>5</strong></td>
                <td><strong>Value is measured in adoption or outcome, not effort.</strong> Activity without impact is noise.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- FORTHCOMING ESSAY NOTE: ABSORB AND CASCADE -->
      <div class="tui-box" style="padding:1rem 1.25rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.75rem;border-color:var(--sol-yellow)">
        <div>
          <span class="tui-kicker" style="color:var(--sol-yellow)">FORTHCOMING ARTICLE</span>
          <div style="font-size:0.95rem;font-weight:700;margin-top:0.15rem">
            "Absorb and Cascade" — Running Foxtrot Charlie at WISEcode and in Personal Initiatives
          </div>
        </div>
        <button type="button" class="tui-btn" onclick="window.switchGwrkView('foxtrot')">
          Read Foxtrot Charlie &rarr;
        </button>
      </div>

      <!-- REFERENCE ARCHITECTURE: VERBATIM HEXAGONAL-FUNCTIONAL (ADR-011, ADR-013) & AUTH BOUNDARY (ADR-014) -->
      <div class="tui-box">
        <div class="section-header">
          <span>REFERENCE ARCHITECTURE // HEXAGONAL-FUNCTIONAL &amp; FROZEN PORTS</span>
          <span class="cite-tag">[.gwrk/architecture.md &bull; ADR-011 &bull; ADR-013 &bull; ADR-014]</span>
        </div>
        <div class="section-body" style="display:flex;flex-direction:column;gap:1rem;overflow-x:auto">
          <div class="loop-svg-wrap" role="img" aria-label="Hexagonal-Functional Architecture Dependency Diagram: Adapters depend inward on Application and Ports; Application depends inward on Ports and Domain; Ports depend inward on Domain; Domain has zero external imports.">
            <svg class="loop-svg" viewBox="0 0 980 185" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="hex-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#2aa198"/>
                </marker>
              </defs>
              <!-- Layer 4: Adapters -->
              <rect x="20" y="25" width="210" height="135" rx="6" fill="#073642" stroke="#b58900" stroke-width="2"/>
              <text x="35" y="52" fill="#b58900" font-size="11" font-weight="800">LAYER 4 // ADAPTERS</text>
              <text x="35" y="74" fill="#fdf6e3" font-size="14" font-weight="800">src/adapters/</text>
              <text x="35" y="96" fill="#93a1a1" font-size="11">Implements effects:</text>
              <text x="35" y="113" fill="#93a1a1" font-size="11">cli, server, sqlite, git,</text>
              <text x="35" y="130" fill="#93a1a1" font-size="11">agents, auth, toolchain</text>
              <text x="35" y="148" fill="#2aa198" font-size="10">[ADR-011 §2.1.4]</text>

              <line x1="230" y1="92" x2="262" y2="92" stroke="#2aa198" stroke-width="2.5" marker-end="url(#hex-arrow)"/>

              <!-- Layer 3: Application -->
              <rect x="270" y="25" width="210" height="135" rx="6" fill="#073642" stroke="#268bd2" stroke-width="2"/>
              <text x="285" y="52" fill="#268bd2" font-size="11" font-weight="800">LAYER 3 // APPLICATION</text>
              <text x="285" y="74" fill="#fdf6e3" font-size="14" font-weight="800">src/application/</text>
              <text x="285" y="96" fill="#93a1a1" font-size="11">Orchestrators &amp; use-case</text>
              <text x="285" y="113" fill="#93a1a1" font-size="11">services importing only</text>
              <text x="285" y="130" fill="#93a1a1" font-size="11">from domain/ and ports/</text>
              <text x="285" y="148" fill="#2aa198" font-size="10">[ADR-011 §2.1.3]</text>

              <line x1="480" y1="92" x2="512" y2="92" stroke="#2aa198" stroke-width="2.5" marker-end="url(#hex-arrow)"/>

              <!-- Layer 2: Ports -->
              <rect x="520" y="25" width="210" height="135" rx="6" fill="#073642" stroke="#2aa198" stroke-width="2"/>
              <text x="535" y="52" fill="#2aa198" font-size="11" font-weight="800">LAYER 2 // PORTS</text>
              <text x="535" y="74" fill="#fdf6e3" font-size="14" font-weight="800">src/ports/</text>
              <text x="535" y="96" fill="#93a1a1" font-size="11">Inbound &amp; outbound port</text>
              <text x="535" y="113" fill="#93a1a1" font-size="11">interfaces importing</text>
              <text x="535" y="130" fill="#93a1a1" font-size="11">only from src/domain/</text>
              <text x="535" y="148" fill="#2aa198" font-size="10">[ADR-011 §2.1.2]</text>

              <line x1="730" y1="92" x2="762" y2="92" stroke="#2aa198" stroke-width="2.5" marker-end="url(#hex-arrow)"/>

              <!-- Layer 1: Domain -->
              <rect x="770" y="25" width="190" height="135" rx="6" fill="#073642" stroke="#ff2a85" stroke-width="2.5"/>
              <text x="785" y="52" fill="#ff2a85" font-size="11" font-weight="800">LAYER 1 // DOMAIN</text>
              <text x="785" y="74" fill="#fdf6e3" font-size="14" font-weight="800">src/domain/</text>
              <text x="785" y="96" fill="#93a1a1" font-size="11">Pure domain types,</text>
              <text x="785" y="113" fill="#93a1a1" font-size="11">parsers, and solvers.</text>
              <text x="785" y="130" fill="#fdf6e3" font-size="11" font-weight="700">Zero external effects.</text>
              <text x="785" y="148" fill="#2aa198" font-size="10">[ADR-011 §2.1.1]</text>
            </svg>
          </div>

          <table class="tui-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Hexagonal-Functional Target Rules (Verbatim)</th>
                <th>Citation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>2.1</strong></td>
                <td>Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.</td>
                <td><span class="cite-tag">.gwrk/architecture.md:15 &bull; ADR-013 §2.1</span></td>
              </tr>
              <tr>
                <td><strong>2.2</strong></td>
                <td>Domain code MUST NOT access external state. Isolate filesystem and network effects in adapters. Pass environment and clock values as inputs.</td>
                <td><span class="cite-tag">.gwrk/architecture.md:17 &bull; ADR-013 §2.2</span></td>
              </tr>
              <tr>
                <td><strong>2.3</strong></td>
                <td>Core operations MUST return explicit results without hidden mutable state. Equal inputs produce equal outputs. Test domain laws.</td>
                <td><span class="cite-tag">.gwrk/architecture.md:18 &bull; ADR-013 §2.3</span></td>
              </tr>
              <tr>
                <td><strong>2.4</strong></td>
                <td>Functions MUST separate policy from effects. Use one domain term per concept. Identify duplicate work and explicit error paths.</td>
                <td><span class="cite-tag">.gwrk/architecture.md:19 &bull; ADR-013 §2.4</span></td>
              </tr>
              <tr>
                <td><strong>2.5</strong></td>
                <td>Implementation MUST follow observed RED tests with GREEN execution evidence. Passing checks do not erase uncovered design defects.</td>
                <td><span class="cite-tag">.gwrk/architecture.md:20 &bull; ADR-013 §2.5</span></td>
              </tr>
            </tbody>
          </table>

          <table class="tui-table">
            <thead>
              <tr>
                <th>Frozen Port Interface (Verbatim)</th>
                <th>Responsibility (Verbatim)</th>
                <th>Adapter Boundary (Verbatim)</th>
                <th>Citation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>GoogleIdentityVerifierPort</code></td>
                <td>Verify RS256 Google ID tokens via JWKS and live allowlist</td>
                <td><code>src/adapters/auth/google-id-token.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:34</span></td>
              </tr>
              <tr>
                <td><code>CredentialCryptoPort</code></td>
                <td>Generate 32-byte secrets and compare SHA-256 verifiers in constant time</td>
                <td><code>src/adapters/auth/credential-crypto.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:35</span></td>
              </tr>
              <tr>
                <td><code>AuthStorePort</code></td>
                <td>Persist API credential verifiers, session digests and audit events</td>
                <td><code>src/adapters/sqlite/auth-store.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:36</span></td>
              </tr>
              <tr>
                <td><code>CredentialGrantAdminPort</code></td>
                <td>Atomically create or rotate credentials with project role bindings</td>
                <td><code>src/adapters/sqlite/auth-store.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:37</span></td>
              </tr>
              <tr>
                <td><code>BrowserCsrfPort</code></td>
                <td>Issue and verify session-bound browser CSRF tokens</td>
                <td><code>src/adapters/auth/browser-csrf.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:38</span></td>
              </tr>
              <tr>
                <td><code>ProxySessionLogoutPort</code></td>
                <td>Clear proxy cookies after origin digest revocation</td>
                <td><code>src/adapters/auth/proxy-logout.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:39</span></td>
              </tr>
              <tr>
                <td><code>HttpClientCredentialPort</code></td>
                <td>Attach origin-bound HTTPS credentials on remote CLI probes</td>
                <td><code>src/adapters/auth/http-client-credential.ts</code></td>
                <td><span class="cite-tag">ADR-014 §2.2:40</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- =====================================================================
         VIEW 2: FOXTROT CHARLIE (VERBATIM PUBLIC ARTICLE)
         ===================================================================== -->
    <section class="view-panel" id="view-foxtrot" data-view-panel="foxtrot" aria-label="Foxtrot Charlie Article">
      <div class="tui-box tui-box--flamingo">
        <div class="section-header">
          <span>DOCS/PRODUCT/FOXTROT-CHARLIE.MD // VERBATIM PUBLIC ARTICLE</span>
          <button type="button" class="tui-btn tui-btn--cyan" onclick="window.switchGwrkView('guides')">Sphinx Guides &rarr;</button>
        </div>
        <div class="section-body">
          <div class="fc-article-container">
            {foxtrot_charlie_html}
          </div>
        </div>
      </div>
    </section>

    <!-- =====================================================================
         VIEW 3: PUBLIC SPHINX GUIDES
         ===================================================================== -->
    <section class="view-panel" id="view-guides" data-view-panel="guides" aria-label="Sphinx Documentation Guides">
      <div class="tui-box tui-box--cyan">
        <div class="section-header">
          <span>SPHINX DOCUMENTATION // BUILT WITH SPHINX 9.1.1 &amp; MYST-PARSER</span>
          <button type="button" class="tui-btn" onclick="window.switchGwrkView('api')">OpenAPI 3.1 &rarr;</button>
        </div>
        <div class="guides-layout">
          <aside class="guides-sidebar" aria-label="Sphinx Table of Contents">
            <div class="guides-sidebar__title">toctree // guides</div>
            {"".join(guide_nav_buttons)}
          </aside>
          <div class="guides-content">
            {"".join(guide_panels)}
          </div>
        </div>
      </div>
    </section>

    <!-- =====================================================================
         VIEW 4: PUBLIC OPENAPI 3.1 SPECIFICATION
         ===================================================================== -->
    <section class="view-panel" id="view-api" data-view-panel="api" aria-label="OpenAPI 3.1 Specification">
      <div class="tui-box tui-box--flamingo">
        <div class="section-header">
          <span>OPENAPI 3.1.0 // DOCS/OPENAPI/GWRK-OPENAPI.YAML</span>
          <span class="tui-badge tui-badge--cyan">ADR-014</span>
        </div>
        <div class="oa-container">
          {"".join(api_cards)}
          <div class="oa-subhead" style="margin-top:0.5rem">COMPONENT SCHEMAS (OPENAPI 3.1)</div>
          {"".join(schemas_html)}
          <details class="oa-schema">
            <summary class="oa-schema__summary"><code>Raw OpenAPI 3.1 YAML (docs/openapi/gwrk-openapi.yaml)</code></summary>
            <pre class="oa-schema__pre"><code>{openapi_yaml_raw}</code></pre>
          </details>
        </div>
      </div>
    </section>

    <!-- =====================================================================
         VIEW 5: SIGNED-IN SESSION LANDING PAGE
         ===================================================================== -->
    <section class="view-panel" id="view-session" data-view-panel="session" aria-label="Signed-In Session">
      <div class="tui-box tui-box--cyan">
        <div class="section-header">
          <span>SIGNED-IN SESSION // GOOGLE OIDC &amp; ORIGIN-FIRST LOGOUT</span>
          <span class="tui-badge tui-badge--green" id="portal-auth-badge">SESSION</span>
        </div>
        <div class="console-grid">
          <div class="console-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
              <strong>1. Google Session (<code>GET /api/auth/session</code>)</strong>
              <button type="button" class="tui-btn tui-btn--cyan" id="probe-session-btn">Refresh Session</button>
            </div>
            <pre class="console-pre" id="session-json-out">Checking /api/auth/session...</pre>
          </div>

          <div class="console-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
              <strong>2. Origin-First Logout (<code>POST /api/auth/logout</code>)</strong>
              <button type="button" class="tui-btn" id="portal-logout-btn" disabled>Sign Out</button>
            </div>
            <pre class="console-pre" id="logout-json-out">Ready.</pre>
          </div>
        </div>
      </div>
    </section>
  </div>

  <!-- =======================================================================
       CLEAN GFORGE.AI STATUSLINE (Exact 3+3 WebTUI structure from gforge.ai)
       Left:  guest@gwrk | ~/home.ts | main
       Right: utf-8 | 1:1 | dark
       ======================================================================= -->
  <footer class="home-hero__statusbar" aria-label="Statusline">
    <span class="home-hero__status-left">
      <span class="home-hero__status-text" id="statusline-user">guest@gwrk</span>
      <span aria-hidden="true" class="home-hero__status-sep">|</span>
      <span class="home-hero__status-text" id="statusline-file">~/home.ts</span>
      <span aria-hidden="true" class="home-hero__status-sep">|</span>
      <span class="home-hero__status-branch">main</span>
    </span>
    <span class="home-hero__status-right">
      <span class="home-hero__status-meta">utf-8</span>
      <span aria-hidden="true" class="home-hero__status-sep">|</span>
      <span class="home-hero__status-meta">1:1</span>
      <span aria-hidden="true" class="home-hero__status-sep">|</span>
      <span class="home-hero__status-mode" id="statusline-mode" aria-live="polite">dark</span>
    </span>
  </footer>

  <script>
    (function () {{
      var csrfToken = null;
      var splashCurtain = document.getElementById("splash-curtain");
      var splashEnterBtn = document.getElementById("splash-enter-btn");
      var replaySplashBtn = document.getElementById("replay-splash-btn");
      var replaySplashIcon = document.getElementById("replay-splash-icon");
      var brandHomeLink = document.getElementById("brand-home-link");
      var viewButtons = document.querySelectorAll("[data-view-btn]");
      var viewPanels = document.querySelectorAll("[data-view-panel]");
      var guideButtons = document.querySelectorAll("[data-guide-btn]");
      var guidePanels = document.querySelectorAll("[data-guide-panel]");
      var statusFile = document.getElementById("statusline-file");
      var statusUser = document.getElementById("statusline-user");
      var statusMode = document.getElementById("statusline-mode");

      function switchView(viewName, updateHash) {{
        viewButtons.forEach(function (btn) {{
          btn.setAttribute("data-active", btn.getAttribute("data-view-btn") === viewName ? "true" : "false");
        }});
        viewPanels.forEach(function (panel) {{
          panel.setAttribute("data-active", panel.getAttribute("data-view-panel") === viewName ? "true" : "false");
        }});
        if (statusFile) {{
          var map = {{
            home: "~/home.ts",
            foxtrot: "~/docs/foxtrot-charlie.md",
            guides: "~/docs/guides.md",
            api: "~/docs/openapi.yaml",
            session: "~/api/auth/session.ts"
          }};
          statusFile.textContent = map[viewName] || "~/home.ts";
        }}
        if (updateHash !== false && history.replaceState) {{
          history.replaceState(null, "", "#" + viewName);
        }}
        window.scrollTo({{ top: 0, behavior: "smooth" }});
      }}
      window.switchGwrkView = switchView;

      function enterFromSplash() {{
        if (!splashCurtain) return;
        splashCurtain.setAttribute("data-dismissed", "true");
        switchView("home", true);
      }}

      function showSplash() {{
        if (!splashCurtain) return;
        splashCurtain.setAttribute("data-dismissed", "false");
        if (history.replaceState) {{
          history.replaceState(null, "", window.location.pathname);
        }}
        if (splashEnterBtn) splashEnterBtn.focus();
      }}

      if (splashCurtain) {{
        splashCurtain.addEventListener("click", enterFromSplash);
      }}
      if (splashEnterBtn) {{
        splashEnterBtn.addEventListener("click", function (ev) {{
          ev.stopPropagation();
          enterFromSplash();
        }});
      }}
      if (replaySplashBtn) {{
        replaySplashBtn.addEventListener("click", showSplash);
      }}
      if (replaySplashIcon) {{
        replaySplashIcon.addEventListener("click", showSplash);
      }}
      if (brandHomeLink) {{
        brandHomeLink.addEventListener("click", function (ev) {{
          ev.preventDefault();
          switchView("home", true);
        }});
      }}

      document.addEventListener("keydown", function (ev) {{
        if (splashCurtain && splashCurtain.getAttribute("data-dismissed") !== "true") {{
          if (ev.key === "Enter" || ev.key === " ") {{
            ev.preventDefault();
            enterFromSplash();
          }}
        }}
      }});

      function switchGuide(slug) {{
        guideButtons.forEach(function (btn) {{
          btn.setAttribute("data-active", btn.getAttribute("data-guide-btn") === slug ? "true" : "false");
        }});
        guidePanels.forEach(function (panel) {{
          panel.setAttribute("data-active", panel.getAttribute("data-guide-panel") === slug ? "true" : "false");
        }});
      }}

      viewButtons.forEach(function (btn) {{
        btn.addEventListener("click", function () {{
          switchView(btn.getAttribute("data-view-btn"), true);
        }});
      }});

      guideButtons.forEach(function (btn) {{
        btn.addEventListener("click", function () {{
          switchGuide(btn.getAttribute("data-guide-btn"));
        }});
      }});

      document.addEventListener("click", function (ev) {{
        var target = ev.target.closest("[data-guide-target]");
        if (target) {{
          ev.preventDefault();
          switchView("guides", true);
          switchGuide(target.getAttribute("data-guide-target"));
        }}
      }});

      // Two-state Solarized theme toggle matching gforge.ai
      var metaScheme = document.querySelector('meta[name="color-scheme"]');
      var themeBtn = document.getElementById("theme-toggle");
      var mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

      function currentResolvedScheme() {{
        var content = metaScheme ? metaScheme.content : "light dark";
        if (content === "dark" || content === "light") return content;
        return mql && mql.matches ? "dark" : "light";
      }}

      function updateThemeLabels() {{
        var cur = currentResolvedScheme();
        var next = cur === "dark" ? "LIGHT" : "DARK";
        if (themeBtn) themeBtn.textContent = next;
        if (statusMode) statusMode.textContent = cur;
      }}

      if (themeBtn && metaScheme) {{
        themeBtn.addEventListener("click", function () {{
          var sys = mql && mql.matches ? "dark" : "light";
          var target = currentResolvedScheme() === "dark" ? "light" : "dark";
          if (target === sys) {{
            try {{ localStorage.removeItem("color-scheme"); }} catch (e) {{}}
            metaScheme.content = "light dark";
          }} else {{
            try {{ localStorage.setItem("color-scheme", target); }} catch (e) {{}}
            metaScheme.content = target;
          }}
          updateThemeLabels();
        }});
      }}
      if (mql && mql.addEventListener) {{
        mql.addEventListener("change", updateThemeLabels);
      }}
      updateThemeLabels();

      // URL Hash routing:
      // - Bare `/` (no hash): ALWAYS shows the full-screen Splash (`[Hit Enter]`).
      // - `#home`, `#foxtrot`, `#guides`, `#api`, `#session`: opens that view directly.
      var initialHash = (window.location.hash || "").replace(/^#/, "");
      var explicitHash = false;
      if (["home", "foxtrot", "guides", "api", "session"].indexOf(initialHash) !== -1) {{
        explicitHash = true;
        if (splashCurtain) splashCurtain.setAttribute("data-dismissed", "true");
        switchView(initialHash, false);
      }} else if (initialHash.indexOf("guide-") === 0) {{
        explicitHash = true;
        if (splashCurtain) splashCurtain.setAttribute("data-dismissed", "true");
        switchView("guides", false);
        switchGuide(initialHash.replace("guide-", ""));
      }}

      // Check `/api/auth/session`: if authenticated (e.g. returning from Google OAuth callback to `/`),
      // dismiss splash and show signed-in session state.
      var headerSignin = document.getElementById("header-signin-link");
      var heroSignin = document.getElementById("hero-signin-link");
      var navSessionTab = document.getElementById("nav-session-tab");
      var portalLogoutBtn = document.getElementById("portal-logout-btn");
      var portalAuthBadge = document.getElementById("portal-auth-badge");
      var sessionOut = document.getElementById("session-json-out");
      var logoutOut = document.getElementById("logout-json-out");

      var logoutInFlight = false;

      function applyAuthenticatedUi(token) {{
        csrfToken = token || null;
        if (navSessionTab) navSessionTab.style.display = "inline-flex";
        if (portalAuthBadge) portalAuthBadge.textContent = "AUTHENTICATED";
        if (portalLogoutBtn) portalLogoutBtn.disabled = false;
        if (statusUser) statusUser.textContent = "operator@gwrk";
        if (headerSignin) {{
          headerSignin.textContent = "Session";
          headerSignin.setAttribute("href", "#session");
          headerSignin.onclick = function (e) {{
            e.preventDefault();
            switchView("session", true);
          }};
        }}
        if (heroSignin) {{
          heroSignin.textContent = "Open Session";
          heroSignin.setAttribute("href", "#session");
          heroSignin.onclick = function (e) {{
            e.preventDefault();
            switchView("session", true);
          }};
        }}
      }}

      function clearAuthenticatedUi(switchToHome) {{
        csrfToken = null;
        if (navSessionTab) navSessionTab.style.display = "none";
        if (portalAuthBadge) portalAuthBadge.textContent = "UNAUTHENTICATED";
        if (portalLogoutBtn) portalLogoutBtn.disabled = true;
        if (statusUser) statusUser.textContent = "guest@gwrk";
        if (headerSignin) {{
          headerSignin.textContent = "Sign in with Google";
          headerSignin.setAttribute("href", "/oauth2/start");
          headerSignin.onclick = null;
        }}
        if (heroSignin) {{
          heroSignin.textContent = "Sign in with Google";
          heroSignin.setAttribute("href", "/oauth2/start");
          heroSignin.onclick = null;
        }}
        if (switchToHome) {{
          switchView("home", true);
        }}
      }}

      function readResponseBody(res) {{
        if (typeof res.text === "function") {{
          return res.text().then(function (raw) {{
            var data = null;
            if (raw) {{
              try {{
                data = JSON.parse(raw);
              }} catch (e) {{
                data = null;
              }}
            }}
            return {{ status: res.status, data: data, raw: raw }};
          }});
        }}
        return res.json().then(function (data) {{
          return {{ status: res.status, data: data, raw: JSON.stringify(data) }};
        }}).catch(function () {{
          return {{ status: res.status, data: null, raw: "" }};
        }});
      }}

      function formatResultBody(result) {{
        if (result.data !== null) {{
          return JSON.stringify(result.data, null, 2);
        }}
        return result.raw || "(empty response)";
      }}

      function checkSession(autoEnterIfLoggedIn) {{
        fetch("/api/auth/session", {{
          method: "GET",
          credentials: "same-origin",
          headers: {{ "Accept": "application/json" }}
        }}).then(readResponseBody).then(function (result) {{
          if (sessionOut) {{
            sessionOut.textContent = "HTTP " + result.status + "\\n" + formatResultBody(result);
          }}
          if (result.status === 200 && result.data && result.data.ok) {{
            applyAuthenticatedUi(result.data.csrfToken);
            if (autoEnterIfLoggedIn && !explicitHash) {{
              if (splashCurtain) splashCurtain.setAttribute("data-dismissed", "true");
              switchView("guides", true);
            }}
          }} else if (!autoEnterIfLoggedIn) {{
            clearAuthenticatedUi(false);
          }} else {{
            if (portalAuthBadge) portalAuthBadge.textContent = "UNAUTHENTICATED";
          }}
        }}).catch(function () {{}});
      }}

      function performLogout() {{
        if (!csrfToken || logoutInFlight) return;
        logoutInFlight = true;
        if (portalLogoutBtn) portalLogoutBtn.disabled = true;
        if (logoutOut) logoutOut.textContent = "Signing out...";
        fetch("/api/auth/logout", {{
          method: "POST",
          credentials: "same-origin",
          headers: {{
            "X-Gwrk-Csrf-Token": csrfToken
          }}
        }}).then(readResponseBody).then(function (result) {{
          var bodyText = formatResultBody(result);
          if (result.status === 200 && result.data && result.data.ok === true && result.data.proxyCleared !== false) {{
            if (logoutOut) {{
              logoutOut.textContent = "HTTP " + result.status + "\\n" + bodyText;
            }}
            clearAuthenticatedUi(true);
            return;
          }}
          if (result.status === 401) {{
            return fetch("/api/auth/session", {{
              method: "GET",
              credentials: "same-origin",
              headers: {{ "Accept": "application/json" }}
            }}).then(readResponseBody).then(function (sess) {{
              if (sessionOut) {{
                sessionOut.textContent = "HTTP " + sess.status + "\\n" + formatResultBody(sess);
              }}
              if (sess.status === 401) {{
                if (logoutOut) {{
                  logoutOut.textContent = "HTTP " + result.status + " (session confirmed inactive)\\n" + bodyText;
                }}
                clearAuthenticatedUi(true);
              }} else if (sess.status === 200 && sess.data && sess.data.ok) {{
                applyAuthenticatedUi(sess.data.csrfToken || csrfToken);
                if (logoutOut) {{
                  logoutOut.textContent = "Logout failed (HTTP " + result.status + "). Session remains active; please retry.\\n" + bodyText;
                }}
              }} else {{
                if (portalLogoutBtn) portalLogoutBtn.disabled = false;
                if (logoutOut) {{
                  logoutOut.textContent = "Logout failed (HTTP " + result.status + "). Session check returned HTTP " + sess.status + "; please retry.\\n" + bodyText;
                }}
              }}
            }}).catch(function (err) {{
              if (portalLogoutBtn) portalLogoutBtn.disabled = false;
              if (logoutOut) {{
                logoutOut.textContent = "Logout failed (HTTP " + result.status + "). Could not verify session (" + (err && err.message ? err.message : "network error") + "); please retry.";
              }}
            }});
          }}
          if (portalLogoutBtn) portalLogoutBtn.disabled = false;
          if (logoutOut) {{
            logoutOut.textContent = "Logout failed (HTTP " + result.status + "). Session remains active; please retry.\\n" + bodyText;
          }}
        }}).catch(function (err) {{
          if (portalLogoutBtn) portalLogoutBtn.disabled = false;
          if (logoutOut) {{
            logoutOut.textContent = "Logout failed (" + (err && err.message ? err.message : "network error") + "). Session remains active; please retry.";
          }}
        }}).then(function () {{
          logoutInFlight = false;
        }});
      }}

      var probeBtn = document.getElementById("probe-session-btn");
      if (probeBtn) {{
        probeBtn.addEventListener("click", function () {{
          checkSession(false);
        }});
      }}
      if (portalLogoutBtn) {{
        portalLogoutBtn.addEventListener("click", performLogout);
      }}

      checkSession(true);
    }})();
  </script>
</body>
</html>"""

    secret_match = re.search(r"CANARY|gwrk_v1\.", html_doc)
    if secret_match:
        raise RuntimeError(f"Secret or canary token remained in HTML: {secret_match.group(0)}")
    if 'href="/oauth2/start"' not in html_doc:
        raise RuntimeError('Missing required href="/oauth2/start" in HTML')
    if "projectId" not in html_doc:
        raise RuntimeError("Missing required API wire identifier projectId in HTML")

    STATIC_PREVIEW_OUT.write_text(html_doc, encoding="utf-8")

    ts_content = (
        "/* This Source Code Form is subject to the terms of the Mozilla Public\n"
        " * License, v. 2.0. If a copy of the MPL was not distributed with this\n"
        " * file, You can obtain one at https://mozilla.org/MPL/2.0/. */\n\n"
        f"export const LOGIN_ENTRY = {json.dumps(html_doc)};\n"
    )
    PORTAL_TS_OUT.write_text(ts_content, encoding="utf-8")
    print(f"Generated {PORTAL_TS_OUT} ({len(html_doc)} bytes HTML)")


if __name__ == "__main__":
    main()
