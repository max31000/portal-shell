import type { AppService } from './entities';

/** `result` values of `mvv42_auth_logins_total` (same as `login_events.result`), in legend order. */
export const LOGIN_RESULTS = [
  'ok',
  'denied_blocked',
  'invalid',
  'replayed',
  'denied_unregistered',
  'invite_check_failed',
] as const;

/** Requests no route matched have `endpoint=""` (an absent label in PromQL results). */
export const NO_ROUTE = '(без маршрута)';

export function endpointLabel(endpoint: string | undefined): string {
  return endpoint ? endpoint : NO_ROUTE;
}

/**
 * PromQL of the «Приложения» section for one service (prometheus-net, job `apps`, label `service`). Range
 * expressions use `$__rate`, period totals `$__range`.
 */
export function appQueries(service: AppService) {
  const sel = `job="apps",service="${service}"`;
  const requests = `http_requests_received_total{${sel}}`;
  const buckets = `http_request_duration_seconds_bucket{${sel}}`;
  return {
    rpsByEndpoint: `sum by (endpoint) (rate(${requests}[$__rate]))`,
    p95ByEndpoint: `histogram_quantile(0.95, sum by (endpoint, le) (rate(${buckets}[$__rate])))`,
    errorsByEndpoint: `sum by (endpoint) (rate(http_requests_received_total{${sel},code="5xx"}[$__rate]))`,
    workingSet: `sum(process_working_set_bytes{${sel}})`,
    managedHeap: `sum(dotnet_total_memory_bytes{${sel}})`,
    cpu: `100 * sum(rate(process_cpu_seconds_total{${sel}}[$__rate]))`,
    gcByGeneration: `sum by (generation) (rate(dotnet_collection_count_total{${sel}}[$__rate]))`,
    inProgress: `sum(http_requests_in_progress{${sel}})`,
    loginsByResult:
      service === 'auth' ? `60 * sum by (result) (rate(mvv42_auth_logins_total{${sel}}[$__rate]))` : null,
    totalByEndpoint: `sum by (endpoint) (increase(${requests}[$__range]))`,
    p95TotalByEndpoint: `histogram_quantile(0.95, sum by (endpoint, le) (increase(${buckets}[$__range])))`,
    total4xxByEndpoint: `sum by (endpoint) (increase(http_requests_received_total{${sel},code="4xx"}[$__range]))`,
    total5xxByEndpoint: `sum by (endpoint) (increase(http_requests_received_total{${sel},code="5xx"}[$__range]))`,
  };
}
