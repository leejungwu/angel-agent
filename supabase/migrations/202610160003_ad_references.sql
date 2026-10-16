BEGIN;

-- Products predates tracked migrations; preserve the installed numeric FK type.
DO $migration$
DECLARE product_id_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO STRICT product_id_type
    FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
  IF product_id_type NOT IN ('bigint', 'integer', 'smallint') THEN RAISE EXCEPTION 'Expected numeric products.id'; END IF;
  EXECUTE format($table$
    CREATE TABLE public.ad_references (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
      brand_name text NOT NULL CHECK (length(btrim(brand_name)) BETWEEN 1 AND 200),
      product_id %s REFERENCES public.products(id) ON DELETE SET NULL,
      platform text NOT NULL CHECK (platform IN ('meta','instagram','tiktok','youtube','other')),
      media_type text NOT NULL CHECK (media_type IN ('image','video','other')),
      source_url text CHECK (source_url IS NULL OR (length(source_url) <= 2048 AND source_url ~* '^https?://')),
      landing_url text CHECK (landing_url IS NULL OR (length(landing_url) <= 2048 AND landing_url ~* '^https?://')),
      asset_storage_path text,
      original_file_name text,
      tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 30),
      notes text CHECK (notes IS NULL OR length(notes) <= 20000),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((asset_storage_path IS NULL) = (original_file_name IS NULL))
    )
  $table$, product_id_type);
END;
$migration$;
CREATE INDEX ad_references_created_at_idx ON public.ad_references(created_at DESC);
CREATE INDEX ad_references_product_id_idx ON public.ad_references(product_id);
CREATE FUNCTION public.touch_ad_reference_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER ad_references_updated_at BEFORE UPDATE ON public.ad_references
  FOR EACH ROW EXECUTE FUNCTION public.touch_ad_reference_updated_at();

-- Same internal-tool access model as existing Product/Blog/KIN CRUD; not an admin authentication boundary.
ALTER TABLE public.ad_references ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_references TO anon, authenticated;
CREATE POLICY ad_references_select ON public.ad_references FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY ad_references_insert ON public.ad_references FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY ad_references_update ON public.ad_references FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY ad_references_delete ON public.ad_references FOR DELETE TO anon, authenticated USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ad-reference-assets', 'ad-reference-assets', false, 52428800,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
CREATE POLICY ad_reference_assets_select ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'ad-reference-assets');
CREATE POLICY ad_reference_assets_insert ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'ad-reference-assets' AND (storage.foldername(name))[1] = 'references');
CREATE POLICY ad_reference_assets_delete ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'ad-reference-assets');

COMMIT;
