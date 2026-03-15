import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface SquareCatalogItem {
  squareItemId: string;
  name: string;
  description: string;
  price: string;
  priceAmount: number;
  durationMinutes: number;
  duration: string;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes === 0) return 'Consult';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

/** Fetch all bookable appointment services from Square Catalog API. */
export async function fetchSquareCatalog(
  squareToken: string
): Promise<SquareCatalogItem[]> {
  const allObjects: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL('https://connect.squareup.com/v2/catalog/list');
    url.searchParams.set('types', 'ITEM');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
      },
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Square API ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    allObjects.push(...(data.objects || []));
    cursor = data.cursor;
  } while (cursor);

  return allObjects
    .filter((obj: any) =>
      obj.item_data?.variations?.some(
        (v: any) => v.item_variation_data?.available_for_booking
      )
    )
    .map((obj: any) => {
      const itemData = obj.item_data;
      const bookableVar = itemData.variations.find(
        (v: any) => v.item_variation_data?.available_for_booking
      );
      const vd = bookableVar.item_variation_data;
      const priceAmount = vd.price_money?.amount || 0;
      const durationMs = vd.service_duration || 0;

      return {
        squareItemId: obj.id,
        name: itemData.name || '',
        description:
          itemData.description_plaintext || itemData.description || '',
        price: `$${(priceAmount / 100).toFixed(2)}`,
        priceAmount,
        durationMinutes: Math.round(durationMs / 60000),
        duration: formatDuration(durationMs),
      };
    });
}

// ── Smart fuzzy matching ─────────────────────────────────────

const toWords = (n: string): string[] =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Levenshtein edit distance between two strings. */
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

/** Check if two words are "close enough" (exact or edit distance ≤ 2). */
function wordsClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  return editDistance(a, b) <= 2;
}

/**
 * Score how well two service names match (0 – 1).
 * Uses word overlap with Levenshtein tolerance.
 * A score ≥ 0.6 is considered a match.
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

  // Score = matched words / shorter name's word count
  const shorter = Math.min(wordsA.length, wordsB.length);
  return matched / shorter;
}

const MATCH_THRESHOLD = 0.6;

/**
 * Sync Square catalog into Supabase service_items.
 *
 * - Existing items: updates price / duration from Square.
 * - New Square items (no match): auto-creates them in Supabase
 *   under the first available category.
 *
 * Returns { updated, added } counts.
 */
export async function syncToSupabase(
  squareItems: SquareCatalogItem[]
): Promise<{ updated: number; added: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return { updated: 0, added: 0 };

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch existing items and categories
  const [{ data: dbItems }, { data: categories }] = await Promise.all([
    supabase
      .from('service_items')
      .select('id, title, description, price, duration, square_item_id'),
    supabase
      .from('service_categories')
      .select('id')
      .order('sort_order', { ascending: true })
      .limit(1),
  ]);

  const defaultCategoryId = categories?.[0]?.id;
  const remaining = [...(dbItems || [])];
  let updated = 0;
  let added = 0;
  const unmatched: SquareCatalogItem[] = [];

  for (const sq of squareItems) {
    // Priority 1: exact square_item_id
    let matchIdx = remaining.findIndex(
      (db) => db.square_item_id === sq.squareItemId
    );

    // Priority 2: best fuzzy name match above threshold
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
      if (match.title !== sq.name) updates.title = sq.name;
      if (match.description !== sq.description) updates.description = sq.description;
      if (match.price !== sq.price) updates.price = sq.price;
      if (match.duration !== sq.duration) updates.duration = sq.duration;
      if (!match.square_item_id) updates.square_item_id = sq.squareItemId;

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('service_items')
          .update(updates)
          .eq('id', match.id);
        if (!error) updated++;
      }
    } else {
      unmatched.push(sq);
    }
  }

  // Auto-add new Square items to Supabase
  if (unmatched.length > 0 && defaultCategoryId) {
    const maxSort = (dbItems || []).length;
    const rows = unmatched.map((sq, i) => ({
      category_id: defaultCategoryId,
      title: sq.name,
      description: sq.description,
      price: sq.price,
      duration: sq.duration,
      square_item_id: sq.squareItemId,
      sort_order: maxSort + i,
    }));

    const { error } = await supabase.from('service_items').insert(rows);
    if (!error) added = rows.length;
  }

  return { updated, added };
}

// ── Helpers for Website → Square sync ────────────────────────

/** Parse a price string like "$55.00" or "$143" into cents (5500, 14300). */
export function parsePriceToCents(price: string): number {
  const cleaned = price.replace(/[^0-9.]/g, '');
  return Math.round(parseFloat(cleaned || '0') * 100);
}

/** Parse a duration string like "30 min", "1 hr 15 min", "1 hr" into milliseconds. */
export function parseDurationToMs(duration: string): number {
  const lower = duration.toLowerCase().trim();
  if (!lower || lower === 'consult') return 0;

  let totalMinutes = 0;
  const hrMatch = lower.match(/(\d+)\s*hr/);
  const minMatch = lower.match(/(\d+)\s*min/);
  if (hrMatch) totalMinutes += parseInt(hrMatch[1]) * 60;
  if (minMatch) totalMinutes += parseInt(minMatch[1]);

  return totalMinutes * 60 * 1000;
}

/**
 * Update a single Square catalog item's price and/or duration.
 * Fetches the current item first (to get the required `version`),
 * then upserts the change.
 */
export async function updateSquareItem(
  squareToken: string,
  squareItemId: string,
  newPrice?: string,
  newDuration?: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Fetch the current item from Square
  const getResp = await fetch(
    `https://connect.squareup.com/v2/catalog/object/${squareItemId}`,
    {
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
      },
    }
  );

  if (!getResp.ok) {
    const body = await getResp.text();
    return { success: false, error: `Failed to fetch item: ${body}` };
  }

  const { object } = await getResp.json();
  if (!object || !object.item_data) {
    return { success: false, error: 'Item not found in Square' };
  }

  // 2. Find the bookable variation and update it
  const variation = object.item_data.variations?.find(
    (v: any) => v.item_variation_data?.available_for_booking
  );

  if (!variation) {
    return { success: false, error: 'No bookable variation found' };
  }

  if (newPrice) {
    variation.item_variation_data.price_money = {
      amount: parsePriceToCents(newPrice),
      currency: 'USD',
    };
  }

  if (newDuration) {
    variation.item_variation_data.service_duration = parseDurationToMs(newDuration);
  }

  // 3. Upsert the updated item back to Square
  const upsertResp = await fetch(
    'https://connect.squareup.com/v2/catalog/object',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
      },
      body: JSON.stringify({
        idempotency_key: `${squareItemId}-${Date.now()}`,
        object,
      }),
    }
  );

  if (!upsertResp.ok) {
    const body = await upsertResp.text();
    return { success: false, error: `Failed to update Square: ${body}` };
  }

  return { success: true };
}
