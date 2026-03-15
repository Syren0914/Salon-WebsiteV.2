import { getSupabaseClient } from './supabaseClient';

export interface SquareItem {
  squareItemId: string;
  name: string;
  description: string;
  price: string;
  priceAmount: number;
  durationMinutes: number;
  duration: string;
}

export interface SyncChange {
  name: string;
  oldPrice: string;
  newPrice: string;
  oldDuration: string;
  newDuration: string;
}

export interface SyncResult {
  updated: SyncChange[];
  linked: string[];
  added: string[];
  errors: string[];
}

/** Fetch the full Square catalog via the Supabase Edge Function. */
export const fetchSquareCatalog = async (): Promise<SquareItem[]> => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.functions.invoke('square-catalog');
  if (error) throw new Error(error.message || 'Failed to fetch Square catalog');
  return data?.items || [];
};

// ── Smart fuzzy matching ─────────────────────────────────────

const toWords = (n: string): string[] =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Levenshtein edit distance. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Two words are close if exact or edit distance ≤ 2. */
function wordsClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  return editDistance(a, b) <= 2;
}

/**
 * Score how well two service names match (0 – 1).
 * Uses word overlap with Levenshtein tolerance.
 */
export function nameMatchScore(nameA: string, nameB: string): number {
  const wordsA = toWords(nameA);
  const wordsB = toWords(nameB);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const usedB = new Set<number>();
  let matched = 0;

  for (const wa of wordsA) {
    for (let j = 0; j < wordsB.length; j++) {
      if (usedB.has(j)) continue;
      if (wordsClose(wa, wordsB[j])) {
        matched++;
        usedB.add(j);
        break;
      }
    }
  }

  return matched / Math.min(wordsA.length, wordsB.length);
}

const MATCH_THRESHOLD = 0.6;

/**
 * Fetch the Square catalog and sync to Supabase.
 *
 * - Matched items: updates price / duration from Square.
 * - New Square items: auto-adds them to the first category.
 */
export const syncSquarePrices = async (): Promise<SyncResult> => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const result: SyncResult = {
    updated: [],
    linked: [],
    added: [],
    errors: [],
  };

  // 1. Fetch Square catalog via edge function
  let squareItems: SquareItem[];
  try {
    squareItems = await fetchSquareCatalog();
  } catch (err: any) {
    result.errors.push(`Square fetch failed: ${err.message}`);
    return result;
  }

  // 2. Fetch current service items + categories from Supabase
  const [{ data: dbItems, error: dbError }, { data: categories }] =
    await Promise.all([
      supabase
        .from('service_items')
        .select('id, title, description, price, duration, square_item_id'),
      supabase
        .from('service_categories')
        .select('id')
        .order('sort_order', { ascending: true })
        .limit(1),
    ]);

  if (dbError) {
    result.errors.push(`Database error: ${dbError.message}`);
    return result;
  }

  const defaultCategoryId = categories?.[0]?.id;
  const remaining = [...(dbItems || [])];
  const unmatchedSquare: SquareItem[] = [];

  // 3. Match and update existing items
  for (const sq of squareItems) {
    let matchIdx = remaining.findIndex(
      (db) => db.square_item_id === sq.squareItemId
    );

    if (matchIdx === -1) {
      let bestScore = 0;
      let bestIdx = -1;
      for (let i = 0; i < remaining.length; i++) {
        const score = nameMatchScore(sq.name, remaining[i].title);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestScore >= MATCH_THRESHOLD) matchIdx = bestIdx;
    }

    if (matchIdx !== -1) {
      const match = remaining[matchIdx];
      remaining.splice(matchIdx, 1);

      const updates: Record<string, string> = {};
      let changed = false;

      if (match.title !== sq.name) {
        updates.title = sq.name;
        changed = true;
      }
      if (match.description !== sq.description) {
        updates.description = sq.description;
        changed = true;
      }
      if (match.price !== sq.price) {
        updates.price = sq.price;
        changed = true;
      }
      if (match.duration !== sq.duration) {
        updates.duration = sq.duration;
        changed = true;
      }
      if (!match.square_item_id) {
        updates.square_item_id = sq.squareItemId;
        result.linked.push(sq.name);
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('service_items')
          .update(updates)
          .eq('id', match.id);

        if (updateError) {
          result.errors.push(
            `Failed to update "${sq.name}": ${updateError.message}`
          );
        } else if (changed) {
          result.updated.push({
            name: sq.name,
            oldPrice: match.price,
            newPrice: sq.price,
            oldDuration: match.duration,
            newDuration: sq.duration,
          });
        }
      }
    } else {
      unmatchedSquare.push(sq);
    }
  }

  // 4. Auto-add new Square items to Supabase
  if (unmatchedSquare.length > 0 && defaultCategoryId) {
    const maxSort = (dbItems || []).length;
    for (let i = 0; i < unmatchedSquare.length; i++) {
      const sq = unmatchedSquare[i];
      const { error: insertError } = await supabase
        .from('service_items')
        .insert({
          category_id: defaultCategoryId,
          title: sq.name,
          description: sq.description,
          price: sq.price,
          duration: sq.duration,
          square_item_id: sq.squareItemId,
          sort_order: maxSort + i,
        });

      if (insertError) {
        result.errors.push(`Failed to add "${sq.name}": ${insertError.message}`);
      } else {
        result.added.push(sq.name);
      }
    }
  }

  return result;
};

/**
 * Push a price/duration change from the website back to Square.
 * Calls the square-update edge function which handles the Square API.
 */
export const pushToSquare = async (
  squareItemId: string,
  price?: string,
  duration?: string
): Promise<{ success: boolean; error?: string }> => {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const { data, error } = await supabase.functions.invoke('square-update', {
    body: { squareItemId, price, duration },
  });

  if (error) {
    return { success: false, error: error.message || 'Failed to update Square' };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return { success: true };
};
