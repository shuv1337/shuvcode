#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
config="$HOME/.config/opencode/opencode.json"
preferences="$HOME/.config/shuvcode/opencode.json"
mode=${1:-deploy}

case "$mode" in
  deploy | --check) ;;
  *) echo "Usage: $0 [--check]" >&2; exit 1 ;;
esac

test -f "$preferences"
target_before=$(readlink -f "$config")
test "$target_before" = "$preferences"
hash_before=$(sha256sum "$target_before" | cut -d ' ' -f 1)

cd "$root"
test "$(git branch --show-current)" = "integration-v2"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/integration-v2)"
bun_bin=$(command -v bun || true)
if [[ -z "$bun_bin" && -x "$HOME/.bun/bin/bun" ]]; then
  bun_bin="$HOME/.bun/bin/bun"
fi
test -n "$bun_bin"
test "$("$bun_bin" --version)" = "1.3.14"

sha=$(git rev-parse HEAD)
if [[ "$mode" == "--check" ]]; then
  echo "ready=$sha"
  echo "config=$target_before"
  echo "config_sha256=$hash_before"
  exit 0
fi

case "$(uname -m)" in
  x86_64) target=shuvcode-linux-x64 ;;
  aarch64 | arm64) target=shuvcode-linux-arm64 ;;
  *) echo "Unsupported host architecture: $(uname -m)" >&2; exit 1 ;;
esac

cd packages/cli
"$bun_bin" run script/build.ts --single --skip-install
built="$PWD/dist/$target/bin/shuvcode"
destination="$HOME/.local/lib/shuvcode/$sha"
install -d -m 0755 "$destination"
install -m 0755 "$built" "$destination/shuvcode"

link="$HOME/.local/bin/.shuvcode.$sha"
trap 'rm -f "$link"' EXIT
ln -s "$destination/shuvcode" "$link"
mv -Tf "$link" "$HOME/.local/bin/shuvcode"
install -m 0644 "$root/deploy/systemd/shuvcode.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user restart shuvcode.service
systemctl --user is-active --quiet shuvcode.service

test "$(readlink -f "$config")" = "$target_before"
test "$(sha256sum "$target_before" | cut -d ' ' -f 1)" = "$hash_before"

echo "deployed=$sha"
echo "version=$("$HOME/.local/bin/shuvcode" --version)"
echo "config=$target_before"
echo "config_sha256=$hash_before"
