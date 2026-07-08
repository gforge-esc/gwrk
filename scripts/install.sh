#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# gwrk installer — downloads a release tarball from GitHub and installs it.
#
# Usage:
#   gh release download v0.1.0 -R gforge-esc/gwrk -p "gwrk-v*.tgz" -D /tmp && \
#     bash /path/to/install.sh /tmp/gwrk-v0.1.0.tgz
#
# Or, all-in-one:
#   GWRK_VERSION=v0.1.0 bash <(curl -fsSL https://raw.githubusercontent.com/gforge-esc/gwrk/main/scripts/install.sh)
#
# Prerequisites: node (>=18), pnpm, gh (authenticated to gforge-esc org)

set -euo pipefail

REPO="gforge-esc/gwrk"
INSTALL_DIR="${GWRK_HOME:-$HOME/.gwrk}"
BIN_DIR="$INSTALL_DIR/bin"

# ── Resolve version ──────────────────────────────────────────────────────────
VERSION="${GWRK_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  echo "→ No GWRK_VERSION set, resolving latest release..."
  VERSION=$(gh release view --repo "$REPO" --json tagName -q '.tagName' 2>/dev/null) || {
    echo "✗ Could not resolve latest release. Set GWRK_VERSION=vX.Y.Z or check gh auth." >&2
    exit 1
  }
  echo "  Latest: $VERSION"
fi

RELEASE_DIR="$INSTALL_DIR/releases/$VERSION"

# ── Pre-flight checks ────────────────────────────────────────────────────────
for cmd in node pnpm gh; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "✗ Required command '$cmd' not found. Please install it first." >&2
    exit 1
  }
done

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if (( NODE_MAJOR < 18 )); then
  echo "✗ Node.js >= 18 required (found v$(node -v))" >&2
  exit 1
fi

# ── Download ──────────────────────────────────────────────────────────────────
TARBALL_NAME="gwrk-${VERSION}.tgz"
TARBALL_ARG="${1:-}"

if [[ -n "$TARBALL_ARG" && -f "$TARBALL_ARG" ]]; then
  echo "→ Using provided tarball: $TARBALL_ARG"
  TARBALL="$TARBALL_ARG"
else
  TMPDIR_DL=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_DL"' EXIT
  echo "→ Downloading $TARBALL_NAME from $REPO..."
  gh release download "$VERSION" \
    --repo "$REPO" \
    --pattern "$TARBALL_NAME" \
    --dir "$TMPDIR_DL" || {
    echo "✗ Download failed. Check GWRK_VERSION and gh auth status." >&2
    exit 1
  }
  TARBALL="$TMPDIR_DL/$TARBALL_NAME"
fi

# ── Install ───────────────────────────────────────────────────────────────────
echo "→ Installing to $RELEASE_DIR..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

tar xzf "$TARBALL" -C "$RELEASE_DIR" --strip-components=1

cd "$RELEASE_DIR"
pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod
echo "→ Rebuilding native modules for $(uname -m)..."
pnpm rebuild better-sqlite3

# ── Symlink ───────────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
ln -sf "$RELEASE_DIR/dist/cli.js" "$BIN_DIR/gwrk"
chmod +x "$BIN_DIR/gwrk"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
if "$BIN_DIR/gwrk" --version >/dev/null 2>&1; then
  echo "✓ gwrk $VERSION installed successfully!"
else
  echo "⚠ Installed but gwrk --version failed. Check Node.js compatibility."
fi

# ── PATH hint ─────────────────────────────────────────────────────────────────
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo "  Add gwrk to your PATH:"
  echo ""
  echo "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
  echo "    source ~/.zshrc"
  echo ""
fi
