BEGIN;

CREATE TABLE public.blog_keyword_import_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  header_signature text NOT NULL UNIQUE CHECK (header_signature ~ '^[0-9a-f]{64}$'),
  mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  source_label text CHECK (length(source_label) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
DO $migration$
DECLARE product_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO STRICT product_type FROM pg_attribute
    WHERE attrelid = 'public.products'::regclass AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
  IF product_type NOT IN ('bigint', 'integer', 'smallint') THEN RAISE EXCEPTION 'Expected numeric Product ID'; END IF;
  EXECUTE format($table$
    CREATE TABLE public.blog_keyword_import_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id %s REFERENCES public.products(id) ON DELETE SET NULL,
      preset_id uuid REFERENCES public.blog_keyword_import_presets(id) ON DELETE SET NULL,
      source text, source_filename text NOT NULL,
      total_rows integer NOT NULL CHECK (total_rows >= 0), valid_rows integer NOT NULL CHECK (valid_rows >= 0),
      skipped_rows integer NOT NULL CHECK (skipped_rows >= 0), file_duplicate_rows integer NOT NULL CHECK (file_duplicate_rows >= 0),
      inserted_count integer NOT NULL CHECK (inserted_count >= 0), updated_count integer NOT NULL CHECK (updated_count >= 0),
      invalid_metric_cells integer NOT NULL CHECK (invalid_metric_cells >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (valid_rows + skipped_rows = total_rows),
      CHECK (inserted_count + updated_count = valid_rows - file_duplicate_rows)
    )
  $table$, product_type);
END;
$migration$;
CREATE INDEX blog_keyword_import_runs_created_idx ON public.blog_keyword_import_runs(created_at DESC, id DESC);

-- Preserve the existing internal-tool access boundary; no service-role key or file storage is added.
ALTER TABLE public.blog_keyword_import_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_keyword_import_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.blog_keyword_import_presets TO anon, authenticated;
GRANT SELECT, INSERT ON public.blog_keyword_import_runs TO anon, authenticated;
CREATE POLICY blog_keyword_import_presets_read ON public.blog_keyword_import_presets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY blog_keyword_import_presets_insert ON public.blog_keyword_import_presets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY blog_keyword_import_presets_update ON public.blog_keyword_import_presets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY blog_keyword_import_runs_read ON public.blog_keyword_import_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY blog_keyword_import_runs_insert ON public.blog_keyword_import_runs FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Count the actual UPSERT outcomes in the same batch transaction, never from Preview estimates.
CREATE FUNCTION public.import_blog_keywords_counted(p_product_id bigint, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected array'; END IF;
  IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'Expected <=500 rows'; END IF;
  WITH affected AS (
  INSERT INTO public.blog_keywords (product_id, keyword, normalized_keyword, search_volume, pc_search_volume, mobile_search_volume,
    pc_clicks, mobile_clicks, pc_ctr, mobile_ctr, competition, ad_count, source, source_filename, raw_data)
  SELECT p_product_id, r.keyword, public.normalize_blog_keyword(r.keyword), r.search_volume, r.pc_search_volume, r.mobile_search_volume,
    r.pc_clicks, r.mobile_clicks, r.pc_ctr, r.mobile_ctr, r.competition, r.ad_count, r.source, r.source_filename, r.raw_data
  FROM jsonb_to_recordset(p_rows) AS r(keyword text, search_volume numeric, pc_search_volume numeric, mobile_search_volume numeric,
    pc_clicks numeric, mobile_clicks numeric, pc_ctr numeric, mobile_ctr numeric, competition text, ad_count numeric, source text, source_filename text, raw_data jsonb)
  WHERE true
  ON CONFLICT (product_id, normalized_keyword) DO UPDATE SET
    search_volume = coalesce(EXCLUDED.search_volume, blog_keywords.search_volume),
    pc_search_volume = coalesce(EXCLUDED.pc_search_volume, blog_keywords.pc_search_volume),
    mobile_search_volume = coalesce(EXCLUDED.mobile_search_volume, blog_keywords.mobile_search_volume),
    pc_clicks = coalesce(EXCLUDED.pc_clicks, blog_keywords.pc_clicks), mobile_clicks = coalesce(EXCLUDED.mobile_clicks, blog_keywords.mobile_clicks),
    pc_ctr = coalesce(EXCLUDED.pc_ctr, blog_keywords.pc_ctr), mobile_ctr = coalesce(EXCLUDED.mobile_ctr, blog_keywords.mobile_ctr),
    competition = coalesce(EXCLUDED.competition, blog_keywords.competition), ad_count = coalesce(EXCLUDED.ad_count, blog_keywords.ad_count),
    source = coalesce(EXCLUDED.source, blog_keywords.source), source_filename = EXCLUDED.source_filename, raw_data = EXCLUDED.raw_data
    RETURNING (xmax = 0) AS inserted
  )
  SELECT jsonb_build_object('inserted_count', count(*) FILTER (WHERE inserted), 'updated_count', count(*) FILTER (WHERE NOT inserted))
    INTO result FROM affected;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_blog_keywords_counted(bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_blog_keywords_counted(bigint,jsonb) TO anon, authenticated;

-- Legacy callers retain the integer return contract; both APIs use the same UPSERT implementation.
CREATE OR REPLACE FUNCTION public.import_blog_keywords(p_product_id bigint, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  result := public.import_blog_keywords_counted(p_product_id, p_rows);
  RETURN (result->>'inserted_count')::integer + (result->>'updated_count')::integer;
END;
$$;

-- Apply before the updated Import API. On application rollback, retain these tables and the compatible RPC wrapper.
COMMIT;
