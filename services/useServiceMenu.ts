import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SERVICE_CATEGORIES } from '../constants';
import { ServiceCategory, ServiceItem } from '../types';
import { getSupabaseClient } from './supabaseClient';
import { fetchSquareCatalog } from './squareService';

const normalizeFallback = (): ServiceCategory[] =>
  SERVICE_CATEGORIES.map((category) => ({
    id: category.id,
    title: category.title,
    description: category.description,
    items: category.items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      price: item.price,
      duration: item.duration
    }))
  }));

export const useServiceMenu = () => {
  const fallbackData = useMemo(() => normalizeFallback(), []);
  const [categories, setCategories] = useState<ServiceCategory[]>(fallbackData);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const squareSyncDone = useRef(false);

  const reload = useCallback(async () => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setUsingFallback(true);
      setCategories(fallbackData);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [{ data: categoryRows, error: categoryError }, { data: itemRows, error: itemError }] =
      await Promise.all([
        supabase
          .from('service_categories')
          .select('id,title,description,sort_order')
          .order('sort_order', { ascending: true, nullsFirst: true }),
        supabase
          .from('service_items')
          .select('id,category_id,title,description,price,duration,sort_order,square_item_id')
          .order('sort_order', { ascending: true, nullsFirst: true })
      ]);

    if (categoryError || itemError) {
      setUsingFallback(true);
      setCategories(fallbackData);
      setError(categoryError?.message || itemError?.message || 'Failed to load menu.');
      setLoading(false);
      return;
    }

    const itemsByCategory = new Map<string, ServiceItem[]>();

    (itemRows ?? []).forEach((row) => {
      if (!row.category_id) return;
      const list = itemsByCategory.get(row.category_id) ?? [];
      list.push({
        id: row.id,
        title: row.title ?? '',
        description: row.description ?? '',
        price: row.price ?? '',
        duration: row.duration ?? '',
        sortOrder: row.sort_order ?? undefined,
        squareItemId: row.square_item_id ?? undefined
      });
      itemsByCategory.set(row.category_id, list);
    });

    const normalizedCategories: ServiceCategory[] = (categoryRows ?? []).map((row) => ({
      id: row.id,
      title: row.title ?? '',
      description: row.description ?? '',
      sortOrder: row.sort_order ?? undefined,
      items: itemsByCategory.get(row.id) ?? []
    }));

    setUsingFallback(false);
    setCategories(normalizedCategories);
    setLoading(false);
  }, [fallbackData]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Background auto-sync from Square ──────────────────────────
  // After Supabase data loads, call the edge function which:
  //   1. Fetches live prices from Square
  //   2. Updates existing items in Supabase
  //   3. Auto-adds new Square items to Supabase
  // Then reload from Supabase so everything is up-to-date.
  useEffect(() => {
    if (loading || usingFallback || squareSyncDone.current) return;
    squareSyncDone.current = true;

    fetchSquareCatalog()
      .then(() => {
        // Edge function already synced to Supabase (updates + new items).
        // Reload from Supabase to pick up any changes.
        reload();
      })
      .catch(() => {
        // Silent fail – Supabase data is still displayed
      });
  }, [loading, usingFallback, reload]);

  return { categories, loading, error, usingFallback, reload };
};
