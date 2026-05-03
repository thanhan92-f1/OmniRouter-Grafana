import express from 'express';
import client from 'prom-client';

const config = {
  port: Number(process.env.EXPORTER_PORT || 9208),
  baseUrl: normalizeBaseUrl(process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128'),
  apiKey: process.env.OMNIROUTE_API_KEY || '',
  managementToken: process.env.OMNIROUTE_MANAGEMENT_TOKEN || '',
  instance: process.env.OMNIROUTE_INSTANCE || 'omnirouter',
  env: process.env.OMNIROUTE_ENV || 'production',
  scrapeTimeoutMs: Number(process.env.SCRAPE_TIMEOUT_MS || 12000),
};

const app = express();
const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'omnirouter_exporter_',
  labels: {
    instance: config.instance,
    env: config.env,
  },
});

const defaultLabels = {
  instance: config.instance,
  env: config.env,
};

register.setDefaultLabels(defaultLabels);

const omniUp = gauge('omnirouter_up', 'OmniRouter health status from /api/monitoring/health. 1 is healthy, 0 is unhealthy.');
const omniScrapeSuccess = gauge('omnirouter_scrape_success', 'Whether the last exporter scrape completed successfully.');
const omniScrapeDuration = gauge('omnirouter_scrape_duration_seconds', 'Duration of the last exporter scrape in seconds.');
const omniEndpointUp = gauge('omnirouter_endpoint_up', 'Per-endpoint availability observed by exporter.', ['endpoint']);
const omniEndpointLatency = gauge('omnirouter_endpoint_latency_seconds', 'Per-endpoint latency observed by exporter.', ['endpoint']);
const uptimeSeconds = gauge('omnirouter_uptime_seconds', 'OmniRouter uptime in seconds.');
const memoryBytes = gauge('omnirouter_memory_bytes', 'OmniRouter memory usage by type.', ['type']);
const storageHealthy = gauge('omnirouter_storage_healthy', 'OmniRouter storage health. 1 is healthy, 0 is unhealthy.');
const sqliteSizeBytes = gauge('omnirouter_sqlite_size_bytes', 'OmniRouter SQLite database size in bytes.');
const backupCount = gauge('omnirouter_backup_count', 'Number of OmniRouter backups if reported by API.');
const requestsTotal = gauge('omnirouter_requests_total', 'Total OmniRouter requests reported by usage APIs.');
const errorsTotal = gauge('omnirouter_errors_total', 'Total OmniRouter failed/error requests reported by usage APIs.');
const tokensInputTotal = gauge('omnirouter_tokens_input_total', 'Total input/prompt tokens reported by usage APIs.');
const tokensOutputTotal = gauge('omnirouter_tokens_output_total', 'Total output/completion tokens reported by usage APIs.');
const tokensTotal = gauge('omnirouter_tokens_total', 'Total tokens reported by usage APIs.');
const costUsdTotal = gauge('omnirouter_cost_usd_total', 'Total USD cost reported by usage APIs.');
const budgetUsageRatio = gauge('omnirouter_budget_usage_ratio', 'Current budget usage ratio from 0 to 1.');
const budgetLimitUsd = gauge('omnirouter_budget_limit_usd', 'Configured budget limit in USD.');
const budgetUsedUsd = gauge('omnirouter_budget_used_usd', 'Budget used in USD.');
const circuitBreakerOpen = gauge('omnirouter_circuit_breaker_open', 'Circuit breaker state by provider/model. 1 is open, 0 is closed.', ['provider', 'model']);
const queuePending = gauge('omnirouter_queue_pending', 'Pending queued requests/jobs reported by resilience endpoint.');
const queueFailedTotal = gauge('omnirouter_queue_failed_total', 'Failed queued requests/jobs reported by resilience endpoint.');
const rateLimitRemaining = gauge('omnirouter_rate_limit_remaining', 'Rate limit remaining by account/provider/model.', ['account', 'provider', 'model']);
const providerUp = gauge('omnirouter_provider_up', 'Provider health state. 1 is up, 0 is down.', ['provider']);
const providerLatency = gauge('omnirouter_provider_latency_seconds', 'Provider latency in seconds.', ['provider']);
const providerErrorsTotal = gauge('omnirouter_provider_errors_total', 'Provider errors total.', ['provider']);
const comboRequestsTotal = gauge('omnirouter_combo_requests_total', 'Combo request count by combo.', ['combo']);
const comboErrorsTotal = gauge('omnirouter_combo_errors_total', 'Combo error count by combo.', ['combo']);

for (const metric of [
  omniUp,
  omniScrapeSuccess,
  omniScrapeDuration,
  omniEndpointUp,
  omniEndpointLatency,
  uptimeSeconds,
  memoryBytes,
  storageHealthy,
  sqliteSizeBytes,
  backupCount,
  requestsTotal,
  errorsTotal,
  tokensInputTotal,
  tokensOutputTotal,
  tokensTotal,
  costUsdTotal,
  budgetUsageRatio,
  budgetLimitUsd,
  budgetUsedUsd,
  circuitBreakerOpen,
  queuePending,
  queueFailedTotal,
  rateLimitRemaining,
  providerUp,
  providerLatency,
  providerErrorsTotal,
  comboRequestsTotal,
  comboErrorsTotal,
]) {
  register.registerMetric(metric);
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'omnirouter-exporter' });
});

app.get('/metrics', async (_req, res) => {
  const start = process.hrtime.bigint();

  try {
    await scrapeOmniRouter();
    omniScrapeSuccess.set(1);
  } catch (error) {
    omniScrapeSuccess.set(0);
    omniUp.set(0);
    console.error('[omnirouter-exporter] scrape failed:', error);
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    omniScrapeDuration.set(durationSeconds);
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(config.port, () => {
  console.log(`[omnirouter-exporter] listening on :${config.port}`);
  console.log(`[omnirouter-exporter] target ${config.baseUrl}`);
});

async function scrapeOmniRouter() {
  const [health, storage, analytics, budget, resilience, rateLimits, combos] = await Promise.all([
    fetchEndpoint('/api/monitoring/health'),
    fetchEndpoint('/api/storage/health'),
    fetchEndpoint('/api/usage/analytics?period=day'),
    fetchEndpoint('/api/usage/budget'),
    fetchEndpoint('/api/resilience'),
    fetchEndpoint('/api/rate-limits'),
    fetchEndpoint('/api/combos/metrics'),
  ]);

  applyHealth(health);
  applyStorage(storage);
  applyAnalytics(analytics);
  applyBudget(budget);
  applyResilience(resilience);
  applyRateLimits(rateLimits);
  applyCombos(combos);
}

async function fetchEndpoint(path) {
  const url = `${config.baseUrl}${path}`;
  const started = process.hrtime.bigint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.scrapeTimeoutMs);

  try {
    const headers = {
      Accept: 'application/json',
    };

    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    if (config.managementToken) {
      headers.Cookie = `token=${config.managementToken}`;
      headers['X-OmniRoute-Management-Token'] = config.managementToken;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    omniEndpointLatency.set({ endpoint: pathWithoutQuery(path) }, durationSeconds);
    omniEndpointUp.set({ endpoint: pathWithoutQuery(path) }, response.ok ? 1 : 0);

    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      path,
      data,
    };
  } catch (error) {
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    omniEndpointLatency.set({ endpoint: pathWithoutQuery(path) }, durationSeconds);
    omniEndpointUp.set({ endpoint: pathWithoutQuery(path) }, 0);

    return {
      ok: false,
      status: 0,
      path,
      data: null,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

function applyHealth(result) {
  const data = result.data || {};
  const healthy = result.ok && pickBoolean(data, ['healthy', 'ok', 'success', 'status'], ['healthy', 'ok', 'up', 'ready']);
  omniUp.set(healthy ? 1 : 0);

  const uptime = pickNumber(data, ['uptime', 'uptimeSeconds', 'uptime_seconds', 'process.uptime']);
  if (uptime !== null) uptimeSeconds.set(uptime);

  const memory = data.memory || data.mem || data.process?.memory || data.system?.memory;
  if (memory && typeof memory === 'object') {
    for (const [key, value] of Object.entries(flattenObject(memory))) {
      const numberValue = toNumber(value);
      if (numberValue !== null) {
        memoryBytes.set({ type: sanitizeLabel(key) }, numberValue);
      }
    }
  }

  applyProviderHealth(data.providers || data.providerHealth || data.connections || data.providerStatus);
}

function applyStorage(result) {
  const data = result.data || {};
  const healthy = result.ok && pickBoolean(data, ['healthy', 'ok', 'success', 'status'], ['healthy', 'ok', 'up', 'ready']);
  storageHealthy.set(healthy ? 1 : 0);

  setIfNumber(sqliteSizeBytes, data, ['sqliteSizeBytes', 'databaseSizeBytes', 'dbSizeBytes', 'sizeBytes', 'db.sizeBytes']);
  setIfNumber(backupCount, data, ['backupCount', 'backupsCount', 'backups.length']);
}

function applyAnalytics(result) {
  const data = result.data || {};
  const root = data.data || data.analytics || data.summary || data;

  setIfNumber(requestsTotal, root, ['requests', 'totalRequests', 'requestCount', 'total_calls', 'totalCalls', 'count']);
  setIfNumber(errorsTotal, root, ['errors', 'errorCount', 'failedRequests', 'failures', 'failed']);
  setIfNumber(tokensInputTotal, root, ['inputTokens', 'promptTokens', 'tokens.input', 'tokens.prompt', 'usage.prompt_tokens']);
  setIfNumber(tokensOutputTotal, root, ['outputTokens', 'completionTokens', 'tokens.output', 'tokens.completion', 'usage.completion_tokens']);
  setIfNumber(tokensTotal, root, ['totalTokens', 'tokens.total', 'usage.total_tokens']);
  setIfNumber(costUsdTotal, root, ['costUsd', 'totalCostUsd', 'cost', 'totalCost', 'usage.costUsd']);

  applyProviderCounters(root.providers || root.byProvider || root.providerStats);
}

function applyBudget(result) {
  const data = result.data || {};
  const root = data.data || data.budget || data;

  const limit = firstNumber(root, ['limitUsd', 'budgetUsd', 'limit', 'monthlyLimitUsd', 'dailyLimitUsd']);
  const used = firstNumber(root, ['usedUsd', 'spentUsd', 'usageUsd', 'used', 'spent']);
  const ratio = firstNumber(root, ['usageRatio', 'ratio', 'percentUsed']);

  if (limit !== null) budgetLimitUsd.set(limit);
  if (used !== null) budgetUsedUsd.set(used);

  if (ratio !== null) {
    budgetUsageRatio.set(ratio > 1 ? ratio / 100 : ratio);
  } else if (limit && used !== null) {
    budgetUsageRatio.set(used / limit);
  }
}

function applyResilience(result) {
  const data = result.data || {};
  const root = data.data || data.resilience || data;

  setIfNumber(queuePending, root, ['queue.pending', 'requestQueue.pending', 'pending', 'queued']);
  setIfNumber(queueFailedTotal, root, ['queue.failed', 'requestQueue.failed', 'failed']);

  circuitBreakerOpen.reset();
  const breakers = root.circuitBreakers || root.breakers || root.providerBreakers || root.providerBreaker;
  if (Array.isArray(breakers)) {
    for (const breaker of breakers) {
      const provider = String(breaker.provider || breaker.name || breaker.id || 'unknown');
      const model = String(breaker.model || 'all');
      const state = String(breaker.state || breaker.status || '').toLowerCase();
      const isOpen = breaker.open === true || breaker.isOpen === true || state === 'open';
      circuitBreakerOpen.set({ provider, model }, isOpen ? 1 : 0);
    }
  } else if (breakers && typeof breakers === 'object') {
    for (const [key, value] of Object.entries(breakers)) {
      const state = typeof value === 'object' ? String(value.state || value.status || '').toLowerCase() : String(value).toLowerCase();
      const isOpen = value?.open === true || value?.isOpen === true || state === 'open' || value === true;
      circuitBreakerOpen.set({ provider: sanitizeLabel(key), model: 'all' }, isOpen ? 1 : 0);
    }
  }
}

function applyRateLimits(result) {
  const data = result.data || {};
  const root = data.data || data.rateLimits || data.limits || data;

  rateLimitRemaining.reset();
  const rows = Array.isArray(root) ? root : Object.entries(root || {}).map(([key, value]) => ({ key, ...(typeof value === 'object' ? value : { remaining: value }) }));

  for (const row of rows) {
    const remaining = firstNumber(row, ['remaining', 'tokensRemaining', 'requestsRemaining', 'limitRemaining']);
    if (remaining === null) continue;

    rateLimitRemaining.set({
      account: String(row.account || row.accountId || row.key || 'default'),
      provider: String(row.provider || 'unknown'),
      model: String(row.model || 'all'),
    }, remaining);
  }
}

function applyCombos(result) {
  const data = result.data || {};
  const root = data.data || data.metrics || data.combos || data;
  const rows = Array.isArray(root) ? root : Object.entries(root || {}).map(([key, value]) => ({ combo: key, ...(typeof value === 'object' ? value : { requests: value }) }));

  comboRequestsTotal.reset();
  comboErrorsTotal.reset();

  for (const row of rows) {
    const combo = String(row.combo || row.name || row.id || 'unknown');
    const requests = firstNumber(row, ['requests', 'totalRequests', 'count']);
    const errors = firstNumber(row, ['errors', 'failed', 'failures']);
    if (requests !== null) comboRequestsTotal.set({ combo }, requests);
    if (errors !== null) comboErrorsTotal.set({ combo }, errors);
  }
}

function applyProviderHealth(providers) {
  if (!providers) return;

  const rows = Array.isArray(providers) ? providers : Object.entries(providers).map(([key, value]) => ({ provider: key, ...(typeof value === 'object' ? value : { up: value }) }));

  providerUp.reset();
  providerLatency.reset();

  for (const row of rows) {
    const provider = String(row.provider || row.name || row.id || 'unknown');
    const up = pickBoolean(row, ['healthy', 'ok', 'up', 'enabled', 'status'], ['healthy', 'ok', 'up', 'ready', 'online', 'enabled']);
    providerUp.set({ provider }, up ? 1 : 0);

    const latency = firstNumber(row, ['latencySeconds', 'latencyMs', 'responseTimeMs', 'durationMs']);
    if (latency !== null) {
      providerLatency.set({ provider }, row.latencyMs || row.responseTimeMs || row.durationMs ? latency / 1000 : latency);
    }
  }
}

function applyProviderCounters(providers) {
  if (!providers) return;

  const rows = Array.isArray(providers) ? providers : Object.entries(providers).map(([key, value]) => ({ provider: key, ...(typeof value === 'object' ? value : { requests: value }) }));

  providerErrorsTotal.reset();

  for (const row of rows) {
    const provider = String(row.provider || row.name || row.id || 'unknown');
    const errors = firstNumber(row, ['errors', 'errorCount', 'failed', 'failures']);
    if (errors !== null) providerErrorsTotal.set({ provider }, errors);
  }
}

function gauge(name, help, labelNames = []) {
  return new client.Gauge({ name, help, labelNames });
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function pathWithoutQuery(path) {
  return path.split('?')[0];
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(object, paths) {
  for (const path of paths) {
    const value = getPath(object, path);
    const numberValue = toNumber(value);
    if (numberValue !== null) return numberValue;
  }
  return null;
}

function setIfNumber(metric, object, paths) {
  const value = firstNumber(object, paths);
  if (value !== null) metric.set(value);
}

function pickBoolean(object, paths, positiveValues) {
  for (const path of paths) {
    const value = getPath(object, path);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') return positiveValues.includes(value.toLowerCase());
  }
  return false;
}

function getPath(object, path) {
  if (!object || typeof object !== 'object') return undefined;

  const parts = path.split('.');
  let current = object;

  for (const part of parts) {
    if (part === 'length' && Array.isArray(current)) return current.length;
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }

  return current;
}

function flattenObject(object, prefix = '') {
  const output = {};
  for (const [key, value] of Object.entries(object || {})) {
    const nextKey = prefix ? `${prefix}_${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(output, flattenObject(value, nextKey));
    } else {
      output[nextKey] = value;
    }
  }
  return output;
}

function sanitizeLabel(value) {
  return String(value).replace(/[^a-zA-Z0-9_:\-.]/g, '_');
}
