import { updateSquareItem } from '../_shared/square.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

/**
 * Edge function to push a price/duration change from the website
 * back to Square Appointments.
 *
 * POST body: {
 *   squareItemId: string,   // the Square catalog item ID
 *   price?: string,         // e.g. "$55.00"
 *   duration?: string       // e.g. "30 min"
 * }
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
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

    const body = await req.json();
    const { squareItemId, price, duration } = body;

    if (!squareItemId) {
      return new Response(
        JSON.stringify({ error: 'squareItemId is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!price && !duration) {
      return new Response(
        JSON.stringify({ error: 'At least one of price or duration is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const result = await updateSquareItem(
      squareToken,
      squareItemId,
      price,
      duration
    );

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        squareItemId,
        updated: { price, duration },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
