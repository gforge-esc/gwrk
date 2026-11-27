# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

project = "gwrk"
copyright = "2026, David Gonzo Gonzalez (gforge.ai)"
author = "David Gonzo Gonzalez"
release = "1.6.0-beta.3"

extensions = [
    "myst_parser",
]

myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "fieldlist",
    "tasklist",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "alabaster"
html_title = "gwrk 1.6.0-beta.3 — Consumer, Operator & Architecture Guides"
html_static_path = ["_static"]
html_css_files = ["solarized-tui.css"]

html_theme_options = {
    "description": "You better gwrk! Truth -> Clarity -> Throughput -> Value.",
    "fixed_sidebar": True,
    "page_width": "1160px",
    "sidebar_width": "260px",
    "show_powered_by": False,
}
