BEGIN;

CREATE TABLE public.blog_generation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  topic_model text NOT NULL DEFAULT 'gpt-6-luna',
  topic_prompt text NOT NULL CHECK (length(btrim(topic_prompt)) BETWEEN 1 AND 30000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.blog_generation_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.blog_generation_settings TO anon, authenticated;
CREATE POLICY blog_generation_settings_select ON public.blog_generation_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY blog_generation_settings_update ON public.blog_generation_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (id = true);

INSERT INTO public.blog_generation_settings (id, topic_prompt) VALUES (true, $prompt$Keyword의 주된 검색 의도를 먼저 파악하고, 이번 글에서 다룰 하나의 명확한 방향을 한국어로 정한다.
Topic은 실제 발행 제목이 아니라 내부 콘텐츠 기획 주제다. 짧고 명확하게 대략 10~50자를 우선한다.
Keyword를 그대로 복사하는 데 그치지 말고 글 방향을 구체화한다. 이번 글 추가 지시가 있으면 주제 결정에 참고한다.
실제 제목처럼 후킹 문구를 만들거나 콜론 뒤에 세부 원인·목차를 길게 나열하지 않는다. 여러 하위 항목을 한 Topic에 전부 집어넣지 않는다.
Product는 보조 context이며 Product를 넣기 위해 검색 의도를 비틀지 않는다. 자연스럽게 연결되는 경우에만 관련 관점을 포함한다.
제품 효능·치료 효과·사용 경험을 만들어내지 않는다.
예: 팔자주름원인 → 팔자주름이 생기는 원인과 생활습관 관리.
피할 예: 팔자주름이 생기는 주요 원인: 피부 노화·자외선·얼굴 움직임·생활습관과 예방에 도움 되는 관리법.
피할 예: 윗잠베개로 팔자주름을 없애는 방법.$prompt$);

CREATE FUNCTION public.touch_blog_generation_settings() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
CREATE TRIGGER touch_blog_generation_settings BEFORE UPDATE ON public.blog_generation_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_blog_generation_settings();

CREATE FUNCTION public.save_blog_generation_settings(p_topic_model text, p_topic_prompt text, p_expected_updated_at timestamptz)
RETURNS SETOF public.blog_generation_settings LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.blog_generation_settings SET topic_model = p_topic_model, topic_prompt = p_topic_prompt
  WHERE id = true AND updated_at = p_expected_updated_at RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.save_blog_generation_settings(text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_blog_generation_settings(text,text,timestamptz) TO anon, authenticated;

ALTER TABLE public.blog_prompt_presets ADD COLUMN title_prompt text NOT NULL DEFAULT '';
-- Only the new field is backfilled; existing writing instructions remain intact.
UPDATE public.blog_prompt_presets SET title_prompt = $title$Keyword의 검색 의도와 확정된 Topic을 반영하여 실제 네이버 블로그에서 사용할 자연스러운 제목 하나를 만든다.
Topic은 내부 기획 방향이며 제목과 다르다. Topic을 그대로 복사하지 말고 제목 표현으로 재구성한다. 확정된 Topic 자체를 새로 바꾸지 않는다.
메인 Keyword는 가능한 자연스럽게 포함하고 짧고 명확한 제목을 우선한다. 과장된 클릭베이트를 피하고 Product 이름을 억지로 넣지 않는다.$title$
WHERE title_prompt = '';

COMMIT;
