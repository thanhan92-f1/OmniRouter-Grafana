#!/usr/bin/env bash

set -Eeuo pipefail

DEFAULT_INSTALL_DIR="${OMNIROUTER_MONITORING_INSTALL_DIR:-/home/omnirouter-monitoring}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

MODE="install"
INSTALL_DIR=""
NO_START=0
SKIP_DEPS=0
RECONFIGURE=0

usage() {
  cat <<'EOF'
OmniRouter Monitoring installer

Usage:
  bash install.sh [options]

Options:
  --install-dir DIR   Install/update directory. Default: /home/omnirouter-monitoring
  --update            Update stack files, preserve .env unless reconfigured.
  --reconfigure       Ask again for .env values.
  --no-start          Do not start Docker Compose after writing files.
  --skip-deps         Skip Docker dependency checks/installation.
  -h, --help          Show this help.

The installer asks the client for environment values and writes .env in the
installation directory. Management auth uses auth_token cookie from
POST /api/auth/login, so OMNIROUTE_ADMIN_PASSWORD is required.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      if [[ -z "${2:-}" ]]; then
        echo "--install-dir cần giá trị thư mục, ví dụ: --install-dir /home/omnirouter-monitoring" >&2
        usage
        exit 2
      fi
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --update)
      MODE="update"
      shift
      ;;
    --reconfigure)
      RECONFIGURE=1
      shift
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    --skip-deps)
      SKIP_DEPS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

log() {
  printf '\033[1;32m[INFO]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2
  exit 1
}

is_root() {
  [[ "${EUID}" -eq 0 ]]
}

run_root() {
  if is_root; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 || die "Cần sudo hoặc chạy script bằng root."
  sudo "$@"
}

ask_yes_no() {
  local question="$1"
  local default="${2:-N}"
  local answer prompt

  if [[ "$default" =~ ^[Yy]$ ]]; then
    prompt="[Y/n]"
  else
    prompt="[y/N]"
  fi

  while true; do
    read -r -p "$question $prompt " answer
    answer="${answer:-$default}"
    case "$answer" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) warn "Vui lòng nhập y hoặc n." ;;
    esac
  done
}

prompt_value() {
  local var_name="$1"
  local label="$2"
  local default="${3:-}"
  local required="${4:-0}"
  local secret="${5:-0}"
  local input_value

  while true; do
    if [[ "$secret" == "1" && -n "$default" ]]; then
      read -r -p "$label [đang có giá trị, Enter để giữ]: " input_value
    elif [[ "$secret" == "1" ]]; then
      read -r -p "$label: " input_value
    elif [[ -n "$default" ]]; then
      read -r -p "$label [$default]: " input_value
    else
      read -r -p "$label: " input_value
    fi

    input_value="${input_value:-$default}"

    if [[ "$required" == "1" && -z "$input_value" ]]; then
      warn "$label không được để trống."
      continue
    fi

    if [[ "$input_value" == *$'\n'* || "$input_value" == *$'\r'* ]]; then
      warn "$label không được chứa xuống dòng."
      continue
    fi

    printf -v "$var_name" '%s' "$input_value"
    break
  done
}

prompt_port() {
  local var_name="$1"
  local label="$2"
  local default="$3"
  local port_value

  while true; do
    prompt_value port_value "$label" "$default" 1 0
    if [[ "$port_value" =~ ^[0-9]+$ ]] && (( port_value >= 1 && port_value <= 65535 )); then
      printf -v "$var_name" '%s' "$port_value"
      return
    fi
    warn "$label phải là port từ 1 đến 65535."
  done
}

strip_quotes() {
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

get_env_default() {
  local key="$1"
  local fallback="${2:-}"
  local env_file="${3:-}"
  local line value

  if [[ -n "$env_file" && -f "$env_file" ]]; then
    line="$(grep -E "^[[:space:]]*${key}=" "$env_file" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      value="${line#*=}"
      strip_quotes "$value"
      return
    fi
  fi

  printf '%s' "$fallback"
}

empty_if_placeholder() {
  case "${1:-}" in
    change-me|change-me-*|your-*|your-*) printf '' ;;
    *) printf '%s' "${1:-}" ;;
  esac
}

quote_env_value() {
  local value="${1:-}"
  local single_quote="'"
  local escaped_single="\\'"

  value="${value//$'\r'/}"
  value="${value//$'\n'/}"

  if [[ -z "$value" ]]; then
    printf ''
    return
  fi

  if [[ "$value" =~ ^[A-Za-z0-9_./:@%+=,-]+$ ]]; then
    printf '%s' "$value"
    return
  fi

  value="${value//$single_quote/$escaped_single}"
  printf "'%s'" "$value"
}

write_env_line() {
  local key="$1"
  local value="${2:-}"
  printf '%s=%s\n' "$key" "$(quote_env_value "$value")"
}

choose_install_dir() {
  if [[ -z "$INSTALL_DIR" ]]; then
    prompt_value INSTALL_DIR "Thư mục cài đặt" "$DEFAULT_INSTALL_DIR" 1 0
  fi

  [[ "$INSTALL_DIR" == /* ]] || die "Thư mục cài đặt phải là đường dẫn tuyệt đối, ví dụ: /home/omnirouter-monitoring"

  if [[ "$INSTALL_DIR" != /home/* ]]; then
    warn "Bạn đang chọn thư mục ngoài /home: $INSTALL_DIR"
    ask_yes_no "Tiếp tục với thư mục này?" "N" || exit 1
  fi
}

ensure_source_files() {
  [[ -f "$SCRIPT_DIR/docker-compose.yml" ]] || die "Không tìm thấy docker-compose.yml cạnh install.sh. Hãy chạy script trong thư mục plan/monitoring."
  [[ -f "$SCRIPT_DIR/omnirouter-exporter/src/index.js" ]] || die "Không tìm thấy omnirouter-exporter/src/index.js. Bộ file monitoring chưa đầy đủ."
  [[ -f "$SCRIPT_DIR/update.sh" ]] || die "Không tìm thấy update.sh cạnh install.sh."
}

install_docker_from_apt_repo() {
  local os_id codename arch gpg_url repo_line

  # shellcheck disable=SC1091
  source /etc/os-release
  os_id="${ID:-}"
  codename="${VERSION_CODENAME:-}"

  if [[ -z "$codename" ]] && command -v lsb_release >/dev/null 2>&1; then
    codename="$(lsb_release -cs)"
  fi

  if [[ "$os_id" != "ubuntu" && "$os_id" != "debian" ]]; then
    warn "OS $os_id chưa được Docker official repo hỗ trợ trực tiếp bởi script. Thử cài docker.io từ apt."
    run_root apt-get install -y docker.io docker-compose-plugin
    return
  fi

  [[ -n "$codename" ]] || die "Không xác định được VERSION_CODENAME để cài Docker."

  arch="$(dpkg --print-architecture)"
  gpg_url="https://download.docker.com/linux/${os_id}/gpg"
  repo_line="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${os_id} ${codename} stable"

  run_root install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    log "Thêm Docker GPG key."
    curl -fsSL "$gpg_url" | run_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    run_root chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  printf '%s\n' "$repo_line" | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  run_root apt-get update
  run_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_compose_plugin_only_from_apt_repo() {
  local os_id codename arch gpg_url repo_line

  # shellcheck disable=SC1091
  source /etc/os-release
  os_id="${ID:-}"
  codename="${VERSION_CODENAME:-}"

  if [[ -z "$codename" ]] && command -v lsb_release >/dev/null 2>&1; then
    codename="$(lsb_release -cs)"
  fi

  if [[ "$os_id" != "ubuntu" && "$os_id" != "debian" ]]; then
    warn "OS $os_id chưa được Docker official repo hỗ trợ trực tiếp bởi script. Thử cài docker-compose-plugin từ apt."
    run_root apt-get install -y docker-compose-plugin
    return
  fi

  [[ -n "$codename" ]] || die "Không xác định được VERSION_CODENAME để cài Docker Compose plugin."

  arch="$(dpkg --print-architecture)"
  gpg_url="https://download.docker.com/linux/${os_id}/gpg"
  repo_line="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${os_id} ${codename} stable"

  run_root install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    log "Thêm Docker GPG key để cài riêng Docker Compose plugin."
    curl -fsSL "$gpg_url" | run_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    run_root chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  printf '%s\n' "$repo_line" | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  run_root apt-get update
  run_root apt-get install -y docker-compose-plugin
}

ensure_dependencies() {
  local docker_has=0 compose_has=0 docker_version compose_version

  if [[ "$SKIP_DEPS" == "1" ]]; then
    warn "Bỏ qua bước kiểm tra/cài dependency theo yêu cầu."
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker_has=1
    docker_version="$(docker --version 2>/dev/null || true)"
    log "Docker đã có: ${docker_version:-unknown version}"
  else
    warn "Chưa có Docker trên host."
  fi

  if [[ "$docker_has" == "1" ]] && docker compose version >/dev/null 2>&1; then
    compose_has=1
    compose_version="$(docker compose version --short 2>/dev/null || docker compose version 2>/dev/null || true)"
    log "Docker Compose plugin đã có: ${compose_version:-unknown version}"
  elif [[ "$docker_has" == "1" ]]; then
    warn "Chưa có Docker Compose plugin."
  fi

  if [[ "$docker_has" == "1" && "$compose_has" == "1" ]]; then
    log "Docker/Compose đã có sẵn. Bỏ qua apt-get update và không cài Docker."
  else
    command -v apt-get >/dev/null 2>&1 || {
      warn "Không tìm thấy apt-get. Script sẽ không tự cài Docker/dependency."
      return
    }

    log "Chỉ vì thiếu Docker/Compose nên mới chạy apt-get update và cài dependency cần thiết."
    export DEBIAN_FRONTEND=noninteractive
    run_root apt-get update
    run_root apt-get install -y ca-certificates curl gnupg lsb-release

    if [[ "$docker_has" == "0" ]]; then
      log "Tiến hành cài Docker Engine và Docker Compose plugin."
      install_docker_from_apt_repo
    elif [[ "$compose_has" == "0" ]]; then
      log "Docker đã có nhưng thiếu Compose plugin. Tiến hành cài Docker Compose plugin."
      if ! run_root apt-get install -y docker-compose-plugin; then
        warn "Không cài được docker-compose-plugin từ repo hiện tại. Thử thêm Docker official repo nhưng chỉ cài Compose plugin, không cài lại Docker Engine."
        install_compose_plugin_only_from_apt_repo
      fi
    fi
  fi

  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable --now docker >/dev/null 2>&1 || warn "Không thể enable/start Docker bằng systemctl. Hãy kiểm tra Docker service thủ công."
  fi

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    run_root usermod -aG docker "$SUDO_USER" >/dev/null 2>&1 || warn "Không thể thêm user $SUDO_USER vào group docker."
  fi
}

copy_stack_files() {
  local source_real target_real

  run_root install -d -m 0755 "$INSTALL_DIR"
  source_real="$(cd "$SCRIPT_DIR" && pwd -P)"
  target_real="$(cd "$INSTALL_DIR" && pwd -P)"

  if [[ "$source_real" == "$target_real" ]]; then
    log "Nguồn và thư mục cài đặt giống nhau, bỏ qua bước copy."
  elif command -v rsync >/dev/null 2>&1; then
    log "Copy bộ file monitoring vào $INSTALL_DIR và giữ nguyên .env hiện có."
    run_root rsync -a --delete \
      --exclude '.env' \
      --exclude '.install-source' \
      --exclude 'install.sh' \
      --exclude 'update.sh' \
      "$SCRIPT_DIR"/ "$INSTALL_DIR"/
  else
    log "Copy bộ file monitoring bằng tar vào $INSTALL_DIR và giữ nguyên .env hiện có."
    if is_root; then
      (cd "$SCRIPT_DIR" && tar --exclude='./.env' --exclude='./.install-source' --exclude='./install.sh' --exclude='./update.sh' -cf - .) | tar -xf - -C "$INSTALL_DIR"
    else
      (cd "$SCRIPT_DIR" && tar --exclude='./.env' --exclude='./.install-source' --exclude='./install.sh' --exclude='./update.sh' -cf - .) | sudo tar -xf - -C "$INSTALL_DIR"
    fi
  fi

  if [[ "$source_real" != "$target_real" ]]; then
    run_root install -m 0755 "$SCRIPT_DIR/install.sh" "$INSTALL_DIR/install.sh"
    run_root install -m 0755 "$SCRIPT_DIR/update.sh" "$INSTALL_DIR/update.sh"
  else
    run_root chmod 0755 "$INSTALL_DIR/install.sh" "$INSTALL_DIR/update.sh"
  fi

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    run_root chown -R "$SUDO_USER:$SUDO_USER" "$INSTALL_DIR"
  fi
}

write_install_source_metadata() {
  local source_real target_real metadata_tmp git_remote git_branch

  source_real="$(cd "$SCRIPT_DIR" && pwd -P)"
  target_real="$(cd "$INSTALL_DIR" && pwd -P)"

  if [[ "$source_real" == "$target_real" && -f "$INSTALL_DIR/.install-source" ]]; then
    return
  fi

  git_remote=""
  git_branch=""

  if command -v git >/dev/null 2>&1 && git -C "$source_real" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git_remote="$(git -C "$source_real" config --get remote.origin.url || true)"
    git_branch="$(git -C "$source_real" rev-parse --abbrev-ref HEAD || true)"
  fi

  metadata_tmp="$(mktemp)"
  {
    printf '# Generated by install.sh. Used by update.sh to find original source files.\n'
    write_env_line SOURCE_DIR "$source_real"
    write_env_line GIT_REMOTE "$git_remote"
    write_env_line GIT_BRANCH "$git_branch"
  } >"$metadata_tmp"

  run_root install -m 0644 "$metadata_tmp" "$INSTALL_DIR/.install-source"
  rm -f "$metadata_tmp"

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    run_root chown "$SUDO_USER:$SUDO_USER" "$INSTALL_DIR/.install-source"
  fi
}

collect_env_values() {
  local source_env admin_default api_key_default grafana_password_default

  source_env="$INSTALL_DIR/.env"
  [[ -f "$source_env" ]] || source_env="$SCRIPT_DIR/.env"
  [[ -f "$source_env" ]] || source_env="$SCRIPT_DIR/.env.example"

  admin_default="$(empty_if_placeholder "$(get_env_default OMNIROUTE_ADMIN_PASSWORD '' "$source_env")")"
  api_key_default="$(empty_if_placeholder "$(get_env_default OMNIROUTE_API_KEY '' "$source_env")")"
  grafana_password_default="$(empty_if_placeholder "$(get_env_default GRAFANA_ADMIN_PASSWORD '' "$source_env")")"

  log "Nhập cấu hình .env cho client. Nhấn Enter để giữ giá trị mặc định/hiện có."
  prompt_value COMPOSE_PROJECT_NAME_VALUE "COMPOSE_PROJECT_NAME" "$(get_env_default COMPOSE_PROJECT_NAME omnirouter-monitoring "$source_env")" 1 0
  prompt_value OMNIROUTE_BASE_URL_VALUE "OmniRouter base URL" "$(get_env_default OMNIROUTE_BASE_URL https://platform.hitechcloud.one "$source_env")" 1 0
  prompt_value OMNIROUTE_ADMIN_PASSWORD_VALUE "OmniRouter dashboard admin password" "$admin_default" 1 1
  prompt_value OMNIROUTE_API_KEY_VALUE "OmniRouter API key cho /api/v1 hoặc /v1 nếu có" "$api_key_default" 0 1
  prompt_value OMNIROUTE_INSTANCE_VALUE "Instance label" "$(get_env_default OMNIROUTE_INSTANCE HiTechAI "$source_env")" 1 0
  prompt_value OMNIROUTE_ENV_VALUE "Environment label" "$(get_env_default OMNIROUTE_ENV production "$source_env")" 1 0
  prompt_value GRAFANA_ADMIN_USER_VALUE "Grafana admin user" "$(get_env_default GRAFANA_ADMIN_USER admin "$source_env")" 1 0
  prompt_value GRAFANA_ADMIN_PASSWORD_VALUE "Grafana admin password" "$grafana_password_default" 1 1
  prompt_port GRAFANA_PORT_VALUE "Grafana host port" "$(get_env_default GRAFANA_PORT 3001 "$source_env")"
  prompt_port PROMETHEUS_PORT_VALUE "Prometheus host port" "$(get_env_default PROMETHEUS_PORT 9090 "$source_env")"
  prompt_port LOKI_PORT_VALUE "Loki host port" "$(get_env_default LOKI_PORT 3100 "$source_env")"
  prompt_port BLACKBOX_PORT_VALUE "Blackbox Exporter host port" "$(get_env_default BLACKBOX_PORT 9115 "$source_env")"
  prompt_port OMNIROUTER_EXPORTER_PORT_VALUE "OmniRouter Exporter host port" "$(get_env_default OMNIROUTER_EXPORTER_PORT 9208 "$source_env")"
  prompt_value OMNIROUTE_LOGS_PATH_VALUE "OmniRouter logs path trên host" "$(get_env_default OMNIROUTE_LOGS_PATH /var/lib/omniroute/logs "$source_env")" 1 0
  prompt_value GRAFANA_ROOT_URL_VALUE "Grafana root URL public, bỏ trống nếu chưa có reverse proxy" "$(get_env_default GRAFANA_ROOT_URL '' "$source_env")" 0 0

  if [[ ! "$OMNIROUTE_BASE_URL_VALUE" =~ ^https?:// ]]; then
    warn "OmniRouter base URL không bắt đầu bằng http:// hoặc https://: $OMNIROUTE_BASE_URL_VALUE"
    ask_yes_no "Vẫn ghi giá trị này?" "N" || collect_env_values
  fi
}

print_config_summary() {
  log "Hiển thị đầy đủ cấu hình env sẽ ghi vào $INSTALL_DIR/.env:"
  printf '%s\n' '------------------------------------------------------------'
  write_env_line COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME_VALUE"
  write_env_line OMNIROUTE_BASE_URL "$OMNIROUTE_BASE_URL_VALUE"
  write_env_line OMNIROUTE_API_KEY "$OMNIROUTE_API_KEY_VALUE"
  write_env_line OMNIROUTE_ADMIN_PASSWORD "$OMNIROUTE_ADMIN_PASSWORD_VALUE"
  write_env_line OMNIROUTE_INSTANCE "$OMNIROUTE_INSTANCE_VALUE"
  write_env_line OMNIROUTE_ENV "$OMNIROUTE_ENV_VALUE"
  write_env_line GRAFANA_ADMIN_USER "$GRAFANA_ADMIN_USER_VALUE"
  write_env_line GRAFANA_ADMIN_PASSWORD "$GRAFANA_ADMIN_PASSWORD_VALUE"
  write_env_line GRAFANA_ROOT_URL "$GRAFANA_ROOT_URL_VALUE"
  write_env_line GRAFANA_PORT "$GRAFANA_PORT_VALUE"
  write_env_line PROMETHEUS_PORT "$PROMETHEUS_PORT_VALUE"
  write_env_line LOKI_PORT "$LOKI_PORT_VALUE"
  write_env_line BLACKBOX_PORT "$BLACKBOX_PORT_VALUE"
  write_env_line OMNIROUTER_EXPORTER_PORT "$OMNIROUTER_EXPORTER_PORT_VALUE"
  write_env_line OMNIROUTE_LOGS_PATH "$OMNIROUTE_LOGS_PATH_VALUE"
  printf '%s\n' '------------------------------------------------------------'
}

print_env_file() {
  local env_file="$1"

  log "Hiển thị đầy đủ cấu hình env hiện có: $env_file"
  printf '%s\n' '------------------------------------------------------------'

  if [[ -r "$env_file" ]]; then
    cat "$env_file"
  elif is_root; then
    cat "$env_file"
  else
    sudo cat "$env_file"
  fi

  printf '%s\n' '------------------------------------------------------------'
}

write_env_file() {
  local env_tmp backup_path target_env
  target_env="$INSTALL_DIR/.env"
  env_tmp="$(mktemp)"

  {
    printf '# Monitoring stack environment for OmniRouter\n'
    printf '# Generated by install.sh. Do not commit this file.\n\n'
    write_env_line COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME_VALUE"
    printf '\n'
    write_env_line OMNIROUTE_BASE_URL "$OMNIROUTE_BASE_URL_VALUE"
    write_env_line OMNIROUTE_API_KEY "$OMNIROUTE_API_KEY_VALUE"
    write_env_line OMNIROUTE_ADMIN_PASSWORD "$OMNIROUTE_ADMIN_PASSWORD_VALUE"
    printf '\n'
    write_env_line OMNIROUTE_INSTANCE "$OMNIROUTE_INSTANCE_VALUE"
    write_env_line OMNIROUTE_ENV "$OMNIROUTE_ENV_VALUE"
    printf '\n'
    write_env_line GRAFANA_ADMIN_USER "$GRAFANA_ADMIN_USER_VALUE"
    write_env_line GRAFANA_ADMIN_PASSWORD "$GRAFANA_ADMIN_PASSWORD_VALUE"
    write_env_line GRAFANA_ROOT_URL "$GRAFANA_ROOT_URL_VALUE"
    printf '\n'
    write_env_line GRAFANA_PORT "$GRAFANA_PORT_VALUE"
    write_env_line PROMETHEUS_PORT "$PROMETHEUS_PORT_VALUE"
    write_env_line LOKI_PORT "$LOKI_PORT_VALUE"
    write_env_line BLACKBOX_PORT "$BLACKBOX_PORT_VALUE"
    write_env_line OMNIROUTER_EXPORTER_PORT "$OMNIROUTER_EXPORTER_PORT_VALUE"
    printf '\n'
    write_env_line OMNIROUTE_LOGS_PATH "$OMNIROUTE_LOGS_PATH_VALUE"
  } >"$env_tmp"

  if [[ -f "$target_env" ]]; then
    backup_path="$target_env.bak.$(date +%Y%m%d%H%M%S)"
    run_root cp "$target_env" "$backup_path"
    log "Đã backup .env cũ: $backup_path"
  fi

  run_root install -m 0600 "$env_tmp" "$target_env"
  rm -f "$env_tmp"

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    run_root chown "$SUDO_USER:$SUDO_USER" "$target_env"
  fi

  log "Đã ghi cấu hình: $target_env"
}

prepare_log_directory() {
  local log_path
  log_path="$(get_env_default OMNIROUTE_LOGS_PATH /var/lib/omniroute/logs "$INSTALL_DIR/.env")"
  [[ -n "$log_path" ]] || return

  run_root install -d -m 0755 "$log_path" || warn "Không thể tạo log path $log_path. Hãy tạo thủ công nếu Promtail không đọc được log."
}

docker_compose() {
  if docker info >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if is_root; then
    docker compose "$@"
    return
  fi

  sudo docker compose "$@"
}

start_stack() {
  [[ "$NO_START" == "0" ]] || {
    warn "Đã bỏ qua bước khởi động stack theo --no-start."
    return
  }

  ask_yes_no "Khởi động/cập nhật Docker Compose stack ngay?" "Y" || return

  command -v docker >/dev/null 2>&1 || die "Không tìm thấy docker. Hãy cài Docker hoặc chạy lại không dùng --skip-deps."
  docker compose version >/dev/null 2>&1 || die "Không tìm thấy Docker Compose plugin."

  log "Validate docker-compose.yml."
  (cd "$INSTALL_DIR" && docker_compose --env-file .env config >/dev/null)

  log "Pull image có sẵn nếu có bản mới."
  (cd "$INSTALL_DIR" && docker_compose --env-file .env pull) || warn "Một số image/build service không pull được, tiếp tục chạy up --build."

  log "Build và chạy stack."
  (cd "$INSTALL_DIR" && docker_compose --env-file .env up -d --build)
  (cd "$INSTALL_DIR" && docker_compose --env-file .env ps)
}

main() {
  local should_write_env=1

  [[ "$(uname -s)" == "Linux" ]] || die "install.sh chỉ hỗ trợ Linux/VPS production."

  ensure_source_files
  choose_install_dir

  if [[ -f "$INSTALL_DIR/.env" && "$RECONFIGURE" == "0" ]]; then
    if [[ "$MODE" == "update" ]]; then
      if ask_yes_no "Phát hiện .env hiện có. Có muốn nhập lại cấu hình env không?" "N"; then
        should_write_env=1
      else
        should_write_env=0
      fi
    elif ask_yes_no "Phát hiện .env hiện có. Có muốn nhập lại cấu hình env không?" "N"; then
      should_write_env=1
    else
      should_write_env=0
    fi
  fi

  ensure_dependencies
  copy_stack_files
  write_install_source_metadata

  if [[ "$should_write_env" == "1" ]]; then
    collect_env_values
    print_config_summary
    write_env_file
  else
    log "Giữ nguyên cấu hình .env hiện có: $INSTALL_DIR/.env"
    print_env_file "$INSTALL_DIR/.env"
  fi

  [[ -f "$INSTALL_DIR/.env" ]] || die "Chưa có $INSTALL_DIR/.env. Hãy chạy lại và nhập cấu hình env."

  prepare_log_directory
  start_stack

  log "Hoàn tất. Thư mục cài đặt: $INSTALL_DIR"
  log "Chạy update sau này bằng: bash $INSTALL_DIR/update.sh"
}

main "$@"