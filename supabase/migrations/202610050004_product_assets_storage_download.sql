-- Requires the existing public.product_assets table (id, product_id, asset_type,
-- sort_order, storage_path). This internal app uses the publishable/anon client.
-- Run in Supabase SQL Editor before using product image downloads.
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-assets', 'product-assets', false)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.product_assets TO anon, authenticated;

DROP POLICY IF EXISTS product_assets_publisher_image_read ON public.product_assets;
CREATE POLICY product_assets_publisher_image_read ON public.product_assets
  FOR SELECT TO anon, authenticated USING (asset_type = 'image');

DROP POLICY IF EXISTS product_assets_storage_download ON storage.objects;
CREATE POLICY product_assets_storage_download ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'product-assets'
    AND EXISTS (
      SELECT 1 FROM public.product_assets AS asset
      WHERE asset.asset_type = 'image' AND asset.storage_path = name
    )
  );

COMMIT;
