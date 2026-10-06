BEGIN;

CREATE TABLE public.kin_prompt_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  instructions text NOT NULL CHECK (length(btrim(instructions)) > 0),
  default_product_mention_level text CHECK (default_product_mention_level IN ('none', 'relevant', 'direct')),
  is_default boolean NOT NULL DEFAULT false,
  paragraph_count integer CHECK (paragraph_count BETWEEN 2 AND 5),
  min_chars integer CHECK (min_chars > 0),
  max_chars integer CHECK (max_chars > 0),
  keywords text[] NOT NULL DEFAULT '{}',
  max_keyword_mentions_per_paragraph integer CHECK (max_keyword_mentions_per_paragraph BETWEEN 1 AND 3),
  banned_phrases text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kin_prompt_presets_chars_check CHECK (min_chars <= max_chars)
);

ALTER TABLE public.kin_tasks
  ADD COLUMN preset_id uuid REFERENCES public.kin_prompt_presets(id) ON DELETE SET NULL,
  ADD COLUMN preset_name_snapshot text,
  ADD COLUMN preset_instructions_snapshot text,
  ADD COLUMN preset_config_snapshot jsonb;
CREATE INDEX kin_tasks_preset_id_idx ON public.kin_tasks (preset_id);

-- Same development anon CRUD and writer-maintained updated_at pattern.
ALTER TABLE public.kin_prompt_presets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kin_prompt_presets TO anon;
CREATE POLICY kin_prompt_presets_anon_select ON public.kin_prompt_presets FOR SELECT TO anon USING (true);
CREATE POLICY kin_prompt_presets_anon_insert ON public.kin_prompt_presets FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY kin_prompt_presets_anon_update ON public.kin_prompt_presets FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY kin_prompt_presets_anon_delete ON public.kin_prompt_presets FOR DELETE TO anon USING (true);

INSERT INTO public.kin_prompt_presets (name, description, instructions, default_product_mention_level, is_default,
  paragraph_count, min_chars, max_chars, keywords, max_keyword_mentions_per_paragraph, banned_phrases)
VALUES (
  '문제해결형 2~3문단',
  '해결방법을 2~3개 문단으로 나누고 제품을 자연스럽게 해결책 중 하나로 소개',
  '짧은 도입 후 개선방법 2~3개를 각각 독립된 문단으로 작성한다.
한 문단에는 하나의 핵심 해결방법만 담고 번호 목록보다 자연스러운 문단형을 우선한다.
"핵심은", "실행 계획", "정리하면", "다음과 같습니다" 같은 AI식 표현을 최소화한다.
제품이 질문과 관련되면 일반 해결 원리 설명 후 제품을 선택지 중 하나로 소개한다.
제품 관련 문단에서는 상품명·핵심 키워드를 자연스럽게 1회, 필요하면 최대 2회 사용한다.
모든 문단에 상품명을 억지로 넣지 않는다. 기본 500~900자로 작성한다.
광고 문구처럼 과하게 구매를 유도하지 않는다.',
  'relevant', true, 3, 500, 900, '{}', 2,
  ARRAY['핵심은', '실행 계획', '정리하면', '다음과 같습니다']
);

COMMIT;
