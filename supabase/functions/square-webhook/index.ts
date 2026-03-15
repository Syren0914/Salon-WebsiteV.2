import {
  fetchSquareCatalog,
  syncToSupabase,
} from '../_shared/square.ts';

/**
 * Square Webhook handler.
 *
 * Square sends a POST to this URL whenever the catalog changes
 * (event type: catalog.version.updated). This function fetches
 * the latest catalog from Square and syncs prices into Supabase.
 *
 * Register this URL in your Square Developer Dashboard under Webhooks:
 *   https://<project-ref>.supabase.co/functions/v1/square-webhook
 *
 * Subscribe to the event: catalog.version.updated
 */
Deno.serve(async (req: Request) => {
  // Square only sends POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();

    // Only act on catalog update events
    const eventType: string = body?.type || '';
    if (!eventType.startsWith('catalog.')) {
      return new Response(JSON.stringify({ ignored: true, event: eventType }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const squareToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
    if (!squareToken) {
      return new Response(
        JSON.stringify({ error: 'SQUARE_ACCESS_TOKEN not set' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch fresh catalog and sync to Supabase
    const items = await fetchSquareCatalog(squareToken);
    const updatedCount = await syncToSupabase(items);

    return new Response(
      JSON.stringify({
        success: true,
        event: eventType,
        items_found: items.length,
        items_updated: updatedCount,
        synced_at: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
