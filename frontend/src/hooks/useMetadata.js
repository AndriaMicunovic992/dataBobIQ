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
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const raw = query.data;
    const datasets = raw.datasets || [];

    const dimMap = new Map();
    const measMap = new Map();
    // Build a field→dataset_id lookup so pivot knows which dataset owns each field
    const fieldDatasetMap = {};
    for (const ds of datasets) {
      const dsName = ds.name || ds.id;
      for (const d of (ds.dimensions || [])) {
        if (!dimMap.has(d.field)) dimMap.set(d.field, { ...d, _dataset_name: dsName, _dataset_id: ds.id });
        fieldDatasetMap[d.field] = ds.id;
      }
      for (const m of (ds.measures || [])) {
        if (!measMap.has(m.field)) measMap.set(m.field, { ...m, _dataset_name: dsName, _dataset_id: ds.id });
        fieldDatasetMap[m.field] = ds.id;
      }
    }

    return {
      ...raw,
      dimensions: Array.from(dimMap.values()),
      measures: Array.from(measMap.values()),
      fieldDatasetMap,
    };
  }, [query.data]);

  return { ...query, data };
}

export default useMetadata;
