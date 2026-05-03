# OmniRouter Monitoring Plan

Bộ file này dựng stack giám sát production cho OmniRouter bằng Grafana, Prometheus, Loki, Promtail, Node Exporter, Blackbox Exporter và custom OmniRouter Exporter.

## Kiến trúc

```text
OmniRouter API endpoints --> omnirouter-exporter --> Prometheus --> Grafana
OmniRouter log files -----> Promtail -------------> Loki -------> Grafana
VPS system metrics -------> Node Exporter --------> Prometheus --> Grafana
Public URL health --------> Blackbox Exporter ----> Prometheus --> Grafana
```

## Cấu trúc thư mục

```text
plan/monitoring/
  install.sh
  update.sh
  docker-compose.yml
  .env.example
  prometheus/
    prometheus.yml
    alerts/omnirouter.yml
  loki/config.yml
  promtail/config.yml
  blackbox/config.yml
  grafana/
    provisioning/datasources/datasources.yml
    provisioning/dashboards/dashboards.yml
    dashboards/omnirouter-overview.json
    dashboards/omnirouter-deep-dive.json
  omnirouter-exporter/
    Dockerfile
    package.json
    src/index.js
```

## Chuẩn bị

### Cài tự động trên VPS Linux

Script cài đặt mặc định tạo/cập nhật stack trong thư mục `/home/omnirouter-monitoring`. Script kiểm tra Docker/Compose trước; nếu đã có thì bỏ qua cài đặt Docker và không chạy `apt-get update`. Chỉ khi thiếu Docker hoặc Compose plugin, script mới chạy `apt-get update` và cài phần còn thiếu. Sau đó script copy bộ file monitoring, hỏi client nhập cấu hình `.env`, hiển thị đầy đủ cấu hình đã nhập, rồi chạy stack.

Chạy từ thư mục chứa bộ file `plan/monitoring`:

```bash
bash install.sh
```

Cài vào thư mục khác trong `/home`:

```bash
bash install.sh --install-dir /home/omnirouter-monitoring
```

Cập nhật sau này:

```bash
bash /home/omnirouter-monitoring/update.sh
```

Lệnh vận hành nhanh sau khi đã cài:

```bash
bash /home/omnirouter-monitoring/update.sh --status
bash /home/omnirouter-monitoring/update.sh --logs omnirouter-exporter
bash /home/omnirouter-monitoring/update.sh --restart omnirouter-exporter
bash /home/omnirouter-monitoring/update.sh --metrics
bash /home/omnirouter-monitoring/update.sh --validate
```

Nếu muốn cập nhật file nhưng nhập lại toàn bộ cấu hình env:

```bash
bash /home/omnirouter-monitoring/update.sh --reconfigure
```

Các giá trị script sẽ hỏi client nhập:

- `OMNIROUTE_BASE_URL`
- `OMNIROUTE_ADMIN_PASSWORD`
- `OMNIROUTE_API_KEY` nếu có dùng cho `/api/v1/*` hoặc `/v1/*`
- `OMNIROUTE_INSTANCE`
- `OMNIROUTE_ENV`
- `GRAFANA_ADMIN_USER`
- `GRAFANA_ADMIN_PASSWORD`
- `GRAFANA_ROOT_URL` nếu có reverse proxy public
- Các port host: Grafana, Prometheus, Loki, Blackbox, OmniRouter Exporter
- `SCRAPE_TIMEOUT_MS`
- `PROMETHEUS_RETENTION_TIME`
- `OMNIROUTE_LOGS_PATH`

Tùy chọn hữu ích:

| Option | Ý nghĩa |
| --- | --- |
| `--install-dir /home/omnirouter-monitoring` | Chọn thư mục cài đặt/cập nhật |
| `--update` | Cập nhật bộ file và giữ `.env` nếu không reconfigure |
| `--reconfigure` | Hỏi lại cấu hình `.env` |
| `--no-start` | Chỉ tạo file, không chạy Docker Compose |
| `--skip-deps` | Không kiểm tra/cài Docker dependency |

Script sẽ backup `.env` cũ thành `.env.bak.YYYYMMDDHHMMSS` trước khi ghi cấu hình mới.

### Cài thủ công

1. Copy env mẫu:

```bash
cp .env.example .env
```

1. Sửa `.env`:

```env
OMNIROUTE_BASE_URL=https://platform.hitechcloud.one
OMNIROUTE_API_KEY=your-dedicated-readonly-api-key
OMNIROUTE_ADMIN_PASSWORD=your-dashboard-admin-password
OMNIROUTE_INSTANCE=HiTechAI
OMNIROUTE_ENV=production
GRAFANA_ADMIN_PASSWORD=change-me-strong-password
SCRAPE_TIMEOUT_MS=20000
PROMETHEUS_RETENTION_TIME=30d
OMNIROUTE_LOGS_PATH=/var/lib/omniroute/logs
```

Auth lưu ý:

- Management/dashboard endpoints dùng cookie session `auth_token`, không dùng Bearer token.
- Exporter sẽ `POST /api/auth/login` bằng `OMNIROUTE_ADMIN_PASSWORD`, lấy `Set-Cookie: auth_token=...`, rồi gọi các management endpoints bằng cookie đó.
- `OMNIROUTE_API_KEY` chỉ dùng cho `/api/v1/*` hoặc `/v1/*` proxy endpoints nếu exporter cần mở rộng sau này.
- Không có biến `OMNIROUTE_MANAGEMENT_TOKEN` trong OmniRouter.

1. Xác nhận log path thật của OmniRouter.

Theo `.env` hiện tại, `DATA_DIR=/var/lib/omniroute` và logging đang bật:

```env
APP_LOG_TO_FILE=true
ENABLE_REQUEST_LOGS=true
```

Khuyến nghị cấu hình thêm ở OmniRouter `.env` production:

```env
APP_LOG_FORMAT=json
APP_LOG_FILE_PATH=/var/lib/omniroute/logs/application/app.log
```

Nếu log không nằm ở `/var/lib/omniroute/logs`, đổi `OMNIROUTE_LOGS_PATH` trong `plan/monitoring/.env`.

## Chạy stack

Từ thư mục `plan/monitoring`:

```bash
docker compose --env-file .env up -d --build
```

Kiểm tra container:

```bash
docker compose --env-file .env ps
```

Mở Grafana:

```text
http://localhost:3001
```

Datasource Prometheus và Loki sẽ được provision tự động.

## Endpoints nội bộ

| Service | URL |
| --- | --- |
| Grafana | `http://localhost:3001` |
| Prometheus | `http://localhost:9090` |
| Loki | `http://localhost:3100` |
| Blackbox Exporter | `http://localhost:9115` |
| OmniRouter Exporter | `http://localhost:9208/metrics` |

Trong production, chỉ nên expose Grafana qua reverse proxy có HTTPS/auth. Không expose Prometheus, Loki, exporters trực tiếp ra internet.

## Metrics chính

Custom exporter expose các metric sau nếu API OmniRouter trả dữ liệu tương ứng:

- `omnirouter_up`
- `omnirouter_uptime_seconds`
- `omnirouter_scrape_endpoint_failures`
- `omnirouter_endpoint_up`
- `omnirouter_endpoint_latency_seconds`
- `omnirouter_endpoint_http_status`
- `omnirouter_storage_healthy`
- `omnirouter_sqlite_size_bytes`
- `omnirouter_backup_count`
- `omnirouter_system_init_ready`
- `omnirouter_system_model_tags_count`
- `omnirouter_system_active_sessions`
- `omnirouter_system_eval_suites_count`
- `omnirouter_system_routing_policies_count`
- `omnirouter_system_audit_log_entries_count`
- `omnirouter_system_cache_entries`
- `omnirouter_system_cache_hits_total`
- `omnirouter_system_cache_misses_total`
- `omnirouter_system_cache_hit_ratio`
- `omnirouter_system_cache_size_bytes`
- `omnirouter_model_count{source="v1|management|catalog|gemini"}`
- `omnirouter_provider_connections_count`
- `omnirouter_provider_enabled_count`
- `omnirouter_provider_nodes_count`
- `omnirouter_provider_models_count`
- `omnirouter_api_keys_count`
- `omnirouter_api_keys_active_count`
- `omnirouter_combo_count`
- `omnirouter_combo_enabled_count`
- `omnirouter_settings_payload_rules_count`
- `omnirouter_settings_payload_rules_enabled`
- `omnirouter_settings_proxy_enabled`
- `omnirouter_settings_ip_filter_enabled`
- `omnirouter_settings_system_prompt_enabled`
- `omnirouter_settings_rate_limit_enabled`
- `omnirouter_settings_thinking_budget`
- `omnirouter_pricing_entries_count{source="pricing|defaults|models"}`
- `omnirouter_translator_history_entries`
- `omnirouter_cli_tool_backups_count`
- `omnirouter_cli_tool_enabled{tool="..."}`
- `omnirouter_cli_tool_profiles_count{tool="..."}`
- `omnirouter_cloud_model_aliases_count`
- `omnirouter_fallback_chains_count`
- `omnirouter_fallback_chains_enabled_count`
- `omnirouter_telemetry_requests_total`
- `omnirouter_telemetry_errors_total`
- `omnirouter_telemetry_tokens_total`
- `omnirouter_telemetry_cost_usd_total`
- `omnirouter_token_health_total`
- `omnirouter_token_health_healthy`
- `omnirouter_token_health_unhealthy`
- `omnirouter_requests_total`
- `omnirouter_errors_total`
- `omnirouter_tokens_input_total`
- `omnirouter_tokens_output_total`
- `omnirouter_tokens_total`
- `omnirouter_cost_usd_total`
- `omnirouter_usage_requests_total{period="day|week|month"}`
- `omnirouter_usage_errors_total{period="day|week|month"}`
- `omnirouter_usage_tokens_input_total{period="day|week|month"}`
- `omnirouter_usage_tokens_output_total{period="day|week|month"}`
- `omnirouter_usage_tokens_total{period="day|week|month"}`
- `omnirouter_usage_cost_usd_total{period="day|week|month"}`
- `omnirouter_usage_log_entries{source="usage|proxy|request|call"}`
- `omnirouter_usage_log_errors{source="usage|proxy|request|call"}`
- `omnirouter_usage_history_points`
- `omnirouter_usage_provider_requests_total`
- `omnirouter_usage_provider_errors_total`
- `omnirouter_usage_provider_tokens_total`
- `omnirouter_usage_provider_cost_usd_total`
- `omnirouter_budget_usage_ratio`
- `omnirouter_circuit_breaker_open`
- `omnirouter_rate_limit_remaining`
- `omnirouter_provider_up`
- `omnirouter_provider_latency_seconds`
- `omnirouter_provider_errors_total`
- `omnirouter_combo_requests_total`
- `omnirouter_combo_errors_total`

## OmniRouter API mà exporter đang gọi

- `/api/monitoring/health`
- `/api/storage/health`
- `/api/init`
- `/api/db-backups`
- `/api/tags`
- `/api/sessions`
- `/api/cache`
- `/api/cache/stats`
- `/api/evals`
- `/api/policies`
- `/api/compliance/audit-log?limit=100`
- `/api/usage/analytics?period=day`
- `/api/usage/analytics?period=week`
- `/api/usage/analytics?period=month`
- `/api/usage/history`
- `/api/usage/logs`
- `/api/usage/proxy-logs`
- `/api/usage/request-logs`
- `/api/usage/call-logs?limit=50&offset=0`
- `/api/usage/budget`
- `/api/resilience`
- `/api/rate-limits`
- `/api/combos/metrics`
- `/api/v1/models` nếu `OMNIROUTE_API_KEY` có giá trị
- `/api/models`
- `/api/models/catalog`
- `/api/v1beta/models` nếu `OMNIROUTE_API_KEY` có giá trị
- `/api/providers`
- `/api/providers/client`
- `/api/provider-nodes`
- `/api/provider-models`
- `/api/keys`
- `/api/combos`
- `/api/settings`
- `/api/settings/payload-rules`
- `/api/settings/combo-defaults`
- `/api/settings/proxy`
- `/api/settings/ip-filter`
- `/api/settings/system-prompt`
- `/api/settings/thinking-budget`
- `/api/rate-limit`
- `/api/pricing`
- `/api/pricing/defaults`
- `/api/pricing/models`
- `/api/translator/history`
- `/api/translator/load`
- `/api/cli-tools/backups`
- `/api/cli-tools/antigravity-mitm`
- `/api/cli-tools/antigravity-mitm/alias`
- `/api/cli-tools/claude-settings`
- `/api/cli-tools/cline-settings`
- `/api/cli-tools/codex-profiles`
- `/api/cli-tools/codex-settings`
- `/api/cli-tools/droid-settings`
- `/api/cli-tools/kilo-settings`
- `/api/cli-tools/openclaw-settings`
- `/api/cloud/models/alias`
- `/api/fallback/chains`
- `/api/telemetry/summary`
- `/api/token-health`

Các endpoint trên là dashboard/management endpoints. Exporter không gửi Bearer token cho chúng. Exporter tự login bằng:

```env
OMNIROUTE_ADMIN_PASSWORD=your-dashboard-admin-password
```

Cookie được OmniRouter trả về phải có tên `auth_token`.

Riêng `/api/v1/models` và `/api/v1beta/models` là proxy/model endpoints nên exporter chỉ scrape khi `OMNIROUTE_API_KEY` được cấu hình; nếu bỏ trống thì exporter bỏ qua và không tạo alert lỗi giả.

Grafana hiện provision 2 dashboard:

- `OmniRouter Overview`: health/usage/system/VPS/log tổng quan.
- `OmniRouter Deep Dive`: inventory providers/models/keys/combos, settings flags, CLI tools, pricing, cloud/fallback, telemetry, token health và endpoint latency.

## Alert rules đã có

- OmniRouter exporter down
- OmniRouter health failed
- Public endpoint down
- Public endpoint latency cao
- Storage unhealthy
- Budget usage >= 80%
- Circuit breaker open
- System API endpoint down
- Usage API endpoint down
- Usage log có failed/error entries
- Exporter scrape có endpoint lỗi
- Inventory API endpoint down
- Settings API endpoint down
- Telemetry/token-health API endpoint down
- Token health có record unhealthy
- VPS CPU/RAM/Disk cao

Hiện chưa cấu hình Alertmanager. Có thể thêm sau nếu cần gửi Telegram/Slack/Email.

## Logs trong Loki

Promtail đọc:

```text
/var/log/omniroute/**/*.log
```

Đường dẫn này được mount từ host qua biến:

```env
OMNIROUTE_LOGS_PATH=/var/lib/omniroute/logs
```

Label mặc định:

- `job=omnirouter`
- `service=omnirouter`
- `instance=HiTechAI`
- `env=production`

Query mẫu trong Grafana Explore:

```logql
{job="omnirouter"}
{job="omnirouter"} |~ "(?i)(error|failed|timeout)"
{job="omnirouter", level="error"}
```

## Gợi ý hardening production

- Đặt Grafana sau Nginx/Caddy HTTPS.
- Không public port `9090`, `3100`, `9115`, `9208`.
- Dùng dashboard admin password riêng/được quản lý bằng secret store cho exporter.
- Dùng API key riêng cho exporter nếu sau này scrape thêm `/api/v1/*` hoặc `/v1/*`.
- Nếu `.env` production từng bị chia sẻ hoặc commit, rotate secret/API keys.
- Set `APP_LOG_FORMAT=json` để Loki parse tốt hơn.
- Cấu hình backup volume Grafana/Prometheus/Loki.

## Troubleshooting

### Prometheus không thấy OmniRouter metrics

Kiểm tra exporter:

```bash
curl http://localhost:9208/metrics
```

Kiểm tra env:

```bash
docker compose --env-file .env logs -f omnirouter-exporter
```

### Loki không có log

Kiểm tra path host:

```bash
ls -lah /var/lib/omniroute/logs
```

Kiểm tra Promtail:

```bash
docker compose --env-file .env logs -f promtail
```

### Blackbox fail với endpoint cần auth

`/api/v1` có thể cần Bearer token nếu `REQUIRE_API_KEY=true`. Khi đó giữ Blackbox cho endpoint public không auth, hoặc mở health endpoint không cần auth qua reverse proxy nội bộ. Custom exporter hiện dùng cookie `auth_token` cho management endpoints; Bearer chỉ nên dùng khi scrape proxy endpoints `/api/v1/*` hoặc `/v1/*`.
