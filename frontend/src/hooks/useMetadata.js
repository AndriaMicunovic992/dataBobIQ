import { useQuery } from '@tanstack/react-query';
import { getMetadata } from '../api.js';

export function useMetadata(modelId) {
  return useQuery({
    queryKey: ['metadata', modelId],
    queryFn: () => getMetadata(modelId),
    enabled: !!modelId,
    staleTime: 60_000,
  });
}

export default useMetadata;
