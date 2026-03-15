import {
  fetchSquareCatalog,
  syncToSupabase,
} from '../_shared/square.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const squareToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
    if (!squareToken) {
      return new Response(
        JSON.stringify({ error: 'SQUARE_ACCESS_TOKEN not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch live catalog from Square
    const items = await fetchSquareCatalog(squareToken);

    // Also sync prices into Supabase (fire-and-forget for speed)
    syncToSupabase(items).catch(() => {});

    return new Response(
      JSON.stringify({ items, synced_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
