-- Apply AFTER the product_assets table migration, via Supabase SQL Editor.
-- Public bucket: product image thumbnails use getPublicUrl(). No remote changes are automatic.
BEGIN;

INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES (
  'product-assets', 'product-assets', true,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Match the existing development anon access. Uploads cannot overwrite existing files.
-- Public reads need no SELECT policy. No file deletion/update feature is introduced.
CREATE POLICY product_assets_storage_anon_insert
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'product-assets'
    AND (storage.foldername(storage.objects.name))[1] = 'products'
    AND EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id::text = (storage.foldername(storage.objects.name))[2]
    )
  );

COMMIT;
