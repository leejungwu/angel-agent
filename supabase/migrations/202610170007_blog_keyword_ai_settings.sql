BEGIN;

CREATE TABLE public.blog_keyword_ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  relevance_criteria text NOT NULL CHECK (length(btrim(relevance_criteria)) BETWEEN 1 AND 30000),
  recommendation_criteria text NOT NULL CHECK (length(btrim(recommendation_criteria)) BETWEEN 1 AND 30000),
  relevance_version integer NOT NULL DEFAULT 1 CHECK (relevance_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.blog_keyword_ai_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.blog_keyword_ai_settings TO anon, authenticated;
CREATE POLICY blog_keyword_ai_settings_select ON public.blog_keyword_ai_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY blog_keyword_ai_settings_update ON public.blog_keyword_ai_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (id = true);

INSERT INTO public.blog_keyword_ai_settings (id, relevance_criteria, recommendation_criteria)
VALUES (true, $criteria$Product relevance는 넓은 카테고리 유사도가 아니라 검색 의도와 제품 역할의 적합성이다. 핵심 질문: 이 keyword의 검색 의도를 만족시키는 정보성 글 안에서 이 Product가 핵심 또는 의미 있는 보조 해결책으로 등장해도 독자가 억지 연결이나 bait-and-switch라고 느끼지 않는가?
검색량이나 광고 지표는 점수에 반영하지 않는다. 먼저 검색자가 주로 원하는 답을 판단하고, 제품이 그 답의 핵심 또는 의미 있는 보조 해결책인지 따진다. 제품 소개를 위해 검색자가 원한 답을 다른 주제로 바꿔야 한다면 낮게 평가한다.
피부·주름·안티에이징이라는 큰 카테고리가 같거나 고객층이 겹친다는 사실만으로 높은 점수를 주지 않는다. 글 끝에 제품을 끼워 넣을 수 있다는 정도도 높은 연관도가 아니다.
90~100: Product와 검색 의도가 거의 직접 연결된다. 수면 자세·옆잠·얼굴 압박·베개 자국·수면주름은 해당 Product가 실제로 수면 자세/환경과 관련된 제품일 때의 직접 연결 예다.
75~89: 제품의 핵심 고객 고민과 직접적으로 가까우며 생활습관·수면 환경 관점으로 자연스럽고 유용하게 연결 가능하다. 카테고리만 겹치는 경우는 해당하지 않는다.
50~74: 인접 주제다. Product 연결을 위해 별도 설명이나 콘텐츠 각도가 필요하다.
25~49: 화장품·피부시술·성분 등 같은 큰 카테고리는 겹치지만 검색자의 주된 의도와 Product의 역할이 상당히 다르다.
0~24: 사실상 무관하다.
수면용 베개를 평가할 때 아이크림·레티놀·리프팅 시술·보톡스·리쥬란을 주름 관련이라는 이유만으로 고득점하지 않는다. 다른 Product도 실제 역할을 기준으로 판단한다.
의료/시술 keyword의 핵심 의도가 시술 효과·비용·과정·부작용 등 시술 정보라면 Product relevance를 낮게 평가한다. 시술 의도를 근거 없이 일반 관리 의도로 넓혀 해석하지 않는다.
팔자주름 관리처럼 broader intent가 명확한 경우에만 생활습관 관점의 연결 가능성을 일부 인정한다. 주름이라는 단어만으로 직접 연결이나 높은 점수를 추정하지 않는다.$criteria$, $criteria$Product 관련성, 검색량, 검색 의도, 블로그로 설명하기 좋은지, 기존 주제와의 중복, 추천 목록 내부 다양성을 함께 판단한다.
검색량은 중요한 signal이지만 순위만으로 추천하지 않는다. competition은 광고 경쟁도 참고값일 뿐 블로그 SEO 난이도로 해석하지 않는다.
같은 콘텐츠가 될 띄어쓰기 변형이나 비슷한 키워드는 대표 하나를 우선하고 다른 검색 의도를 섞는다.
단어만 보고 의료 시술 등의 후보를 기계적으로 제외하지 말고 Product와 자연스럽게 연결되는 콘텐츠인지 판단한다.$criteria$);

ALTER TABLE public.blog_keywords ADD COLUMN product_relevance_criteria_version integer CHECK (product_relevance_criteria_version > 0);

-- Normalize on every write and increment under the row lock, including direct updates.
CREATE FUNCTION public.normalize_blog_keyword_ai_settings() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.relevance_criteria := btrim(regexp_replace(NEW.relevance_criteria, '[[:space:]]+', ' ', 'g'));
  NEW.recommendation_criteria := btrim(regexp_replace(NEW.recommendation_criteria, '[[:space:]]+', ' ', 'g'));
  NEW.relevance_version := OLD.relevance_version + CASE WHEN
    NEW.relevance_criteria IS DISTINCT FROM btrim(regexp_replace(OLD.relevance_criteria, '[[:space:]]+', ' ', 'g')) THEN 1 ELSE 0 END;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
CREATE TRIGGER normalize_blog_keyword_ai_settings BEFORE UPDATE ON public.blog_keyword_ai_settings
FOR EACH ROW EXECUTE FUNCTION public.normalize_blog_keyword_ai_settings();

-- Compare-and-swap prevents a stale browser from overwriting a concurrent edit.
CREATE FUNCTION public.save_blog_keyword_ai_settings(p_relevance_criteria text, p_recommendation_criteria text, p_expected_updated_at timestamptz)
RETURNS SETOF public.blog_keyword_ai_settings LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.blog_keyword_ai_settings SET relevance_criteria = p_relevance_criteria, recommendation_criteria = p_recommendation_criteria
  WHERE id = true AND updated_at = p_expected_updated_at RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.save_blog_keyword_ai_settings(text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_blog_keyword_ai_settings(text,text,timestamptz) TO anon, authenticated;

-- Versioned writes serialize with settings saves. Changed criteria invalidate in-flight batches.
CREATE FUNCTION public.save_versioned_blog_keyword_relevance(p_product_id bigint, p_rows jsonb, p_model text, p_criteria_version integer, p_reevaluate boolean)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE current_version integer; affected integer;
BEGIN
  SELECT relevance_version INTO current_version FROM public.blog_keyword_ai_settings WHERE id = true FOR SHARE;
  IF current_version IS NULL OR p_criteria_version IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'Relevance criteria changed; retry evaluation'; END IF;
  IF p_reevaluate IS NULL THEN RAISE EXCEPTION 'Explicit evaluation mode required'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected array'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 50 OR p_model IS NULL OR length(btrim(p_model)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid relevance batch'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS x(item) WHERE
    jsonb_typeof(item) IS DISTINCT FROM 'object'
    OR jsonb_typeof(item->'keywordId') IS DISTINCT FROM 'string'
    OR (item->>'keywordId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(item->'score') IS DISTINCT FROM 'number' OR (item->>'score') !~ '^(0|[1-9][0-9]?|100)$'
    OR jsonb_typeof(item->'reason') IS DISTINCT FROM 'string' OR length(btrim(item->>'reason')) NOT BETWEEN 1 AND 500
  ) THEN RAISE EXCEPTION 'Invalid relevance result'; END IF;
  IF (SELECT count(DISTINCT (item->>'keywordId')::uuid) FROM jsonb_array_elements(p_rows) AS x(item)) <> jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'Duplicate keyword ID'; END IF;
  PERFORM set_config('angel.versioned_relevance', 'on', true);
  UPDATE public.blog_keywords AS k SET product_relevance_score = r.score, product_relevance_reason = btrim(r.reason),
    product_relevance_evaluated_at = now(), product_relevance_model = p_model, product_relevance_criteria_version = p_criteria_version
  FROM jsonb_to_recordset(p_rows) AS r("keywordId" uuid, score integer, reason text)
  WHERE k.id = r."keywordId" AND k.product_id = p_product_id AND (
    (NOT p_reevaluate AND (k.product_relevance_score IS NULL OR k.product_relevance_criteria_version IS DISTINCT FROM current_version))
    OR (p_reevaluate AND k.product_relevance_score IS NOT NULL AND k.product_relevance_criteria_version = current_version));
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM set_config('angel.versioned_relevance', 'off', true);
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.save_versioned_blog_keyword_relevance(bigint,jsonb,text,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_versioned_blog_keyword_relevance(bigint,jsonb,text,integer,boolean) TO anon, authenticated;

-- Legacy writers must mark their unversioned results as stale, even after replacing a versioned score.
CREATE FUNCTION public.mark_legacy_blog_keyword_relevance() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.product_relevance_evaluated_at IS DISTINCT FROM OLD.product_relevance_evaluated_at
    AND NEW.product_relevance_criteria_version IS NOT DISTINCT FROM OLD.product_relevance_criteria_version
    AND current_setting('angel.versioned_relevance', true) IS DISTINCT FROM 'on' THEN
    NEW.product_relevance_criteria_version := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mark_legacy_blog_keyword_relevance BEFORE UPDATE ON public.blog_keywords
FOR EACH ROW EXECUTE FUNCTION public.mark_legacy_blog_keyword_relevance();

COMMIT;
