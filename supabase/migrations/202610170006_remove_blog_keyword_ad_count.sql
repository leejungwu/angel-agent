BEGIN;

-- Replace both import entry points before dropping the column. Original file columns remain in raw_data.
CREATE OR REPLACE FUNCTION public.import_blog_keywords_counted(p_product_id bigint, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected array'; END IF;
  IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'Expected <=500 rows'; END IF;
  WITH affected AS (
  INSERT INTO public.blog_keywords (product_id, keyword, normalized_keyword, search_volume, pc_search_volume, mobile_search_volume,
    pc_clicks, mobile_clicks, pc_ctr, mobile_ctr, competition, source, source_filename, raw_data)
  SELECT p_product_id, r.keyword, public.normalize_blog_keyword(r.keyword), r.search_volume, r.pc_search_volume, r.mobile_search_volume,
    r.pc_clicks, r.mobile_clicks, r.pc_ctr, r.mobile_ctr, r.competition, r.source, r.source_filename, r.raw_data
  FROM jsonb_to_recordset(p_rows) AS r(keyword text, search_volume numeric, pc_search_volume numeric, mobile_search_volume numeric,
    pc_clicks numeric, mobile_clicks numeric, pc_ctr numeric, mobile_ctr numeric, competition text, source text, source_filename text, raw_data jsonb)
  WHERE true
  ON CONFLICT (product_id, normalized_keyword) DO UPDATE SET
    search_volume = coalesce(EXCLUDED.search_volume, blog_keywords.search_volume),
    pc_search_volume = coalesce(EXCLUDED.pc_search_volume, blog_keywords.pc_search_volume),
    mobile_search_volume = coalesce(EXCLUDED.mobile_search_volume, blog_keywords.mobile_search_volume),
    pc_clicks = coalesce(EXCLUDED.pc_clicks, blog_keywords.pc_clicks), mobile_clicks = coalesce(EXCLUDED.mobile_clicks, blog_keywords.mobile_clicks),
    pc_ctr = coalesce(EXCLUDED.pc_ctr, blog_keywords.pc_ctr), mobile_ctr = coalesce(EXCLUDED.mobile_ctr, blog_keywords.mobile_ctr),
    competition = coalesce(EXCLUDED.competition, blog_keywords.competition),
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


ALTER TABLE public.blog_keywords DROP COLUMN ad_count;

-- Apply together with readers that no longer select ad_count. Keyword rows and other metrics are preserved.
-- Rollback to older readers requires restoring a nullable numeric column; dropped values require a backup to recover.
COMMIT;
