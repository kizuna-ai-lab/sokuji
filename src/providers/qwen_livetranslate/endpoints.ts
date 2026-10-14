/**
 * Qwen LiveTranslate's two storefronts (spec 2026-10-13, §2; D2): one
 * Alibaba realtime protocol behind each, and a key good on one only — the
 * other answers 401. The check finds which; nothing else chooses. Pure data,
 * read by the adapter, the check and the settings view.
 */
export const ENDPOINTS = {
  intl: { name: 'QwenCloud', socket: 'wss://maas.qwencloudapi.com/api-ws/v1/realtime', tokens: 'https://maas.qwencloudapi.com/api/v1/tokens' },
  cn: { name: '千问云', socket: 'wss://maas.qianwenaiapi.com/api-ws/v1/realtime', tokens: 'https://maas.qianwenaiapi.com/api/v1/tokens' },
} as const;

export type EndpointId = keyof typeof ENDPOINTS;

/** The order detection asks them in: international first. */
export const ENDPOINT_ORDER: readonly EndpointId[] = ['intl', 'cn'];

export function isEndpointId(v: unknown): v is EndpointId {
  return v === 'intl' || v === 'cn';
}
