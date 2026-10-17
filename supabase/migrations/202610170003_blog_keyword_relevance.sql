BEGIN;

ALTER TABLE public.blog_keywords
  ADD COLUMN product_relevance_score integer CHECK (product_relevance_score BETWEEN 0 AND 100),
  ADD COLUMN product_relevance_reason text,
  ADD COLUMN product_relevance_evaluated_at timestamptz,
  ADD COLUMN product_relevance_model text;
CREATE INDEX blog_keywords_product_relevance_idx
  ON public.blog_keywords(product_id, product_relevance_score DESC NULLS LAST, id);

-- One validated AI batch commits together. Existing scores and keyword status are preserved.
CREATE FUNCTION public.save_blog_keyword_relevance(p_product_id bigint, p_rows jsonb, p_model text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected array'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 50 OR p_model IS NULL OR length(btrim(p_model)) NOT BETWEEN 1 AND 200
    THEN RAISE EXCEPTION 'Invalid relevance batch'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS x(item)
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'keywordId') IS DISTINCT FROM 'string'
      OR (item->>'keywordId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(item->'score') IS DISTINCT FROM 'number'
      OR (item->>'score') !~ '^(0|[1-9][0-9]?|100)$'
      OR jsonb_typeof(item->'reason') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'reason')) NOT BETWEEN 1 AND 500
  ) THEN RAISE EXCEPTION 'Invalid relevance result'; END IF;
  IF (SELECT count(DISTINCT (item->>'keywordId')::uuid) FROM jsonb_array_elements(p_rows) AS x(item)) <> jsonb_array_length(p_rows)
    THEN RAISE EXCEPTION 'Duplicate keyword ID'; END IF;

  UPDATE public.blog_keywords AS k SET
    product_relevance_score = r.score,
    product_relevance_reason = btrim(r.reason),
    product_relevance_evaluated_at = now(),
    product_relevance_model = p_model
  FROM jsonb_to_recordset(p_rows) AS r("keywordId" uuid, score integer, reason text)
  WHERE k.id = r."keywordId" AND k.product_id = p_product_id AND k.product_relevance_score IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.save_blog_keyword_relevance(bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_blog_keyword_relevance(bigint,jsonb,text) TO anon, authenticated;

-- Apply this additive migration before the new Pool UI. Old import/Task code ignores these nullable fields.
-- Rollback: restore the prior application; retain columns and scores. No destructive rollback is required.
COMMIT;
