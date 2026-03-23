import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listDashboards, createDashboard, getDashboard, updateDashboard, deleteDashboard,
  createWidget, updateWidget, deleteWidget, updateDashboardLayout,
} from '../api.js';

export function useDashboards(modelId) {
  return useQuery({
    queryKey: ['dashboards', modelId],
    queryFn: () => listDashboards(modelId),
    enabled: !!modelId,
  });
}

export function useDashboard(dashboardId) {
  return useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => getDashboard(dashboardId),
    enabled: !!dashboardId,
  });
}

export function useCreateDashboard(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => createDashboard(modelId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards', modelId] }),
  });
}

export function useDeleteDashboard(modelId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteDashboard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards', modelId] }),
  });
}

export function useCreateWidget(dashboardId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => createWidget(dashboardId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  });
}

export function useUpdateWidget(dashboardId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => updateWidget(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  });
}

export function useDeleteWidget(dashboardId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteWidget(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  });
}

export function useSaveLayout(dashboardId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (widgets) => updateDashboardLayout(dashboardId, widgets),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  });
}
