BEGIN;

CREATE FUNCTION public.normalize_blog_keyword(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT lower(btrim(regexp_replace(replace(value, chr(160), ' '), E'[ \t\r\n\f\013]+', ' ', 'g')));
$$;
DO $migration$
DECLARE product_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO STRICT product_type FROM pg_attribute
    WHERE attrelid = 'public.products'::regclass AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
  IF product_type NOT IN ('bigint', 'integer', 'smallint') THEN RAISE EXCEPTION 'Expected numeric Product ID'; END IF;
  EXECUTE format($table$
    CREATE TABLE public.blog_keywords (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id %s NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      keyword text NOT NULL CHECK (length(keyword) BETWEEN 1 AND 500),
      normalized_keyword text NOT NULL CHECK (length(normalized_keyword) > 0),
      search_volume numeric CHECK (search_volume >= 0),
      pc_search_volume numeric CHECK (pc_search_volume >= 0), mobile_search_volume numeric CHECK (mobile_search_volume >= 0),
      pc_clicks numeric CHECK (pc_clicks >= 0), mobile_clicks numeric CHECK (mobile_clicks >= 0),
      pc_ctr numeric CHECK (pc_ctr >= 0), mobile_ctr numeric CHECK (mobile_ctr >= 0),
      competition text, ad_count numeric CHECK (ad_count >= 0),
      status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used','excluded')),
      source text, source_filename text, raw_data jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(product_id, normalized_keyword)
    )
  $table$, product_type);
END;
$migration$;
CREATE INDEX blog_keywords_product_status_idx ON public.blog_keywords(product_id, status);
CREATE INDEX blog_keywords_volume_idx ON public.blog_keywords(search_volume DESC NULLS LAST, id);
CREATE INDEX blog_keywords_created_idx ON public.blog_keywords(created_at DESC, id);
ALTER TABLE public.blog_tasks ADD COLUMN blog_keyword_id uuid REFERENCES public.blog_keywords(id) ON DELETE SET NULL;
CREATE INDEX blog_tasks_keyword_idx ON public.blog_tasks(blog_keyword_id);

CREATE FUNCTION public.prepare_blog_keyword() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.normalized_keyword = public.normalize_blog_keyword(NEW.keyword);
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER blog_keywords_prepare BEFORE INSERT OR UPDATE ON public.blog_keywords FOR EACH ROW EXECUTE FUNCTION public.prepare_blog_keyword();

-- Same internal-tool access boundary as existing Blog CRUD; no service-role key is added.
ALTER TABLE public.blog_keywords ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.blog_keywords TO anon, authenticated;
CREATE POLICY blog_keywords_read ON public.blog_keywords FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY blog_keywords_insert ON public.blog_keywords FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY blog_keywords_update ON public.blog_keywords FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Each batch is transactional. Conflict updates intentionally omit status and original keyword text.
CREATE FUNCTION public.import_blog_keywords(p_product_id bigint, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'Expected <=500 rows'; END IF;
  INSERT INTO public.blog_keywords (product_id, keyword, normalized_keyword, search_volume, pc_search_volume, mobile_search_volume,
    pc_clicks, mobile_clicks, pc_ctr, mobile_ctr, competition, ad_count, source, source_filename, raw_data)
  SELECT p_product_id, r.keyword, public.normalize_blog_keyword(r.keyword), r.search_volume, r.pc_search_volume, r.mobile_search_volume,
    r.pc_clicks, r.mobile_clicks, r.pc_ctr, r.mobile_ctr, r.competition, r.ad_count, r.source, r.source_filename, r.raw_data
  FROM jsonb_to_recordset(p_rows) AS r(keyword text, search_volume numeric, pc_search_volume numeric, mobile_search_volume numeric,
    pc_clicks numeric, mobile_clicks numeric, pc_ctr numeric, mobile_ctr numeric, competition text, ad_count numeric, source text, source_filename text, raw_data jsonb)
  ON CONFLICT (product_id, normalized_keyword) DO UPDATE SET
    search_volume = coalesce(EXCLUDED.search_volume, blog_keywords.search_volume),
    pc_search_volume = coalesce(EXCLUDED.pc_search_volume, blog_keywords.pc_search_volume),
    mobile_search_volume = coalesce(EXCLUDED.mobile_search_volume, blog_keywords.mobile_search_volume),
    pc_clicks = coalesce(EXCLUDED.pc_clicks, blog_keywords.pc_clicks), mobile_clicks = coalesce(EXCLUDED.mobile_clicks, blog_keywords.mobile_clicks),
    pc_ctr = coalesce(EXCLUDED.pc_ctr, blog_keywords.pc_ctr), mobile_ctr = coalesce(EXCLUDED.mobile_ctr, blog_keywords.mobile_ctr),
    competition = coalesce(EXCLUDED.competition, blog_keywords.competition), ad_count = coalesce(EXCLUDED.ad_count, blog_keywords.ad_count),
    source = coalesce(EXCLUDED.source, blog_keywords.source), source_filename = EXCLUDED.source_filename, raw_data = EXCLUDED.raw_data;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.import_blog_keywords(bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_blog_keywords(bigint,jsonb) TO anon, authenticated;

-- A linked Task insert and status=used commit together, or both roll back.
CREATE FUNCTION public.claim_blog_task_keyword() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE selected public.blog_keywords%ROWTYPE;
BEGIN
  IF NEW.blog_keyword_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO selected FROM public.blog_keywords WHERE id = NEW.blog_keyword_id FOR UPDATE;
  IF NOT FOUND OR selected.status <> 'unused' OR selected.product_id IS DISTINCT FROM NEW.product_id
    OR selected.keyword IS DISTINCT FROM NEW.keyword THEN RAISE EXCEPTION 'Keyword changed or unavailable; refresh before saving'; END IF;
  UPDATE public.blog_keywords SET status = 'used' WHERE id = selected.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER blog_task_keyword_claim BEFORE INSERT ON public.blog_tasks FOR EACH ROW EXECUTE FUNCTION public.claim_blog_task_keyword();

CREATE FUNCTION public.release_blog_task_keyword() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF OLD.blog_keyword_id IS NOT NULL THEN
    PERFORM id FROM public.blog_keywords WHERE id = OLD.blog_keyword_id FOR UPDATE;
    UPDATE public.blog_keywords SET status = 'unused' WHERE id = OLD.blog_keyword_id AND status = 'used'
      AND NOT EXISTS (SELECT 1 FROM public.blog_tasks WHERE blog_keyword_id = OLD.blog_keyword_id);
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER blog_task_keyword_release AFTER DELETE ON public.blog_tasks FOR EACH ROW EXECUTE FUNCTION public.release_blog_task_keyword();

-- Compatibility: existing Tasks keep NULL source; no content, Job, snapshot or asset data is rewritten.
-- Rollback: revert Keyword UI first; retain rows/nullable FK to preserve provenance. Do not drop populated tables blindly.
COMMIT;
