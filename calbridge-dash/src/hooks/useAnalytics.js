import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMarketplace } from '../context/MarketplaceContext';

export { useMarketplace };
import {
  getOverview,
  getVendorMetrics,
  getVendorAsins,
  getInventoryDetail,
  getPoSummary,
  getAdvertising,
  getAdvertisingTrend,
  getAdvertisingCampaigns,
  getSbVideo,
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
  getKeywordTargeting,
  getTargetingRollup,
  getDspSummary,
  getDspOrders,
} from '../api/client';

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

// Serialise range object for use as a stable query key
function rangeKey(range) {
  if (!range) return 'mtd';
  if (range.type === 'custom') return `custom:${range.start}:${range.end}`;
  return range.type || 'mtd';
}

export function useOverview(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['overview', rangeKey(range), activeMarketplace ?? 'US'],
    queryFn: () => getOverview(range, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useVendorMetrics(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['vendor', rangeKey(range), activeMarketplace ?? 'US'],
    queryFn: () => getVendorMetrics(range, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useVendorAsins(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['vendor-asins', rangeKey(range), activeMarketplace ?? 'US'],
    queryFn: () => getVendorAsins(range, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useAdvertising(range, channel) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['advertising', rangeKey(range), channel || 'all', activeMarketplace ?? 'US'],
    queryFn: () => getAdvertising(range, channel, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useAdvertisingTrend(range, channel) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['advertising-trend', rangeKey(range), channel || 'all', activeMarketplace ?? 'US'],
    queryFn: () => getAdvertisingTrend(range, channel, activeMarketplace),
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

export function useAsinPerformance(range, channel) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['asin-performance', rangeKey(range), channel || 'all', activeMarketplace ?? 'US'],
    queryFn: () => getAsinPerformance(range, channel, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useAdvertisingCampaigns(range, channel) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['advertising-campaigns', rangeKey(range), channel || 'all', activeMarketplace ?? 'US'],
    queryFn: () => getAdvertisingCampaigns(range, channel, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useSbVideo(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['sb-video', rangeKey(range), activeMarketplace ?? 'US'],
    queryFn: () => getSbVideo(range, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useKeywordTargeting(range, channel) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['keyword-targeting', rangeKey(range), channel || 'all', activeMarketplace ?? 'US'],
    queryFn: () => getKeywordTargeting(range, channel, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useTargetingRollup(range, channel) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['targeting-rollup', rangeKey(range), channel || 'all', activeMarketplace ?? 'US'],
    queryFn: () => getTargetingRollup(range, channel, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useDspSummary(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['dsp-summary', rangeKey(range), activeMarketplace ?? 'US'],
    queryFn: () => getDspSummary(range, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

export function useDspOrders(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  return useQuery({
    queryKey: ['dsp-orders', rangeKey(range), activeMarketplace ?? 'US'],
    queryFn: () => getDspOrders(range, activeMarketplace),
    staleTime: STALE_TIME,
    retry: 2,
  });
}

import { getConnections } from '../api/client';
export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: 1,
  });
}
