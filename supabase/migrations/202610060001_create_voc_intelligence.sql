-- VOC storage foundation only. Apply manually; no import or AI analysis is run.
-- products.id is bigint, matching the existing product_assets migration.
BEGIN;

CREATE TABLE public.review_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  file_name text,
  source text,
  total_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  skipped_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_import_batches_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX review_import_batches_product_id_idx
  ON public.review_import_batches (product_id);

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  import_batch_id uuid REFERENCES public.review_import_batches(id) ON DELETE SET NULL,
  source text,
  external_id text,
  reviewer_name text,
  rating integer,
  title text,
  content text NOT NULL,
  review_date timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

CREATE INDEX reviews_product_id_idx ON public.reviews (product_id);
CREATE INDEX reviews_import_batch_id_idx ON public.reviews (import_batch_id);
CREATE INDEX reviews_review_date_idx ON public.reviews (review_date);
CREATE INDEX reviews_rating_idx ON public.reviews (rating);

-- Reviews without external IDs remain unrestricted. Treat a missing source as
-- its own namespace, without sentinel values or PostgreSQL-version-specific syntax.
CREATE UNIQUE INDEX reviews_product_source_external_id_uidx
  ON public.reviews (product_id, source, external_id)
  WHERE external_id IS NOT NULL AND source IS NOT NULL;
CREATE UNIQUE INDEX reviews_product_external_id_without_source_uidx
  ON public.reviews (product_id, external_id)
  WHERE external_id IS NOT NULL AND source IS NULL;

CREATE TABLE public.voc_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  review_count integer NOT NULL DEFAULT 0,
  model text,
  schema_version text,
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voc_analysis_runs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX voc_analysis_runs_product_id_idx
  ON public.voc_analysis_runs (product_id);

-- Match existing development anon CRUD policies and timestamp defaults.
-- updated_at is maintained by writers, as with product_assets; no trigger added.
ALTER TABLE public.review_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voc_analysis_runs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.review_import_batches, public.reviews, public.voc_analysis_runs TO anon;

CREATE POLICY review_import_batches_anon_select
  ON public.review_import_batches FOR SELECT TO anon USING (true);
CREATE POLICY review_import_batches_anon_insert
  ON public.review_import_batches FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY review_import_batches_anon_update
  ON public.review_import_batches FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY review_import_batches_anon_delete
  ON public.review_import_batches FOR DELETE TO anon USING (true);

CREATE POLICY reviews_anon_select
  ON public.reviews FOR SELECT TO anon USING (true);
CREATE POLICY reviews_anon_insert
  ON public.reviews FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY reviews_anon_update
  ON public.reviews FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY reviews_anon_delete
  ON public.reviews FOR DELETE TO anon USING (true);

CREATE POLICY voc_analysis_runs_anon_select
  ON public.voc_analysis_runs FOR SELECT TO anon USING (true);
CREATE POLICY voc_analysis_runs_anon_insert
  ON public.voc_analysis_runs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY voc_analysis_runs_anon_update
  ON public.voc_analysis_runs FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY voc_analysis_runs_anon_delete
  ON public.voc_analysis_runs FOR DELETE TO anon USING (true);

COMMIT;
