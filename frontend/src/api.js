const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

function json(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Models
export const createModel = (data) => req('/models', json(data));
export const listModels = () => req('/models');
export const getModel = (id) => req(`/models/${id}`);
export const updateModel = (id, data) =>
  req(`/models/${id}`, { ...json(data), method: 'PUT' });
export const deleteModel = (id) => req(`/models/${id}`, { method: 'DELETE' });

// Datasets
export const uploadDataset = (modelId, file, dataLayer = 'actuals') => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('data_layer', dataLayer);
  return req(`/models/${modelId}/datasets/upload`, { method: 'POST', body: fd });
};
export const listDatasets = (modelId) => req(`/models/${modelId}/datasets`);
export const getDataset = (id) => req(`/datasets/${id}`);
export const deleteDataset = (id) => req(`/datasets/${id}`, { method: 'DELETE' });
export const confirmMapping = (id, config) =>
  req(`/datasets/${id}/confirm-mapping`, json(config));

// Metadata & Pivot
export const getMetadata = (modelId) => req(`/models/${modelId}/metadata`);
export const executePivot = (config) => req('/pivot', json(config));

// Scenarios
export const createScenario = (modelId, data) =>
  req(`/models/${modelId}/scenarios`, json(data));
export const listScenarios = (modelId) => req(`/models/${modelId}/scenarios`);
export const getScenario = (id) => req(`/scenarios/${id}`);
export const deleteScenario = (id) => req(`/scenarios/${id}`, { method: 'DELETE' });
export const addRule = (scenarioId, rule) =>
  req(`/scenarios/${scenarioId}/rules`, json(rule));
export const deleteRule = (scenarioId, ruleId) =>
  req(`/scenarios/${scenarioId}/rules/${ruleId}`, { method: 'DELETE' });
export const recompute = (id) => req(`/scenarios/${id}/recompute`, { method: 'POST' });
export const getVariance = (id, params) =>
  req(`/scenarios/${id}/variance?${new URLSearchParams(params)}`);
export const getWaterfall = (id, params) =>
  req(`/scenarios/${id}/waterfall?${new URLSearchParams(params)}`);

// KPIs
export const listKPIs = (modelId) => req(`/models/${modelId}/kpis`);
export const createKPI = (modelId, data) => req(`/models/${modelId}/kpis`, json(data));
export const evaluateKPIs = (modelId, data) =>
  req(`/models/${modelId}/kpis/evaluate`, json(data));

// Knowledge
export const listKnowledge = (modelId) => req(`/models/${modelId}/knowledge`);
export const createKnowledge = (modelId, data) =>
  req(`/models/${modelId}/knowledge`, json(data));
export const deleteKnowledge = (id) => req(`/knowledge/${id}`, { method: 'DELETE' });

// SSE streaming chat
export function streamChat(modelId, body, onEvent) {
  const controller = new AbortController();

  fetch(`${BASE}/models/${modelId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        onEvent({ type: 'error', data: err.detail || 'Chat request failed' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          onEvent({ type: 'done' });
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete last line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') {
              onEvent({ type: 'done' });
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              onEvent(parsed);
            } catch {
              // Non-JSON data line, skip
            }
          } else if (line.startsWith('event: ')) {
            // SSE event type — handled via data lines
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', data: err.message });
      }
    });

  return () => controller.abort();
}
