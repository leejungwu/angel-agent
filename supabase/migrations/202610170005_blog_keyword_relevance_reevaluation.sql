BEGIN;

-- Both modes share validation and atomic metadata writes; status is never changed.
CREATE FUNCTION public.write_blog_keyword_relevance(p_product_id bigint, p_rows jsonb, p_model text, p_reevaluate boolean)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  IF p_reevaluate IS NULL THEN RAISE EXCEPTION 'Explicit evaluation mode required'; END IF;
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
  WHERE k.id = r."keywordId" AND k.product_id = p_product_id AND ((NOT p_reevaluate AND k.product_relevance_score IS NULL)
    OR (p_reevaluate AND k.product_relevance_score IS NOT NULL));
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.write_blog_keyword_relevance(bigint,jsonb,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_blog_keyword_relevance(bigint,jsonb,text,boolean) TO anon, authenticated;

-- Preserve the existing signature and its unevaluated-only contract for old clients.
CREATE OR REPLACE FUNCTION public.save_blog_keyword_relevance(p_product_id bigint, p_rows jsonb, p_model text)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT public.write_blog_keyword_relevance(p_product_id, p_rows, p_model, false);
$$;

-- Only the explicit reevaluation path can replace scores on already evaluated rows.
CREATE FUNCTION public.reevaluate_blog_keyword_relevance(p_product_id bigint, p_rows jsonb, p_model text)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT public.write_blog_keyword_relevance(p_product_id, p_rows, p_model, true);
$$;
REVOKE ALL ON FUNCTION public.reevaluate_blog_keyword_relevance(bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reevaluate_blog_keyword_relevance(bigint,jsonb,text) TO anon, authenticated;

-- Apply before using reevaluation. Application rollback can retain these functions and existing metadata.
COMMIT;
