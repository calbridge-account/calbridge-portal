import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOverview,
  getVendorMetrics,
  getVendorAsins,
  getInventoryDetail,
  getPoSummary,
  getAdvertising,
  getForecasting,
  getForecastShift,
  getAnnualProjection,
  getCogsEntries,
  getCogsMargins,
  upsertCogsEntry,
  getBudgets,
  getBudgetCampaigns,
  getBudgetDetail,
  createBudget,
  updateBudget,
  deleteBudget,
  updateBudgetCampaigns,
  getAsinPerformance,
} from '../api/client';

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

// Serialise range object for use as a stable query key
function rangeKey(range) {
  if (!range) return 'mtd';
  if (range.type === 'custom') return `custom:${range.start}:${range.end}`;
  return range.type || 'mtd';
}

export function useOverview(range) {
  return useQuery({
    queryKey: ['overview', rangeKey(range)],
    queryFn: () => getOverview(range),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useVendorMetrics(range) {
  return useQuery({
    queryKey: ['vendor', rangeKey(range)],
    queryFn: () => getVendorMetrics(range),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useVendorAsins(range) {
  return useQuery({
    queryKey: ['vendor-asins', rangeKey(range)],
    queryFn: () => getVendorAsins(range),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useAdvertising(range) {
  return useQuery({
    queryKey: ['advertising', rangeKey(range)],
    queryFn: () => getAdvertising(range),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useForecasting(range) {
  return useQuery({
    queryKey: ['forecasting', rangeKey(range)],
    queryFn: () => getForecasting(range),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useCogsEntries() {
  return useQuery({
    queryKey: ['cogs-entries'],
    queryFn: getCogsEntries,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useCogsMargins() {
  return useQuery({
    queryKey: ['cogs-margins'],
    queryFn: getCogsMargins,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useForecastShift(asin) {
  return useQuery({
    queryKey: ['forecast-shift', asin || 'all'],
    queryFn: () => getForecastShift(asin),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useAnnualProjection() {
  return useQuery({
    queryKey: ['annual-projection'],
    queryFn: getAnnualProjection,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useUpsertCogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertCogsEntry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cogs-entries'] });
      qc.invalidateQueries({ queryKey: ['cogs-margins'] });
    },
  });
}

// ─── Budget Tracker hooks ──────────────────────────────────────────────────

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: getBudgets,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useBudgetCampaigns() {
  return useQuery({
    queryKey: ['budget-campaigns'],
    queryFn: getBudgetCampaigns,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBudget,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => updateBudget(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteBudget,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudgetCampaigns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, campaigns }) => updateBudgetCampaigns(id, campaigns),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useInventoryDetail() {
  return useQuery({
    queryKey: ['inventory-detail'],
    queryFn: getInventoryDetail,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function usePoSummary() {
  return useQuery({
    queryKey: ['po-summary'],
    queryFn: getPoSummary,
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useAsinPerformance(range, adType) {
  return useQuery({
    queryKey: ['asin-performance', rangeKey(range), adType || 'all'],
    queryFn: () => getAsinPerformance(range, adType),
    staleTime: STALE_TIME,
    retry: 2,
  });
}
