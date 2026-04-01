import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOverview,
  getVendorMetrics,
  getVendorAsins,
  getAdvertising,
  getForecasting,
  getCogsEntries,
  getCogsMargins,
  upsertCogsEntry,
} from '../api/client';

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

// Serialise range object for use as a stable query key
function rangeKey(range) {
  if (!range) return '12w';
  if (range.type === 'custom') return `custom:${range.start}:${range.end}`;
  return range.type || '12w';
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
