#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"

DEFAULT_TARGETS=(
  "Firefox"
)

usage() {
  cat <<'EOF'
Usage: scripts/build-xpi.sh [extension_dir ...]

Build one or more extension directories into .xpi archives.

Examples:
  scripts/build-xpi.sh
  scripts/build-xpi.sh Firefox
  scripts/build-xpi.sh Firefox Chrome
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

read_manifest_value() {
  local manifest_path="$1"
  local key="$2"

  sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/p" "${manifest_path}" | head -n 1
}

build_xpi() {
  local target_input="$1"
  local target_dir
  local manifest_path
  local target_name
  local normalized_name
  local version
  local archive_name
  local archive_path

  if [[ "${target_input}" = /* ]]; then
    target_dir="${target_input}"
  else
    target_dir="${REPO_ROOT}/${target_input}"
  fi

  if [[ ! -d "${target_dir}" ]]; then
    echo "Skipping missing directory: ${target_input}" >&2
    return 1
  fi

  manifest_path="${target_dir}/manifest.json"
  if [[ ! -f "${manifest_path}" ]]; then
    echo "Skipping ${target_input}: no manifest.json found" >&2
    return 1
  fi

  target_name="$(basename "${target_dir}")"
  normalized_name="$(printf '%s' "${target_name}" | tr '[:upper:]' '[:lower:]')"
  version="$(read_manifest_value "${manifest_path}" "version")"
  if [[ -z "${version}" ]]; then
    version="unknown"
  fi

  archive_name="${normalized_name}-${version}.xpi"
  archive_path="${DIST_DIR}/${archive_name}"

  rm -f "${archive_path}"

  (
    cd "${target_dir}"
    zip -qr "${archive_path}" . \
      -x "*.DS_Store" \
      -x "__MACOSX/*" \
      -x "*.git*" \
      -x "dist/*"
  )

  echo "Built ${archive_path}"
}

main() {
  local targets=("$@")

  require_command "zip"
  mkdir -p "${DIST_DIR}"

  if [[ "${#targets[@]}" -eq 0 ]]; then
    targets=("${DEFAULT_TARGETS[@]}")
  fi

  for target in "${targets[@]}"; do
    build_xpi "${target}"
  done
}

if [[ "${1:-}" = "-h" || "${1:-}" = "--help" ]]; then
  usage
  exit 0
fi

main "$@"
