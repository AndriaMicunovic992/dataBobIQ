import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listWidgets, createWidget, updateWidget, deleteWidget } from '../api.js';

export function useWidgets(modelId) {
  return useQuery({
    queryKey: ['widgets', modelId],
    queryFn: () => listWidgets(modelId),
    enabled: !!modelId,
  });
}

export function useCreateWidget(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => createWidget(modelId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['widgets', modelId] }),
  });
}

export function useUpdateWidget(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => updateWidget(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['widgets', modelId] }),
  });
}

export function useDeleteWidget(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteWidget(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['widgets', modelId] }),
  });
}
