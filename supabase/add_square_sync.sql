-- Add square_item_id column for linking website services to Square catalog items
ALTER TABLE service_items ADD COLUMN IF NOT EXISTS square_item_id TEXT;

-- Index for faster lookups during sync
CREATE INDEX IF NOT EXISTS idx_service_items_square_id ON service_items(square_item_id);

-- Allow the column to be updated via RLS (uses same admin policy as other columns)
-- No additional RLS changes needed if existing policies allow UPDATE on all columns.
