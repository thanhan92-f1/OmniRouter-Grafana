#!/usr/bin/env node

import express from 'express';
import client from 'prom-client';

const config = {
  port: Number(process.env.EXPORTER_PORT || 9208),
  baseUrl: normalizeBaseUrl(process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128'),
  apiKey: process.env.OMNIROUTE_API_KEY || '',
  adminPassword: process.env.OMNIROUTE_ADMIN_PASSWORD || '',
  instance: process.env.OMNIROUTE_INSTANCE || 'omnirouter',
  env: process.env.OMNIROUTE_ENV || 'production',
  scrapeTimeoutMs: Number(process.env.SCRAPE_TIMEOUT_MS || 20000),
};

const authState = {
  cookie: '',
  expiresAt: 0,
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
const omniScrapeEndpointFailures = gauge('omnirouter_scrape_endpoint_failures', 'Number of OmniRouter API endpoints that failed during the last exporter scrape.');
const omniEndpointUp = gauge('omnirouter_endpoint_up', 'Per-endpoint availability observed by exporter.', ['endpoint']);
const omniEndpointLatency = gauge('omnirouter_endpoint_latency_seconds', 'Per-endpoint latency observed by exporter.', ['endpoint']);
const omniEndpointStatus = gauge('omnirouter_endpoint_http_status', 'Per-endpoint HTTP status observed by exporter.', ['endpoint']);
const uptimeSeconds = gauge('omnirouter_uptime_seconds', 'OmniRouter uptime in seconds.');
const memoryBytes = gauge('omnirouter_memory_bytes', 'OmniRouter memory usage by type.', ['type']);
const storageHealthy = gauge('omnirouter_storage_healthy', 'OmniRouter storage health. 1 is healthy, 0 is unhealthy.');
const sqliteSizeBytes = gauge('omnirouter_sqlite_size_bytes', 'OmniRouter SQLite database size in bytes.');
const backupCount = gauge('omnirouter_backup_count', 'Number of OmniRouter backups if reported by API.');
const systemInitReady = gauge('omnirouter_system_init_ready', 'OmniRouter initialization/readiness status from /api/init. 1 is ready/initialized.');
const systemModelTagsCount = gauge('omnirouter_system_model_tags_count', 'Number of Ollama-compatible model tags reported by /api/tags.');
const systemActiveSessions = gauge('omnirouter_system_active_sessions', 'Number of active OmniRouter sessions reported by /api/sessions.');
const systemEvalSuitesCount = gauge('omnirouter_system_eval_suites_count', 'Number of eval suites reported by /api/evals.');
const systemRoutingPoliciesCount = gauge('omnirouter_system_routing_policies_count', 'Number of routing policies reported by /api/policies.');
const systemAuditLogEntriesCount = gauge('omnirouter_system_audit_log_entries_count', 'Number of compliance audit log entries returned by /api/compliance/audit-log.');
const systemCacheEntries = gauge('omnirouter_system_cache_entries', 'Cache entry count by cache layer.', ['cache']);
const systemCacheHitsTotal = gauge('omnirouter_system_cache_hits_total', 'Cache hits by cache layer.', ['cache']);
const systemCacheMissesTotal = gauge('omnirouter_system_cache_misses_total', 'Cache misses by cache layer.', ['cache']);
const systemCacheHitRatio = gauge('omnirouter_system_cache_hit_ratio', 'Cache hit ratio from 0 to 1 by cache layer.', ['cache']);
const systemCacheSizeBytes = gauge('omnirouter_system_cache_size_bytes', 'Cache size in bytes by cache layer.', ['cache']);
const modelCount = gauge('omnirouter_model_count', 'Number of models by model inventory source.', ['source']);
const providerConnectionsCount = gauge('omnirouter_provider_connections_count', 'Number of configured provider connections.');
const providerEnabledCount = gauge('omnirouter_provider_enabled_count', 'Number of provider connections that appear enabled/active.');
const providerNodesCount = gauge('omnirouter_provider_nodes_count', 'Number of provider nodes.');
const providerModelsCount = gauge('omnirouter_provider_models_count', 'Number of provider model records.');
const apiKeysCount = gauge('omnirouter_api_keys_count', 'Number of API keys returned by management API.');
const apiKeysActiveCount = gauge('omnirouter_api_keys_active_count', 'Number of API keys that appear active/enabled.');
const comboCount = gauge('omnirouter_combo_count', 'Number of routing combos.');
const comboEnabledCount = gauge('omnirouter_combo_enabled_count', 'Number of routing combos that appear enabled/active.');
const settingsPayloadRulesCount = gauge('omnirouter_settings_payload_rules_count', 'Number of configured payload rules.');
const settingsPayloadRulesEnabled = gauge('omnirouter_settings_payload_rules_enabled', 'Payload rules enabled flag. 1 is enabled.');
const settingsProxyEnabled = gauge('omnirouter_settings_proxy_enabled', 'Proxy settings enabled flag. 1 is enabled.');
const settingsIpFilterEnabled = gauge('omnirouter_settings_ip_filter_enabled', 'IP filter enabled flag. 1 is enabled.');
const settingsSystemPromptEnabled = gauge('omnirouter_settings_system_prompt_enabled', 'System prompt enabled/configured flag. 1 is enabled or configured.');
const settingsRateLimitEnabled = gauge('omnirouter_settings_rate_limit_enabled', 'Rate limit configuration enabled flag. 1 is enabled.');
const settingsThinkingBudget = gauge('omnirouter_settings_thinking_budget', 'Configured thinking budget value when reported.');
const pricingEntriesCount = gauge('omnirouter_pricing_entries_count', 'Number of pricing entries by pricing source.', ['source']);
const translatorHistoryEntries = gauge('omnirouter_translator_history_entries', 'Number of translator history entries returned by API.');
const cliToolBackupsCount = gauge('omnirouter_cli_tool_backups_count', 'Number of CLI tool backups.');
const cliToolEnabled = gauge('omnirouter_cli_tool_enabled', 'CLI tool settings enabled/configured flag by tool. 1 is enabled/configured.', ['tool']);
const cliToolProfilesCount = gauge('omnirouter_cli_tool_profiles_count', 'Number of CLI tool profiles by tool.', ['tool']);
const cloudModelAliasesCount = gauge('omnirouter_cloud_model_aliases_count', 'Number of cloud model aliases.');
const fallbackChainsCount = gauge('omnirouter_fallback_chains_count', 'Number of fallback chains.');
const fallbackChainsEnabledCount = gauge('omnirouter_fallback_chains_enabled_count', 'Number of fallback chains that appear enabled/active.');
const telemetryRequestsTotal = gauge('omnirouter_telemetry_requests_total', 'Telemetry summary request/call count.');
const telemetryErrorsTotal = gauge('omnirouter_telemetry_errors_total', 'Telemetry summary error/failure count.');
const telemetryTokensTotal = gauge('omnirouter_telemetry_tokens_total', 'Telemetry summary token count.');
const telemetryCostUsdTotal = gauge('omnirouter_telemetry_cost_usd_total', 'Telemetry summary USD cost.');
const tokenHealthTotal = gauge('omnirouter_token_health_total', 'Total token/provider health records.');
const tokenHealthHealthy = gauge('omnirouter_token_health_healthy', 'Number of healthy token/provider health records.');
const tokenHealthUnhealthy = gauge('omnirouter_token_health_unhealthy', 'Number of unhealthy token/provider health records.');
const requestsTotal = gauge('omnirouter_requests_total', 'Total OmniRouter requests reported by usage APIs.');
const errorsTotal = gauge('omnirouter_errors_total', 'Total OmniRouter failed/error requests reported by usage APIs.');
const tokensInputTotal = gauge('omnirouter_tokens_input_total', 'Total input/prompt tokens reported by usage APIs.');
const tokensOutputTotal = gauge('omnirouter_tokens_output_total', 'Total output/completion tokens reported by usage APIs.');
const tokensTotal = gauge('omnirouter_tokens_total', 'Total tokens reported by usage APIs.');
const costUsdTotal = gauge('omnirouter_cost_usd_total', 'Total USD cost reported by usage APIs.');
const usageRequestsPeriodTotal = gauge('omnirouter_usage_requests_total', 'Total OmniRouter requests by usage analytics period.', ['period']);
const usageErrorsPeriodTotal = gauge('omnirouter_usage_errors_total', 'Total OmniRouter failed/error requests by usage analytics period.', ['period']);
const usageTokensInputPeriodTotal = gauge('omnirouter_usage_tokens_input_total', 'Total input/prompt tokens by usage analytics period.', ['period']);
const usageTokensOutputPeriodTotal = gauge('omnirouter_usage_tokens_output_total', 'Total output/completion tokens by usage analytics period.', ['period']);
const usageTokensPeriodTotal = gauge('omnirouter_usage_tokens_total', 'Total tokens by usage analytics period.', ['period']);
const usageCostUsdPeriodTotal = gauge('omnirouter_usage_cost_usd_total', 'Total USD cost by usage analytics period.', ['period']);
const usageLogEntries = gauge('omnirouter_usage_log_entries', 'Number of usage log entries returned by each Usage API log endpoint.', ['source']);
const usageLogErrors = gauge('omnirouter_usage_log_errors', 'Number of failed/error entries returned by each Usage API log endpoint.', ['source']);
const usageHistoryPoints = gauge('omnirouter_usage_history_points', 'Number of historical usage points returned by /api/usage/history.');
const usageProviderRequestsTotal = gauge('omnirouter_usage_provider_requests_total', 'Usage requests by analytics period and provider.', ['period', 'provider']);
const usageProviderErrorsTotal = gauge('omnirouter_usage_provider_errors_total', 'Usage failed/error requests by analytics period and provider.', ['period', 'provider']);
const usageProviderTokensTotal = gauge('omnirouter_usage_provider_tokens_total', 'Usage tokens by analytics period and provider.', ['period', 'provider']);
const usageProviderCostUsdTotal = gauge('omnirouter_usage_provider_cost_usd_total', 'Usage USD cost by analytics period and provider.', ['period', 'provider']);
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
  omniScrapeEndpointFailures,
  omniEndpointUp,
  omniEndpointLatency,
  omniEndpointStatus,
  uptimeSeconds,
  memoryBytes,
  storageHealthy,
  sqliteSizeBytes,
  backupCount,
  systemInitReady,
  systemModelTagsCount,
  systemActiveSessions,
  systemEvalSuitesCount,
  systemRoutingPoliciesCount,
  systemAuditLogEntriesCount,
  systemCacheEntries,
  systemCacheHitsTotal,
  systemCacheMissesTotal,
  systemCacheHitRatio,
  systemCacheSizeBytes,
  modelCount,
  providerConnectionsCount,
  providerEnabledCount,
  providerNodesCount,
  providerModelsCount,
  apiKeysCount,
  apiKeysActiveCount,
  comboCount,
  comboEnabledCount,
  settingsPayloadRulesCount,
  settingsPayloadRulesEnabled,
  settingsProxyEnabled,
  settingsIpFilterEnabled,
  settingsSystemPromptEnabled,
  settingsRateLimitEnabled,
  settingsThinkingBudget,
  pricingEntriesCount,
  translatorHistoryEntries,
  cliToolBackupsCount,
  cliToolEnabled,
  cliToolProfilesCount,
  cloudModelAliasesCount,
  fallbackChainsCount,
  fallbackChainsEnabledCount,
  telemetryRequestsTotal,
  telemetryErrorsTotal,
  telemetryTokensTotal,
  telemetryCostUsdTotal,
  tokenHealthTotal,
  tokenHealthHealthy,
  tokenHealthUnhealthy,
  requestsTotal,
  errorsTotal,
  tokensInputTotal,
  tokensOutputTotal,
  tokensTotal,
  costUsdTotal,
  usageRequestsPeriodTotal,
  usageErrorsPeriodTotal,
  usageTokensInputPeriodTotal,
  usageTokensOutputPeriodTotal,
  usageTokensPeriodTotal,
  usageCostUsdPeriodTotal,
  usageLogEntries,
  usageLogErrors,
  usageHistoryPoints,
  usageProviderRequestsTotal,
  usageProviderErrorsTotal,
  usageProviderTokensTotal,
  usageProviderCostUsdTotal,
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
  const managementCookie = await getManagementCookie();
  const [
    health,
    storage,
    init,
    dbBackups,
    modelTags,
    sessions,
    cache,
    cacheStats,
    evals,
    policies,
    auditLog,
    analyticsDay,
    analyticsWeek,
    analyticsMonth,
    usageHistory,
    usageLogs,
    proxyLogs,
    requestLogs,
    callLogs,
    budget,
    resilience,
    rateLimits,
    combos,
    modelsV1,
    modelsManagement,
    modelsCatalog,
    modelsGemini,
    providers,
    providerClient,
    providerNodes,
    providerModels,
    apiKeys,
    combosList,
    settings,
    payloadRules,
    comboDefaults,
    proxySettings,
    ipFilter,
    systemPrompt,
    thinkingBudget,
    rateLimitConfig,
    pricing,
    pricingDefaults,
    pricingModels,
    translatorHistory,
    translatorLoad,
    cliBackups,
    cliAntigravityMitm,
    cliAntigravityAlias,
    cliClaudeSettings,
    cliClineSettings,
    cliCodexProfiles,
    cliCodexSettings,
    cliDroidSettings,
    cliKiloSettings,
    cliOpenclawSettings,
    cloudModelAliases,
    fallbackChains,
    telemetrySummary,
    tokenHealth,
  ] = await Promise.all([
    fetchEndpoint('/api/monitoring/health', { managementCookie }),
    fetchEndpoint('/api/storage/health', { managementCookie }),
    fetchEndpoint('/api/init', { managementCookie }),
    fetchEndpoint('/api/db-backups', { managementCookie }),
    fetchEndpoint('/api/tags', { managementCookie }),
    fetchEndpoint('/api/sessions', { managementCookie }),
    fetchEndpoint('/api/cache', { managementCookie }),
    fetchEndpoint('/api/cache/stats', { managementCookie }),
    fetchEndpoint('/api/evals', { managementCookie }),
    fetchEndpoint('/api/policies', { managementCookie }),
    fetchEndpoint('/api/compliance/audit-log?limit=100', { managementCookie }),
    fetchEndpoint('/api/usage/analytics?period=day', { managementCookie }),
    fetchEndpoint('/api/usage/analytics?period=week', { managementCookie, endpointLabel: '/api/usage/analytics:week' }),
    fetchEndpoint('/api/usage/analytics?period=month', { managementCookie, endpointLabel: '/api/usage/analytics:month' }),
    fetchEndpoint('/api/usage/history', { managementCookie }),
    fetchEndpoint('/api/usage/logs', { managementCookie }),
    fetchEndpoint('/api/usage/proxy-logs', { managementCookie }),
    fetchEndpoint('/api/usage/request-logs', { managementCookie }),
    fetchEndpoint('/api/usage/call-logs?limit=50&offset=0', { managementCookie }),
    fetchEndpoint('/api/usage/budget', { managementCookie }),
    fetchEndpoint('/api/resilience', { managementCookie }),
    fetchEndpoint('/api/rate-limits', { managementCookie }),
    fetchEndpoint('/api/combos/metrics', { managementCookie }),
    fetchEndpoint('/api/v1/models', { useBearer: true, skipIfNoBearer: true }),
    fetchEndpoint('/api/models', { managementCookie }),
    fetchEndpoint('/api/models/catalog', { managementCookie }),
    fetchEndpoint('/api/v1beta/models', { useBearer: true, skipIfNoBearer: true }),
    fetchEndpoint('/api/providers', { managementCookie }),
    fetchEndpoint('/api/providers/client', { managementCookie }),
    fetchEndpoint('/api/provider-nodes', { managementCookie }),
    fetchEndpoint('/api/provider-models', { managementCookie }),
    fetchEndpoint('/api/keys', { managementCookie }),
    fetchEndpoint('/api/combos', { managementCookie }),
    fetchEndpoint('/api/settings', { managementCookie }),
    fetchEndpoint('/api/settings/payload-rules', { managementCookie }),
    fetchEndpoint('/api/settings/combo-defaults', { managementCookie }),
    fetchEndpoint('/api/settings/proxy', { managementCookie }),
    fetchEndpoint('/api/settings/ip-filter', { managementCookie }),
    fetchEndpoint('/api/settings/system-prompt', { managementCookie }),
    fetchEndpoint('/api/settings/thinking-budget', { managementCookie }),
    fetchEndpoint('/api/rate-limit', { managementCookie }),
    fetchEndpoint('/api/pricing', { managementCookie }),
    fetchEndpoint('/api/pricing/defaults', { managementCookie }),
    fetchEndpoint('/api/pricing/models', { managementCookie }),
    fetchEndpoint('/api/translator/history', { managementCookie }),
    fetchEndpoint('/api/translator/load', { managementCookie }),
    fetchEndpoint('/api/cli-tools/backups', { managementCookie }),
    fetchEndpoint('/api/cli-tools/antigravity-mitm', { managementCookie }),
    fetchEndpoint('/api/cli-tools/antigravity-mitm/alias', { managementCookie }),
    fetchEndpoint('/api/cli-tools/claude-settings', { managementCookie }),
    fetchEndpoint('/api/cli-tools/cline-settings', { managementCookie }),
    fetchEndpoint('/api/cli-tools/codex-profiles', { managementCookie }),
    fetchEndpoint('/api/cli-tools/codex-settings', { managementCookie }),
    fetchEndpoint('/api/cli-tools/droid-settings', { managementCookie }),
    fetchEndpoint('/api/cli-tools/kilo-settings', { managementCookie }),
    fetchEndpoint('/api/cli-tools/openclaw-settings', { managementCookie }),
    fetchEndpoint('/api/cloud/models/alias', { managementCookie }),
    fetchEndpoint('/api/fallback/chains', { managementCookie }),
    fetchEndpoint('/api/telemetry/summary', { managementCookie }),
    fetchEndpoint('/api/token-health', { managementCookie }),
  ]);

  const endpointResults = [
    health,
    storage,
    init,
    dbBackups,
    modelTags,
    sessions,
    cache,
    cacheStats,
    evals,
    policies,
    auditLog,
    analyticsDay,
    analyticsWeek,
    analyticsMonth,
    usageHistory,
    usageLogs,
    proxyLogs,
    requestLogs,
    callLogs,
    budget,
    resilience,
    rateLimits,
    combos,
    modelsV1,
    modelsManagement,
    modelsCatalog,
    modelsGemini,
    providers,
    providerClient,
    providerNodes,
    providerModels,
    apiKeys,
    combosList,
    settings,
    payloadRules,
    comboDefaults,
    proxySettings,
    ipFilter,
    systemPrompt,
    thinkingBudget,
    rateLimitConfig,
    pricing,
    pricingDefaults,
    pricingModels,
    translatorHistory,
    translatorLoad,
    cliBackups,
    cliAntigravityMitm,
    cliAntigravityAlias,
    cliClaudeSettings,
    cliClineSettings,
    cliCodexProfiles,
    cliCodexSettings,
    cliDroidSettings,
    cliKiloSettings,
    cliOpenclawSettings,
    cloudModelAliases,
    fallbackChains,
    telemetrySummary,
    tokenHealth,
  ];

  omniScrapeEndpointFailures.set(endpointResults.filter((result) => !result.ok).length);

  applyHealth(health);
  applyStorage(storage);
  applySystem({ init, dbBackups, modelTags, sessions, cache, cacheStats, evals, policies, auditLog });
  applyAnalytics(analyticsDay, 'day', true);
  applyAnalytics(analyticsWeek, 'week');
  applyAnalytics(analyticsMonth, 'month');
  applyUsageHistory(usageHistory);
  applyUsageLogs('usage', usageLogs);
  applyUsageLogs('proxy', proxyLogs);
  applyUsageLogs('request', requestLogs);
  applyUsageLogs('call', callLogs);
  applyBudget(budget);
  applyResilience(resilience);
  applyRateLimits(rateLimits);
  applyCombos(combos);
  applyInventory({ modelsV1, modelsManagement, modelsCatalog, modelsGemini, providers, providerClient, providerNodes, providerModels, apiKeys, combosList });
  applySettings({ settings, payloadRules, proxySettings, ipFilter, systemPrompt, thinkingBudget, rateLimitConfig });
  applyPricing({ pricing, pricingDefaults, pricingModels });
  applyCliTools({ cliBackups, cliAntigravityMitm, cliAntigravityAlias, cliClaudeSettings, cliClineSettings, cliCodexProfiles, cliCodexSettings, cliDroidSettings, cliKiloSettings, cliOpenclawSettings });
  applyTranslator({ translatorHistory, translatorLoad });
  applyCloudFallback({ cloudModelAliases, fallbackChains });
  applyTelemetry(telemetrySummary);
  applyTokenHealth(tokenHealth);
}

async function getManagementCookie() {
  if (!config.adminPassword) return '';
  if (authState.cookie && Date.now() < authState.expiresAt) return authState.cookie;

  const response = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: config.adminPassword }),
  });

  if (!response.ok) {
    throw new Error(`Management login failed with HTTP ${response.status}`);
  }

  const setCookie = response.headers.get('set-cookie') || '';
  const authTokenCookie = extractCookie(setCookie, 'auth_token');

  if (!authTokenCookie) {
    throw new Error('Management login succeeded but no auth_token cookie was returned');
  }

  authState.cookie = authTokenCookie;
  authState.expiresAt = Date.now() + 50 * 60 * 1000;

  return authState.cookie;
}

async function fetchEndpoint(path, options = {}) {
  const url = `${config.baseUrl}${path}`;
  const endpoint = options.endpointLabel || pathWithoutQuery(path);

  if (options.useBearer && options.skipIfNoBearer && !config.apiKey) {
    omniEndpointUp.set({ endpoint }, 1);
    omniEndpointStatus.set({ endpoint }, 0);
    return {
      ok: true,
      status: 0,
      path,
      data: null,
      skipped: true,
    };
  }

  const started = process.hrtime.bigint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.scrapeTimeoutMs);

  try {
    const headers = {
      Accept: 'application/json',
    };

    if (options.useBearer && config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    if (options.managementCookie) {
      headers.Cookie = options.managementCookie;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    omniEndpointLatency.set({ endpoint }, durationSeconds);
    omniEndpointUp.set({ endpoint }, response.ok ? 1 : 0);
    omniEndpointStatus.set({ endpoint }, response.status);

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
    omniEndpointLatency.set({ endpoint }, durationSeconds);
    omniEndpointUp.set({ endpoint }, 0);
    omniEndpointStatus.set({ endpoint }, 0);

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

function extractCookie(setCookieHeader, cookieName) {
  const cookies = splitSetCookie(setCookieHeader);
  const prefix = `${cookieName}=`;
  const cookie = cookies.find((entry) => entry.trim().startsWith(prefix));
  return cookie ? cookie.split(';')[0].trim() : '';
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,\s]+=)/g);
}

function applyHealth(result) {
  const data = result.data || {};
  const healthy = result.ok && pickBoolean(data, ['healthy', 'ok', 'success', 'status'], ['healthy', 'ok', 'up', 'ready']);
  omniUp.set(healthy ? 1 : 0);

  const uptime = firstNumber(data, ['uptime', 'uptimeSeconds', 'uptime_seconds', 'process.uptime']);
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
  const root = data.data || data.storage || data;
  const healthy = result.ok && pickBoolean(data, ['healthy', 'ok', 'success', 'status'], ['healthy', 'ok', 'up', 'ready']);
  storageHealthy.set(healthy ? 1 : 0);

  setIfNumber(sqliteSizeBytes, root, ['sqliteSizeBytes', 'databaseSizeBytes', 'dbSizeBytes', 'sizeBytes', 'db.sizeBytes']);
  setIfNumber(backupCount, root, ['backupCount', 'backupsCount', 'backups.length']);
}

function applySystem({ init, dbBackups, modelTags, sessions, cache, cacheStats, evals, policies, auditLog }) {
  const initData = init.data || {};
  const initRoot = initData.data || initData.init || initData;
  const initReady = firstBoolean(initRoot, ['ready', 'initialized', 'isInitialized', 'setupComplete', 'ok', 'success', 'status'], ['ready', 'initialized', 'ok', 'success', 'up', 'true'], ['not_ready', 'uninitialized', 'not_initialized', 'setup_required', 'error', 'failed', 'false']);
  const setupRequired = firstBoolean(initRoot, ['requiresSetup', 'setupRequired', 'needsSetup'], ['true', 'yes', 'required'], ['false', 'no']);
  systemInitReady.set(init.ok && (initReady === true || (initReady === null && setupRequired !== true)) ? 1 : 0);

  setCollectionCount(backupCount, dbBackups, ['backups', 'items', 'rows', 'results', 'data']);
  setCollectionCount(systemModelTagsCount, modelTags, ['models', 'tags', 'items', 'rows', 'results', 'data']);
  setCollectionCount(systemActiveSessions, sessions, ['sessions', 'activeSessions', 'items', 'rows', 'results', 'data']);
  setCollectionCount(systemEvalSuitesCount, evals, ['evals', 'suites', 'items', 'rows', 'results', 'data']);
  setCollectionCount(systemRoutingPoliciesCount, policies, ['policies', 'items', 'rows', 'results', 'data']);
  setCollectionCount(systemAuditLogEntriesCount, auditLog, ['auditLog', 'logs', 'entries', 'items', 'rows', 'results', 'data']);

  systemCacheEntries.reset();
  systemCacheHitsTotal.reset();
  systemCacheMissesTotal.reset();
  systemCacheHitRatio.reset();
  systemCacheSizeBytes.reset();
  applyCacheMetrics(cache.data, 'cache');
  applyCacheMetrics(cacheStats.data, 'stats');
}

function applyAnalytics(result, period = 'day', legacyTotals = false) {
  if (period === 'day') resetUsageAnalyticsMetrics();

  const data = result.data || {};
  const sourceRoot = data.data || data.analytics || data;
  const root = sourceRoot.summary || sourceRoot.totals || sourceRoot.total || sourceRoot.overview || sourceRoot;

  const requests = firstNumber(root, ['requests', 'totalRequests', 'requestCount', 'total_calls', 'totalCalls', 'count', 'requests.total', 'totals.requests', 'summary.requests']);
  const errors = firstNumber(root, ['errors', 'errorCount', 'totalErrors', 'failedRequests', 'failures', 'failed', 'requests.failed', 'totals.errors', 'summary.errors']);
  const inputTokens = firstNumber(root, ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens', 'tokens.input', 'tokens.prompt', 'usage.prompt_tokens', 'totalInputTokens']);
  const outputTokens = firstNumber(root, ['outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens', 'tokens.output', 'tokens.completion', 'usage.completion_tokens', 'totalOutputTokens']);
  const explicitTokens = firstNumber(root, ['totalTokens', 'tokens.total', 'usage.total_tokens', 'total_tokens', 'tokensTotal']);
  const totalTokens = explicitTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const costUsd = firstNumber(root, ['costUsd', 'totalCostUsd', 'cost_usd', 'total_cost_usd', 'cost', 'totalCost', 'usage.costUsd']);

  setLabeledIfNumber(usageRequestsPeriodTotal, { period }, requests);
  setLabeledIfNumber(usageErrorsPeriodTotal, { period }, errors);
  setLabeledIfNumber(usageTokensInputPeriodTotal, { period }, inputTokens);
  setLabeledIfNumber(usageTokensOutputPeriodTotal, { period }, outputTokens);
  setLabeledIfNumber(usageTokensPeriodTotal, { period }, totalTokens);
  setLabeledIfNumber(usageCostUsdPeriodTotal, { period }, costUsd);

  if (legacyTotals) {
    setPlainIfNumber(requestsTotal, requests);
    setPlainIfNumber(errorsTotal, errors);
    setPlainIfNumber(tokensInputTotal, inputTokens);
    setPlainIfNumber(tokensOutputTotal, outputTokens);
    setPlainIfNumber(tokensTotal, totalTokens);
    setPlainIfNumber(costUsdTotal, costUsd);
    applyProviderCounters(sourceRoot.providers || sourceRoot.byProvider || sourceRoot.providerStats || root.providers || root.byProvider || root.providerStats);
  }

  applyUsageProviderCounters(sourceRoot, root, period);
}

function applyUsageHistory(result) {
  setCollectionCount(usageHistoryPoints, result, ['history', 'usage', 'points', 'items', 'rows', 'results', 'data']);
}

function applyUsageLogs(source, result) {
  const data = result.data || {};
  const rows = extractRows(data, ['logs', 'callLogs', 'proxyLogs', 'requestLogs', 'usageLogs', 'entries', 'items', 'rows', 'results', 'data']);
  const total = collectionCount(data, ['logs', 'callLogs', 'proxyLogs', 'requestLogs', 'usageLogs', 'entries', 'items', 'rows', 'results', 'data']);
  const errorCount = firstNumber(data, ['errorCount', 'errors', 'failed', 'failures', 'totalErrors', 'data.errorCount', 'data.errors', 'meta.errorCount']) ?? countErrorRows(rows);

  if (result.ok && total !== null) usageLogEntries.set({ source }, total);
  if (result.ok && errorCount !== null) usageLogErrors.set({ source }, errorCount);
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

function applyInventory({ modelsV1, modelsManagement, modelsCatalog, modelsGemini, providers, providerClient, providerNodes, providerModels, apiKeys, combosList }) {
  modelCount.reset();
  setCollectionCountWithLabels(modelCount, { source: 'v1' }, modelsV1, ['models', 'data', 'items', 'rows', 'results']);
  setCollectionCountWithLabels(modelCount, { source: 'management' }, modelsManagement, ['models', 'data', 'items', 'rows', 'results']);
  setCollectionCountWithLabels(modelCount, { source: 'catalog' }, modelsCatalog, ['models', 'catalog', 'data.models', 'data', 'items', 'rows', 'results']);
  setCollectionCountWithLabels(modelCount, { source: 'gemini' }, modelsGemini, ['models', 'data', 'items', 'rows', 'results']);

  const providerRows = rowsFromResult(providers, ['providers', 'connections', 'items', 'rows', 'results', 'data']);
  setCollectionCount(providerConnectionsCount, providers, ['providers', 'connections', 'items', 'rows', 'results', 'data']);
  setPlainIfNumber(providerEnabledCount, countEnabledRows(providerRows));
  applyProviderHealth(providerRows || providerClient.data?.providers || providerClient.data?.data?.providers || providerClient.data);

  setCollectionCount(providerNodesCount, providerNodes, ['nodes', 'providerNodes', 'items', 'rows', 'results', 'data']);
  setCollectionCount(providerModelsCount, providerModels, ['models', 'providerModels', 'items', 'rows', 'results', 'data']);

  const keyRows = rowsFromResult(apiKeys, ['keys', 'apiKeys', 'items', 'rows', 'results', 'data']);
  setCollectionCount(apiKeysCount, apiKeys, ['keys', 'apiKeys', 'items', 'rows', 'results', 'data']);
  setPlainIfNumber(apiKeysActiveCount, countEnabledRows(keyRows));

  const comboRows = rowsFromResult(combosList, ['combos', 'items', 'rows', 'results', 'data']);
  setCollectionCount(comboCount, combosList, ['combos', 'items', 'rows', 'results', 'data']);
  setPlainIfNumber(comboEnabledCount, countEnabledRows(comboRows));
}

function applySettings({ settings, payloadRules, proxySettings, ipFilter, systemPrompt, thinkingBudget, rateLimitConfig }) {
  const settingsRoot = rootData(settings.data || {});
  const payloadRoot = rootData(payloadRules.data || {});
  const proxyRoot = rootData(proxySettings.data || {});
  const ipFilterRoot = rootData(ipFilter.data || {});
  const systemPromptRoot = rootData(systemPrompt.data || {});
  const thinkingRoot = rootData(thinkingBudget.data || {});
  const rateLimitRoot = rootData(rateLimitConfig.data || {});

  setCollectionCount(settingsPayloadRulesCount, payloadRules, ['rules', 'payloadRules', 'items', 'rows', 'results', 'data.rules', 'data']);
  setBooleanIfFound(settingsPayloadRulesEnabled, payloadRoot, ['enabled', 'isEnabled', 'payloadRulesEnabled', 'rules.enabled']);
  setBooleanIfFound(settingsProxyEnabled, proxyRoot, ['enabled', 'isEnabled', 'proxyEnabled']);
  setBooleanIfFound(settingsIpFilterEnabled, ipFilterRoot, ['enabled', 'isEnabled', 'ipFilterEnabled']);
  setBooleanIfFound(settingsSystemPromptEnabled, systemPromptRoot, ['enabled', 'isEnabled', 'systemPromptEnabled', 'prompt.enabled']);
  setBooleanIfFound(settingsRateLimitEnabled, rateLimitRoot, ['enabled', 'isEnabled', 'rateLimitEnabled']);
  setIfNumber(settingsThinkingBudget, thinkingRoot, ['budget', 'thinkingBudget', 'maxTokens', 'tokens', 'value']);

  setBooleanIfFound(settingsPayloadRulesEnabled, settingsRoot, ['payloadRules.enabled', 'payloadRulesEnabled']);
  setBooleanIfFound(settingsProxyEnabled, settingsRoot, ['proxy.enabled', 'proxyEnabled']);
  setBooleanIfFound(settingsIpFilterEnabled, settingsRoot, ['ipFilter.enabled', 'ipFilterEnabled']);
  setBooleanIfFound(settingsSystemPromptEnabled, settingsRoot, ['systemPrompt.enabled', 'systemPromptEnabled']);
  setBooleanIfFound(settingsRateLimitEnabled, settingsRoot, ['rateLimit.enabled', 'rateLimitEnabled']);
}

function applyPricing({ pricing, pricingDefaults, pricingModels }) {
  pricingEntriesCount.reset();
  setCollectionCountWithLabels(pricingEntriesCount, { source: 'pricing' }, pricing, ['pricing', 'prices', 'models', 'items', 'rows', 'results', 'data']);
  setCollectionCountWithLabels(pricingEntriesCount, { source: 'defaults' }, pricingDefaults, ['defaults', 'pricing', 'prices', 'models', 'items', 'rows', 'results', 'data']);
  setCollectionCountWithLabels(pricingEntriesCount, { source: 'models' }, pricingModels, ['models', 'pricing', 'prices', 'items', 'rows', 'results', 'data']);
}

function applyTranslator({ translatorHistory, translatorLoad }) {
  setCollectionCount(translatorHistoryEntries, translatorHistory, ['history', 'translations', 'items', 'rows', 'results', 'data']);

  if (translatorLoad.ok && translatorLoad.data) {
    const templateConfigured = firstBoolean(rootData(translatorLoad.data), ['configured', 'enabled', 'ok', 'success', 'hasTemplate'], ['configured', 'enabled', 'ok', 'success', 'true'], ['false', 'disabled']);
    if (templateConfigured !== null) {
      cliToolEnabled.set({ tool: 'translator_template' }, templateConfigured ? 1 : 0);
    }
  }
}

function applyCliTools({ cliBackups, cliAntigravityMitm, cliAntigravityAlias, cliClaudeSettings, cliClineSettings, cliCodexProfiles, cliCodexSettings, cliDroidSettings, cliKiloSettings, cliOpenclawSettings }) {
  cliToolEnabled.reset();
  cliToolProfilesCount.reset();

  setCollectionCount(cliToolBackupsCount, cliBackups, ['backups', 'items', 'rows', 'results', 'data']);
  setCliToolState('antigravity_mitm', cliAntigravityMitm);
  setCliToolState('antigravity_alias', cliAntigravityAlias);
  setCliToolState('claude', cliClaudeSettings);
  setCliToolState('cline', cliClineSettings);
  setCliToolState('codex_settings', cliCodexSettings);
  setCliToolState('droid', cliDroidSettings);
  setCliToolState('kilo', cliKiloSettings);
  setCliToolState('openclaw', cliOpenclawSettings);

  setCollectionCountWithLabels(cliToolProfilesCount, { tool: 'codex' }, cliCodexProfiles, ['profiles', 'codexProfiles', 'items', 'rows', 'results', 'data']);
}

function applyCloudFallback({ cloudModelAliases, fallbackChains }) {
  setCollectionCount(cloudModelAliasesCount, cloudModelAliases, ['aliases', 'models', 'items', 'rows', 'results', 'data']);

  const chainsRows = rowsFromResult(fallbackChains, ['chains', 'fallbackChains', 'items', 'rows', 'results', 'data']);
  setCollectionCount(fallbackChainsCount, fallbackChains, ['chains', 'fallbackChains', 'items', 'rows', 'results', 'data']);
  setPlainIfNumber(fallbackChainsEnabledCount, countEnabledRows(chainsRows));
}

function applyTelemetry(result) {
  const root = rootData(result.data || {});
  const requests = firstNumber(root, ['requests', 'totalRequests', 'requestCount', 'calls', 'totalCalls', 'count', 'summary.requests', 'totals.requests']);
  const errors = firstNumber(root, ['errors', 'errorCount', 'totalErrors', 'failedRequests', 'failures', 'failed', 'summary.errors', 'totals.errors']);
  const tokens = firstNumber(root, ['tokens', 'totalTokens', 'tokens.total', 'usage.total_tokens', 'summary.tokens', 'totals.tokens']);
  const cost = firstNumber(root, ['costUsd', 'totalCostUsd', 'cost', 'totalCost', 'summary.costUsd', 'totals.costUsd']);

  setPlainIfNumber(telemetryRequestsTotal, requests);
  setPlainIfNumber(telemetryErrorsTotal, errors);
  setPlainIfNumber(telemetryTokensTotal, tokens);
  setPlainIfNumber(telemetryCostUsdTotal, cost);
}

function applyTokenHealth(result) {
  const rows = rowsFromResult(result, ['tokens', 'providers', 'health', 'items', 'rows', 'results', 'data']);
  const total = collectionCount(result.data || {}, ['tokens', 'providers', 'health', 'items', 'rows', 'results', 'data']);

  if (result.ok && total !== null) tokenHealthTotal.set(total);
  if (!rows) return;

  let healthy = 0;
  let unhealthy = 0;

  for (const row of rows) {
    const rowHealthy = firstBoolean(row, ['healthy', 'ok', 'up', 'valid', 'available', 'status'], ['healthy', 'ok', 'up', 'valid', 'available', 'ready', 'active', 'success'], ['unhealthy', 'down', 'invalid', 'unavailable', 'error', 'failed', 'inactive']);
    if (rowHealthy === true) healthy += 1;
    if (rowHealthy === false) unhealthy += 1;
  }

  tokenHealthHealthy.set(healthy);
  tokenHealthUnhealthy.set(unhealthy);
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

function applyUsageProviderCounters(sourceRoot, root, period) {
  const providers = sourceRoot.providers || sourceRoot.byProvider || sourceRoot.providerStats || root.providers || root.byProvider || root.providerStats;
  if (!providers) return;

  const rows = Array.isArray(providers) ? providers : Object.entries(providers).map(([key, value]) => ({ provider: key, ...(typeof value === 'object' ? value : { requests: value }) }));

  for (const row of rows) {
    const provider = String(row.provider || row.name || row.id || 'unknown');
    const inputTokens = firstNumber(row, ['inputTokens', 'promptTokens', 'tokens.input', 'tokens.prompt', 'usage.prompt_tokens']);
    const outputTokens = firstNumber(row, ['outputTokens', 'completionTokens', 'tokens.output', 'tokens.completion', 'usage.completion_tokens']);
    const explicitTokens = firstNumber(row, ['totalTokens', 'tokens.total', 'usage.total_tokens']);
    const totalTokens = explicitTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);

    setLabeledIfNumber(usageProviderRequestsTotal, { period, provider }, firstNumber(row, ['requests', 'totalRequests', 'requestCount', 'count']));
    setLabeledIfNumber(usageProviderErrorsTotal, { period, provider }, firstNumber(row, ['errors', 'errorCount', 'failed', 'failures']));
    setLabeledIfNumber(usageProviderTokensTotal, { period, provider }, totalTokens);
    setLabeledIfNumber(usageProviderCostUsdTotal, { period, provider }, firstNumber(row, ['costUsd', 'totalCostUsd', 'cost', 'totalCost']));
  }
}

function applyCacheMetrics(data, fallbackName) {
  const root = data?.data || data?.stats || data?.cache || data;
  if (!root || typeof root !== 'object') return;

  const directHasValues = hasAnyNumber(root, ['entries', 'entryCount', 'count', 'keys', 'items', 'size', 'length', 'hits', 'hitCount', 'misses', 'missCount', 'hitRatio', 'hitRate', 'sizeBytes', 'memoryBytes']);
  if (directHasValues) {
    setCacheLayerMetrics(fallbackName, root);
  }

  for (const [key, value] of Object.entries(root)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    setCacheLayerMetrics(sanitizeLabel(key), value);
  }
}

function setCacheLayerMetrics(cacheName, stats) {
  const labels = { cache: sanitizeLabel(cacheName || 'default') };
  const entries = firstNumber(stats, ['entries', 'entryCount', 'count', 'keys', 'items', 'size', 'length']);
  const hits = firstNumber(stats, ['hits', 'hitCount', 'totalHits']);
  const misses = firstNumber(stats, ['misses', 'missCount', 'totalMisses']);
  const ratio = firstNumber(stats, ['hitRatio', 'hitRate', 'ratio']);
  const sizeBytes = firstNumber(stats, ['sizeBytes', 'memoryBytes', 'bytes', 'memoryUsageBytes']);

  setLabeledIfNumber(systemCacheEntries, labels, entries);
  setLabeledIfNumber(systemCacheHitsTotal, labels, hits);
  setLabeledIfNumber(systemCacheMissesTotal, labels, misses);
  setLabeledIfNumber(systemCacheSizeBytes, labels, sizeBytes);

  if (ratio !== null) {
    systemCacheHitRatio.set(labels, ratio > 1 ? ratio / 100 : ratio);
  } else if (hits !== null && misses !== null && hits + misses > 0) {
    systemCacheHitRatio.set(labels, hits / (hits + misses));
  }
}

function resetUsageAnalyticsMetrics() {
  usageRequestsPeriodTotal.reset();
  usageErrorsPeriodTotal.reset();
  usageTokensInputPeriodTotal.reset();
  usageTokensOutputPeriodTotal.reset();
  usageTokensPeriodTotal.reset();
  usageCostUsdPeriodTotal.reset();
  usageProviderRequestsTotal.reset();
  usageProviderErrorsTotal.reset();
  usageProviderTokensTotal.reset();
  usageProviderCostUsdTotal.reset();
}

function setPlainIfNumber(metric, value) {
  if (value !== null) metric.set(value);
}

function setLabeledIfNumber(metric, labels, value) {
  if (value !== null) metric.set(labels, value);
}

function setCollectionCountWithLabels(metric, labels, result, paths) {
  const count = result.ok ? collectionCount(result.data || {}, paths) : null;
  if (count !== null) metric.set(labels, count);
}

function setCollectionCount(metric, result, paths) {
  const count = result.ok ? collectionCount(result.data || {}, paths) : null;
  if (count !== null) metric.set(count);
}

function collectionCount(object, paths) {
  const explicit = firstNumber(object, ['total', 'totalCount', 'count', 'length', 'meta.total', 'meta.count', 'pagination.total', 'pagination.count']);
  if (explicit !== null) return explicit;

  const rows = extractRows(object, paths);
  return rows ? rows.length : null;
}

function extractRows(object, paths) {
  if (Array.isArray(object)) return object;

  for (const path of paths) {
    const value = getPath(object, path);
    if (Array.isArray(value)) return value;
  }

  return null;
}

function countErrorRows(rows) {
  if (!rows) return null;
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.status || row.state || row.result || '').toLowerCase();
    return row.error === true || row.failed === true || status.includes('error') || status.includes('fail');
  }).length;
}

function countEnabledRows(rows) {
  if (!rows) return null;
  return rows.filter((row) => rowEnabled(row)).length;
}

function rowEnabled(row) {
  if (!row || typeof row !== 'object') return false;
  const enabled = firstBoolean(row, ['enabled', 'active', 'isActive', 'isEnabled', 'healthy', 'ok', 'status', 'state'], ['enabled', 'active', 'true', 'healthy', 'ok', 'ready', 'online', 'valid'], ['disabled', 'inactive', 'false', 'unhealthy', 'down', 'error', 'failed', 'invalid']);
  return enabled === true;
}

function rowsFromResult(result, paths) {
  if (!result?.ok) return null;
  return extractRows(result.data || {}, paths);
}

function rootData(data) {
  return data?.data || data?.settings || data?.config || data?.summary || data || {};
}

function setBooleanIfFound(metric, object, paths) {
  const value = firstBoolean(object, paths, ['enabled', 'active', 'true', 'yes', 'ok', 'success', 'ready', 'configured'], ['disabled', 'inactive', 'false', 'no', 'error', 'failed', 'not_configured']);
  if (value !== null) metric.set(value ? 1 : 0);
}

function setCliToolState(tool, result) {
  const root = rootData(result.data || {});
  const enabled = result.ok && (firstBoolean(root, ['enabled', 'isEnabled', 'configured', 'active', 'available', 'ok', 'success', 'status'], ['enabled', 'configured', 'active', 'available', 'ok', 'success', 'ready', 'true'], ['disabled', 'inactive', 'unavailable', 'error', 'failed', 'false']) ?? hasAnyMeaningfulValue(root));
  cliToolEnabled.set({ tool }, enabled ? 1 : 0);
}

function hasAnyMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value).some((entry) => hasAnyMeaningfulValue(entry));
  }
  return false;
}

function firstBoolean(object, paths, positiveValues, negativeValues = []) {
  for (const path of paths) {
    const value = getPath(object, path);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (positiveValues.includes(normalized)) return true;
      if (negativeValues.includes(normalized)) return false;
    }
  }
  return null;
}

function hasAnyNumber(object, paths) {
  return firstNumber(object, paths) !== null;
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
