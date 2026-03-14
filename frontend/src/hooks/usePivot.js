import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { executePivot } from '../api.js';

function isConfigValid(config) {
  if (!config) return false;
  if (!config.model_id) return false;
  if (!config.values || config.values.length === 0) return false;
  return true;
}

export function usePivot(pivotConfig) {
  const [debouncedConfig, setDebouncedConfig] = useState(pivotConfig);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedConfig(pivotConfig);
    }, 300);
    return () => clearTimeout(timer);
  }, [JSON.stringify(pivotConfig)]);

  return useQuery({
    queryKey: ['pivot', debouncedConfig],
    queryFn: () => executePivot(debouncedConfig),
    enabled: isConfigValid(debouncedConfig),
    keepPreviousData: true,
    staleTime: 10_000,
  });
}

export default usePivot;
