#!/usr/bin/env bash
set -euo pipefail

tauri_root="$(cd "$(dirname "$0")/../src-tauri" && pwd)"
output="$(mktemp -d)"
trap 'rm -rf "$output"' EXIT

xcrun actool --compile "$output" --platform macosx --minimum-deployment-target 10.13 \
  --app-icon AppIcon --output-partial-info-plist "$output/Info.plist" \
  "$tauri_root/icons/AppIcon.icon"
mkdir -p "$tauri_root/target/macos-icon"
cp "$output/Assets.car" "$tauri_root/target/macos-icon/Assets.car"
