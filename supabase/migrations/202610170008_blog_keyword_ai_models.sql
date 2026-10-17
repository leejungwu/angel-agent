BEGIN;

ALTER TABLE public.blog_keyword_ai_settings
  ADD COLUMN relevance_model text NOT NULL DEFAULT 'gpt-6-luna',
  ADD COLUMN recommendation_model text NOT NULL DEFAULT 'gpt-6.1-sol';

-- Keep the existing criteria-only signature for older clients. No defaults on this overload.
-- The existing trigger increments relevance_version only when relevance_criteria changes.
CREATE FUNCTION public.save_blog_keyword_ai_settings(
  p_relevance_criteria text, p_recommendation_criteria text, p_expected_updated_at timestamptz,
  p_relevance_model text, p_recommendation_model text
)
RETURNS SETOF public.blog_keyword_ai_settings LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.blog_keyword_ai_settings
  SET relevance_criteria = p_relevance_criteria, recommendation_criteria = p_recommendation_criteria,
      relevance_model = p_relevance_model, recommendation_model = p_recommendation_model
  WHERE id = true AND updated_at = p_expected_updated_at RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.save_blog_keyword_ai_settings(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_blog_keyword_ai_settings(text,text,timestamptz,text,text) TO anon, authenticated;

COMMIT;
