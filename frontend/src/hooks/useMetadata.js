import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getMetadata } from '../api.js';

// Build a globally-unique key for a field: `{dataset_id}:{field}`.
// Two datasets can share a field name (e.g. both mapped to canonical
// `cost_center`); the uniqueKey disambiguates them in the UI state so the
// pivot request routes to the correct dataset.
export function makeFieldKey(datasetId, field) {
  return `${datasetId}:${field}`;
}

export function parseFieldKey(key) {
  if (!key) return { dataset_id: '', field: '' };
  const idx = key.indexOf(':');
  if (idx < 0) return { dataset_id: '', field: key };
  return { dataset_id: key.slice(0, idx), field: key.slice(idx + 1) };
}

export function useMetadata(modelId) {
  const query = useQuery({
    queryKey: ['metadata', modelId],
    queryFn: () => getMetadata(modelId),
    enabled: !!modelId,
    staleTime: 60_000,
  });

  // Flatten datasets' dimensions and measures into top-level arrays so
  // FieldManager/FilterManager can list every selectable field across all
  // datasets. Each entry gets a uniqueKey that embeds its dataset_id, so
  // fields with the same name from different datasets stay distinct.
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const raw = query.data;
    const datasets = raw.datasets || [];

    const dims = [];
    const measures = [];
    for (const ds of datasets) {
      const dsName = ds.name || ds.id;
      for (const d of (ds.dimensions || [])) {
        dims.push({
          ...d,
          uniqueKey: makeFieldKey(ds.id, d.field),
          _dataset_name: dsName,
          _dataset_id: ds.id,
        });
      }
      for (const m of (ds.measures || [])) {
        measures.push({
          ...m,
          uniqueKey: makeFieldKey(ds.id, m.field),
          _dataset_name: dsName,
          _dataset_id: ds.id,
        });
      }
    }

    // Disambiguate labels when the same field name appears in multiple
    // datasets — append "(DatasetName)" so the dropdown stays unambiguous.
    const fieldCount = new Map();
    for (const d of dims) fieldCount.set(d.field, (fieldCount.get(d.field) || 0) + 1);
    const disambiguatedDims = dims.map((d) =>
      fieldCount.get(d.field) > 1 && d._dataset_name
        ? { ...d, label: `${d.label || d.field} (${d._dataset_name})` }
        : d
    );

    const measFieldCount = new Map();
    for (const m of measures) measFieldCount.set(m.field, (measFieldCount.get(m.field) || 0) + 1);
    const disambiguatedMeasures = measures.map((m) =>
      measFieldCount.get(m.field) > 1 && m._dataset_name
        ? { ...m, label: `${m.label || m.field} (${m._dataset_name})` }
        : m
    );

    // Back-compat: first-seen dataset per bare field name. Consumers that
    // look up a known-unique field like `year` (owned by the calendar)
    // still rely on this map. New code should prefer uniqueKey on each
    // dimension/measure entry.
    const fieldDatasetMap = {};
    for (const d of dims) {
      if (!(d.field in fieldDatasetMap)) fieldDatasetMap[d.field] = d._dataset_id;
    }
    for (const m of measures) {
      if (!(m.field in fieldDatasetMap)) fieldDatasetMap[m.field] = m._dataset_id;
    }

    return {
      ...raw,
      dimensions: disambiguatedDims,
      measures: disambiguatedMeasures,
      fieldDatasetMap,
    };
  }, [query.data]);

  return { ...query, data };
}

export default useMetadata;
