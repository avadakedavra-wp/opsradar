#!/usr/bin/env bash
# install.sh — OpsRadar one-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/iamkiwi-dev/opsradar/main/scripts/install.sh | bash
#
# Or with a specific version:
#   curl -fsSL https://raw.githubusercontent.com/iamkiwi-dev/opsradar/main/scripts/install.sh | bash -s -- --version v1.2.0

set -euo pipefail

REPO="iamkiwi-dev/opsradar"
INSTALL_DIR="${OPSRADAR_INSTALL_DIR:-${HOME}/.opsradar}"
BIN_DIR="${OPSRADAR_BIN_DIR:-${HOME}/.local/bin}"

# ── Colours ───────────────────────────────────────────────────────────────────
_green()  { printf "\033[32m%s\033[0m\n" "$*"; }
_yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
_red()    { printf "\033[31m%s\033[0m\n" "$*"; }
_bold()   { printf "\033[1m%s\033[0m\n"  "$*"; }
_step()   { printf "\n\033[1m==> %s\033[0m\n" "$*"; }

# ── Args ──────────────────────────────────────────────────────────────────────
VERSION=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --version) VERSION="$2"; shift 2 ;;
    *) _yellow "Unknown arg: $1"; shift ;;
  esac
done

# ── Detect platform ───────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) GOOS="darwin" ;;
  Linux)  GOOS="linux"  ;;
  *)
    _red "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) GOARCH="amd64" ;;
  arm64|aarch64) GOARCH="arm64" ;;
  *)
    _red "Unsupported arch: $ARCH"
    exit 1
    ;;
esac

PLATFORM="${GOOS}-${GOARCH}"

# ── Fetch latest version if not specified ─────────────────────────────────────
_step "Fetching OpsRadar release info..."
if [ -z "$VERSION" ]; then
  if command -v curl &>/dev/null; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  elif command -v wget &>/dev/null; then
    VERSION=$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" \
      | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  else
    _red "curl or wget is required"
    exit 1
  fi
fi

if [ -z "$VERSION" ]; then
  _red "Could not determine latest version. Pass --version v1.x.x explicitly."
  exit 1
fi

_green "Installing OpsRadar ${VERSION} for ${PLATFORM}..."

# ── Download ──────────────────────────────────────────────────────────────────
TARBALL="opsradar-${VERSION}-${PLATFORM}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${TARBALL}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

_step "Downloading ${TARBALL}..."
if command -v curl &>/dev/null; then
  curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/${TARBALL}"
else
  wget -qO "${TMP_DIR}/${TARBALL}" "$DOWNLOAD_URL"
fi

# ── Verify checksum ───────────────────────────────────────────────────────────
CHECKSUMS_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"
_step "Verifying checksum..."
if command -v curl &>/dev/null; then
  curl -fsSL "$CHECKSUMS_URL" -o "${TMP_DIR}/checksums.txt"
else
  wget -qO "${TMP_DIR}/checksums.txt" "$CHECKSUMS_URL"
fi

EXPECTED=$(grep "${TARBALL}" "${TMP_DIR}/checksums.txt" | awk '{print $1}')
if command -v sha256sum &>/dev/null; then
  ACTUAL=$(sha256sum "${TMP_DIR}/${TARBALL}" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
  ACTUAL=$(shasum -a 256 "${TMP_DIR}/${TARBALL}" | awk '{print $1}')
else
  _yellow "sha256sum not found — skipping checksum verification"
  ACTUAL="$EXPECTED"
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  _red "Checksum mismatch! Expected: $EXPECTED  Got: $ACTUAL"
  exit 1
fi
_green "Checksum OK"

# ── Install ───────────────────────────────────────────────────────────────────
_step "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

tar -xzf "${TMP_DIR}/${TARBALL}" -C "$TMP_DIR"
EXTRACT_DIR="${TMP_DIR}/opsradar-${VERSION}-${PLATFORM}"

# Binaries
install -m 755 "${EXTRACT_DIR}/bin/opsradar-api" "${INSTALL_DIR}/opsradar-api"
install -m 755 "${EXTRACT_DIR}/bin/opsradar"     "${BIN_DIR}/opsradar"

# Dashboard
DASHBOARD_DIR="${INSTALL_DIR}/dashboard"
mkdir -p "$DASHBOARD_DIR"
tar -xzf "${EXTRACT_DIR}/dashboard.tar.gz" -C "$DASHBOARD_DIR"

# Patch dashboard path into the CLI wrapper
sed -i.bak \
  "s|__DASHBOARD_DIR__|${DASHBOARD_DIR}|g; s|__VERSION__|${VERSION}|g" \
  "${BIN_DIR}/opsradar"
rm -f "${BIN_DIR}/opsradar.bak"

# Pre-install dashboard dependencies
_step "Installing dashboard dependencies (this may take a moment)..."
if command -v node &>/dev/null; then
  (cd "$DASHBOARD_DIR" && npm ci --prefer-offline --loglevel=error) \
    && _green "Dashboard deps ready." \
    || _yellow "npm ci failed — will retry on first opsradar start"
else
  _yellow "node not found — install Node.js 18+ before running opsradar start"
fi

# ── Shell PATH ────────────────────────────────────────────────────────────────
_step "Checking PATH..."
SHELL_RC=""
case "${SHELL:-bash}" in
  */zsh)  SHELL_RC="${HOME}/.zshrc" ;;
  */bash) SHELL_RC="${HOME}/.bashrc" ;;
esac

if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  if [ -n "$SHELL_RC" ]; then
    echo "" >> "$SHELL_RC"
    echo "# OpsRadar" >> "$SHELL_RC"
    echo "export PATH=\"\${PATH}:${BIN_DIR}\"" >> "$SHELL_RC"
    _yellow "Added ${BIN_DIR} to PATH in ${SHELL_RC}"
    _yellow "Run:  source ${SHELL_RC}   (or open a new terminal)"
  else
    _yellow "Add ${BIN_DIR} to your PATH manually."
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
_green "✅ OpsRadar ${VERSION} installed!"
echo ""
echo "  Start the app:"
_bold "    opsradar start"
echo ""
echo "  Then open:  http://localhost:6689"
echo ""
echo "  Optional: create ${HOME}/.opsradar/.env with:"
echo "    ANTHROPIC_API_KEY=..."
echo "    GITHUB_TOKEN=..."
echo "    GITHUB_REPO=owner/repo"
echo ""
