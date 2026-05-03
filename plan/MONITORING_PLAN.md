# Plan triển khai hệ thống giám sát OmniRouter

Ngày lập: 2026-05-04

## Mục tiêu

Xây dựng hệ thống giám sát production cho OmniRouter tại `https://platform.hitechcloud.one`, gồm:

- Metrics ứng dụng OmniRouter
- Logs ứng dụng
- Metrics VPS
- Uptime/public endpoint check
- Dashboard Grafana
- Alert cơ bản

## Stack chọn

| Thành phần | Vai trò |
| --- | --- |
| Grafana | UI dashboard |
| Prometheus | Lưu metrics |
| Loki | Lưu logs |
| Promtail | Đẩy log vào Loki |
| Node Exporter | Metrics CPU/RAM/Disk/Network VPS |
| Blackbox Exporter | HTTP/TLS uptime probe |
| OmniRouter Exporter | Custom exporter chuyển API OmniRouter sang Prometheus metrics |

## Hiện trạng từ tài liệu

OmniRouter có các endpoint hữu ích:

- `/api/monitoring/health`
- `/api/storage/health`
- `/api/usage/analytics`
- `/api/usage/call-logs`
- `/api/usage/logs`
- `/api/usage/proxy-logs`
- `/api/usage/request-logs`
- `/api/usage/budget`
- `/api/combos/metrics`
- `/api/rate-limits`
- `/api/resilience`

Chưa thấy endpoint `/metrics` Prometheus chuẩn, nên cần `omnirouter-exporter`.

Auth management đúng:

- Dashboard/management endpoints dùng cookie session tên `auth_token`.
- Cookie `auth_token` được tạo qua `POST /api/auth/login` với password quản trị.
- Bearer token không được chấp nhận cho management routes.
- `OMNIROUTE_API_KEY` chỉ dùng cho `/api/v1/*` hoặc `/v1/*` proxy endpoints, không phải management token.
- Không dùng và không tạo biến `OMNIROUTE_MANAGEMENT_TOKEN`.

## Phase 1 — Logging

- Bật file log OmniRouter.
- Khuyến nghị JSON log:

```env
APP_LOG_FORMAT=json
APP_LOG_TO_FILE=true
ENABLE_REQUEST_LOGS=true
APP_LOG_FILE_PATH=/var/lib/omniroute/logs/application/app.log
```

- Promtail mount path log host qua `OMNIROUTE_LOGS_PATH`.
- Loki retention mặc định trong plan: 14 ngày.

## Phase 2 — Metrics hệ thống VPS

- Dùng Node Exporter.
- Theo dõi:
  - CPU
  - RAM
  - Disk
  - Network
  - Load average
  - Filesystem usage

## Phase 3 — Uptime public

- Dùng Blackbox Exporter probe:
  - `https://platform.hitechcloud.one/api/monitoring/health`
  - `https://platform.hitechcloud.one/api/storage/health`
  - `https://platform.hitechcloud.one/api/v1`

Lưu ý: nếu endpoint yêu cầu auth, dùng custom exporter thay vì Blackbox cho endpoint đó.

## Phase 4 — Custom OmniRouter Exporter

Exporter gọi API OmniRouter và expose `/metrics` tại port `9208`.

Exporter auth flow:

1. Đọc `OMNIROUTE_ADMIN_PASSWORD`.
1. Gọi `POST /api/auth/login`.
1. Lấy cookie `auth_token` từ `Set-Cookie`.
1. Gọi các endpoint management/usage/health bằng header `Cookie: auth_token=...`.

Metrics mục tiêu:

- `omnirouter_up`
- `omnirouter_storage_healthy`
- `omnirouter_requests_total`
- `omnirouter_errors_total`
- `omnirouter_tokens_total`
- `omnirouter_cost_usd_total`
- `omnirouter_budget_usage_ratio`
- `omnirouter_rate_limit_remaining`
- `omnirouter_circuit_breaker_open`
- `omnirouter_provider_up`
- `omnirouter_provider_latency_seconds`

## Phase 5 — Grafana dashboards

Dashboard ban đầu đã tạo:

- `OmniRouter Overview`

Cần bổ sung sau khi có dữ liệu thật:

1. OmniRouter Provider Health
2. Usage & Cost
3. Logs & Errors
4. VPS/System
5. Rate Limit & Budget

## Phase 6 — Alerting

Alert đã tạo trong `prometheus/alerts/omnirouter.yml`:

- OmniRouter down
- Exporter down
- Public endpoint down
- Storage unhealthy
- Latency cao
- Budget usage cao
- Circuit breaker open
- VPS CPU/RAM/Disk cao

Bước sau nên thêm Alertmanager để gửi Telegram/Email/Slack.

## Thứ tự triển khai thực tế

1. Copy `plan/monitoring/.env.example` thành `plan/monitoring/.env`.
1. Điền `OMNIROUTE_ADMIN_PASSWORD` bằng password dashboard admin hiện tại.
1. Điền `OMNIROUTE_API_KEY` riêng nếu sau này cần scrape proxy endpoints `/api/v1/*` hoặc `/v1/*`.
1. Xác nhận `OMNIROUTE_LOGS_PATH` đúng path log thật.
1. Chạy stack bằng Docker Compose.
1. Mở Grafana và kiểm tra datasource.
1. Kiểm tra Prometheus target `omnirouter-exporter`, `node-exporter`, `blackbox-omnirouter`.
1. Kiểm tra Loki có log OmniRouter.
1. Tinh chỉnh exporter sau khi xem JSON response thực tế của các endpoint.
1. Thêm dashboard chi tiết theo provider/model/API key.
1. Thêm Alertmanager.

## File triển khai

Bộ file nằm tại:

```text
plan/monitoring/
```
