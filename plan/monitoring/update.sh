#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
INSTALL_DIR="$SCRIPT_DIR"
SOURCE_METADATA="$SCRIPT_DIR/.install-source"

warn() {
	printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2
}

strip_metadata_value() {
	local value="$1"
	local single_quote="'"
	local escaped_single="\\'"

	value="${value#"${value%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"

	if [[ "$value" == \"*\" && "$value" == *\" ]]; then
		value="${value:1:${#value}-2}"
		value="${value//\\\"/\"}"
		value="${value//\\\\/\\}"
	elif [[ "${value:0:1}" == "$single_quote" && "${value: -1}" == "$single_quote" ]]; then
		value="${value:1:${#value}-2}"
		value="${value//$escaped_single/$single_quote}"
	fi

	printf '%s' "$value"
}

get_metadata_value() {
	local key="$1"
	local file="$2"
	local line value

	[[ -f "$file" ]] || return 0

	line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
	[[ -n "$line" ]] || return 0

	value="${line#*=}"
	strip_metadata_value "$value"
}

SOURCE_DIR="$(get_metadata_value SOURCE_DIR "$SOURCE_METADATA")"

if [[ -n "$SOURCE_DIR" && "$SOURCE_DIR" != "$SCRIPT_DIR" && -f "$SOURCE_DIR/install.sh" ]]; then
	if command -v git >/dev/null 2>&1 && git -C "$SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		git -C "$SOURCE_DIR" pull --ff-only || warn "Không git pull được source $SOURCE_DIR. Tiếp tục dùng source hiện có."
	fi

	exec bash "$SOURCE_DIR/install.sh" --update --install-dir "$INSTALL_DIR" "$@"
fi

exec bash "$SCRIPT_DIR/install.sh" --update "$@"