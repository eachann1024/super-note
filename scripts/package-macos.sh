#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA_DIR="${ROOT_DIR}/.build/Package"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/output}"
APP_NAME="GooseNotes"
APP_OUTPUT="${OUTPUT_DIR}/${APP_NAME}.app"
ZIP_OUTPUT="${OUTPUT_DIR}/${APP_NAME}-macOS-universal.zip"

cd "${ROOT_DIR}"

command -v bun >/dev/null || { echo "缺少 bun，请先安装 bun。" >&2; exit 1; }
command -v xcodegen >/dev/null || { echo "缺少 xcodegen，请先运行 brew install xcodegen。" >&2; exit 1; }

bun run project

xcodebuild \
  -project GooseNotes.xcodeproj \
  -scheme GooseNotes \
  -configuration Release \
  -derivedDataPath "${DERIVED_DATA_DIR}" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_IDENTITY=- \
  build

SOURCE_APP="${DERIVED_DATA_DIR}/Build/Products/Release/${APP_NAME}.app"
mkdir -p "${OUTPUT_DIR}"
rm -rf "${APP_OUTPUT}"
rm -f "${ZIP_OUTPUT}"
ditto "${SOURCE_APP}" "${APP_OUTPUT}"

codesign \
  --force \
  --deep \
  --sign - \
  --options runtime \
  --timestamp=none \
  --entitlements "${ROOT_DIR}/GooseNotes/GooseNotes.entitlements" \
  "${APP_OUTPUT}"
codesign --verify --deep --strict "${APP_OUTPUT}"
lipo -archs "${APP_OUTPUT}/Contents/MacOS/${APP_NAME}"
/usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes:0:LSItemContentTypes:0" "${APP_OUTPUT}/Contents/Info.plist"

ditto -c -k --sequesterRsrc --keepParent "${APP_OUTPUT}" "${ZIP_OUTPUT}"

echo "应用：${APP_OUTPUT}"
echo "压缩包：${ZIP_OUTPUT}"
shasum -a 256 "${ZIP_OUTPUT}"
