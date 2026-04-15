import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listScenarios,
  getScenario,
  createScenario,
  deleteScenario,
  addRule,
  updateRule,
  deleteRule,
  recompute,
  getVariance,
  getWaterfall,
} from '../api.js';

export function useScenarios(modelId) {
  return useQuery({
    queryKey: ['scenarios', modelId],
    queryFn: () => listScenarios(modelId),
    enabled: !!modelId,
  });
}

export function useScenario(scenarioId) {
  return useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => getScenario(scenarioId),
    enabled: !!scenarioId,
  });
}

export function useCreateScenario(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => createScenario(modelId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios', modelId] }),
  });
}

export function useDeleteScenario(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteScenario(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios', modelId] }),
  });
}

export function useAddRule(scenarioId, modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule) => addRule(scenarioId, rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenario', scenarioId] });
      if (modelId) qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
    },
  });
}

export function useUpdateRule(scenarioId, modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, data }) => updateRule(scenarioId, ruleId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenario', scenarioId] });
      if (modelId) qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
    },
  });
}

export function useDeleteRule(scenarioId, modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleId) => deleteRule(scenarioId, ruleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenario', scenarioId] });
      if (modelId) qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
    },
  });
}

export function useRecompute(scenarioId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => recompute(scenarioId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenario', scenarioId] });
      qc.invalidateQueries({ queryKey: ['variance', scenarioId] });
      qc.invalidateQueries({ queryKey: ['waterfall', scenarioId] });
    },
  });
}

export function useVariance(scenarioId, params) {
  return useQuery({
    queryKey: ['variance', scenarioId, params],
    queryFn: () => getVariance(scenarioId, params),
    enabled: !!scenarioId,
  });
}

export function useWaterfall(scenarioId, params) {
  return useQuery({
    queryKey: ['waterfall', scenarioId, params],
    queryFn: () => getWaterfall(scenarioId, params),
    enabled: !!scenarioId && !!params,
  });
}

export default useScenarios;
