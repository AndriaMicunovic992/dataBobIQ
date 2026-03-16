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
  // so FieldManager can access metadata.dimensions / metadata.measures directly.
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const raw = query.data;
    const datasets = raw.datasets || [];

    // Merge dimensions and measures across all datasets, deduplicating by field name
    const dimMap = new Map();
    const measMap = new Map();
    for (const ds of datasets) {
      for (const d of (ds.dimensions || [])) {
        if (!dimMap.has(d.field)) dimMap.set(d.field, { ...d, dataset_id: ds.id });
      }
      for (const m of (ds.measures || [])) {
        if (!measMap.has(m.field)) measMap.set(m.field, { ...m, dataset_id: ds.id });
      }
    }

    return {
      ...raw,
      dimensions: Array.from(dimMap.values()),
      measures: Array.from(measMap.values()),
    };
  }, [query.data]);

  return { ...query, data };
}

export default useMetadata;
