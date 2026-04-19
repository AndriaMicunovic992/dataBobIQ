import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getMetadata } from '../api.js';

export function useMetadata(modelId) {
  const query = useQuery({
    queryKey: ['metadata', modelId],
    queryFn: () => getMetadata(modelId),
    enabled: !!modelId,
    staleTime: 60_000,
  });

  // Flatten datasets' dimensions and measures into top-level arrays
  // so FieldManager/FilterManager can access metadata.dimensions / metadata.measures.
  // Each field is tagged with _dataset_name for grouping in the picker.
  //
  // Dimensions are kept per-dataset (composite key ds_id:field) so users can
  // pick columns from every table even when canonical names overlap. Measures
  // still dedup by field name since same-named measures represent the same
  // aggregation.
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const raw = query.data;
    const datasets = raw.datasets || [];

    const dims = [];
    const measMap = new Map();
    const fieldDatasetMap = {};
    for (const ds of datasets) {
      const dsName = ds.name || ds.id;
      for (const d of (ds.dimensions || [])) {
        dims.push({ ...d, _dataset_name: dsName, _dataset_id: ds.id });
        if (!(d.field in fieldDatasetMap)) {
          fieldDatasetMap[d.field] = ds.id;
        }
      }
      for (const m of (ds.measures || [])) {
        if (!measMap.has(m.field)) {
          measMap.set(m.field, { ...m, _dataset_name: dsName, _dataset_id: ds.id });
          fieldDatasetMap[m.field] = ds.id;
        }
      }
    }

    // Disambiguate dimension labels when the same field name appears
    // from multiple datasets — append "(DatasetName)" to the label.
    const dimFieldCount = new Map();
    for (const d of dims) {
      dimFieldCount.set(d.field, (dimFieldCount.get(d.field) || 0) + 1);
    }
    const disambiguatedDims = dims.map((d) => {
      if (dimFieldCount.get(d.field) > 1 && d._dataset_name) {
        return { ...d, label: `${d.label || d.field} (${d._dataset_name})` };
      }
      return d;
    });

    return {
      ...raw,
      dimensions: disambiguatedDims,
      measures: Array.from(measMap.values()),
      fieldDatasetMap,
    };
  }, [query.data]);

  return { ...query, data };
}

export default useMetadata;
