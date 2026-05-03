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

usage() {
	cat <<'EOF'
OmniRouter Monitoring updater

Usage:
  bash update.sh [options]

Common options:
  --reconfigure       Ask again for .env values.
  --no-start          Update files only, do not run Docker Compose.
  --skip-deps         Skip Docker dependency checks/installation.
  --help              Show this help.

Quick actions:
  --status            Show Docker Compose status.
  --logs [service]    Follow logs for all services or one service.
  --restart [service] Restart all services or one service.
  --metrics           Print a short OmniRouter exporter metric sample.
  --validate          Validate compose config, dashboard JSON and exporter syntax.
EOF
}

docker_compose() {
	if docker info >/dev/null 2>&1; then
		docker compose "$@"
		return
	fi

	if [[ "${EUID}" -eq 0 ]]; then
		docker compose "$@"
		return
	fi

	sudo docker compose "$@"
}

validate_files() {
	[[ -f "$SCRIPT_DIR/.env" ]] || {
		warn "Không tìm thấy $SCRIPT_DIR/.env. Hãy chạy install/update trước."
		return 1
	}

	if command -v node >/dev/null 2>&1; then
		node --check "$SCRIPT_DIR/omnirouter-exporter/src/index.js"
		node -e "const fs=require('fs'); for (const f of fs.readdirSync('$SCRIPT_DIR/grafana/dashboards').filter(f=>f.endsWith('.json'))) JSON.parse(fs.readFileSync('$SCRIPT_DIR/grafana/dashboards/'+f,'utf8')); console.log('dashboard json ok');"
	else
		warn "Không có node trên host, bỏ qua validate exporter/dashboard JSON."
	fi

	(cd "$SCRIPT_DIR" && docker_compose --env-file .env config >/dev/null)
	printf '%s\n' 'validate ok'
}

quick_action=""
quick_service=""

case "${1:-}" in
	--help|-h)
		usage
		exit 0
		;;
	--status)
		(cd "$SCRIPT_DIR" && docker_compose --env-file .env ps)
		exit 0
		;;
	--logs)
		quick_action="logs"
		quick_service="${2:-}"
		if [[ -n "$quick_service" ]]; then
			(cd "$SCRIPT_DIR" && docker_compose --env-file .env logs -f --tail=200 "$quick_service")
		else
			(cd "$SCRIPT_DIR" && docker_compose --env-file .env logs -f --tail=200)
		fi
		exit 0
		;;
	--restart)
		quick_service="${2:-}"
		if [[ -n "$quick_service" ]]; then
			(cd "$SCRIPT_DIR" && docker_compose --env-file .env up -d --build "$quick_service")
		else
			(cd "$SCRIPT_DIR" && docker_compose --env-file .env up -d --build)
		fi
		exit 0
		;;
	--metrics)
		command -v curl >/dev/null 2>&1 || {
			warn "Không tìm thấy curl trên host."
			exit 1
		}
		exporter_port="$(get_metadata_value OMNIROUTER_EXPORTER_PORT "$SCRIPT_DIR/.env")"
		curl -fsS "http://localhost:${exporter_port:-9208}/metrics" | grep -E '^(omnirouter_up|omnirouter_scrape_success|omnirouter_scrape_endpoint_failures|omnirouter_endpoint_up|omnirouter_token_health_|omnirouter_model_count|omnirouter_provider_connections_count|omnirouter_usage_)' | head -n 80 || true
		exit 0
		;;
	--validate)
		validate_files
		exit 0
		;;
esac
SOURCE_DIR="$(get_metadata_value SOURCE_DIR "$SOURCE_METADATA")"

if [[ -n "$SOURCE_DIR" && "$SOURCE_DIR" != "$SCRIPT_DIR" && -f "$SOURCE_DIR/install.sh" ]]; then
	if command -v git >/dev/null 2>&1 && git -C "$SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		git -C "$SOURCE_DIR" pull --ff-only || warn "Không git pull được source $SOURCE_DIR. Tiếp tục dùng source hiện có."
	fi

	exec bash "$SOURCE_DIR/install.sh" --update --install-dir "$INSTALL_DIR" "$@"
fi

exec bash "$SCRIPT_DIR/install.sh" --update "$@"