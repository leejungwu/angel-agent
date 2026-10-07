BEGIN;

-- Match products.id (bigint); Kin task/draft identities are UUIDs.
CREATE TABLE public.kin_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  question text NOT NULL,
  question_url text,
  category text,
  purpose text NOT NULL DEFAULT 'helpful',
  product_mention_level text NOT NULL DEFAULT 'relevant',
  instructions text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kin_tasks_purpose_check CHECK (purpose IN ('helpful', 'product_relevant')),
  CONSTRAINT kin_tasks_mention_level_check CHECK (product_mention_level IN ('none', 'relevant', 'direct')),
  CONSTRAINT kin_tasks_status_check CHECK (status IN ('pending', 'generated', 'failed'))
);

CREATE TABLE public.kin_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kin_task_id uuid NOT NULL REFERENCES public.kin_tasks(id) ON DELETE CASCADE,
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  answer text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kin_drafts_status_check CHECK (status IN ('draft', 'approved', 'rejected'))
);

CREATE INDEX kin_tasks_product_id_idx ON public.kin_tasks (product_id);
CREATE INDEX kin_tasks_created_at_idx ON public.kin_tasks (created_at DESC);
CREATE INDEX kin_drafts_task_created_at_idx ON public.kin_drafts (kin_task_id, created_at DESC);
CREATE INDEX kin_drafts_product_id_idx ON public.kin_drafts (product_id);

-- Existing development anon CRUD pattern; updated_at is maintained by writers.
ALTER TABLE public.kin_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kin_drafts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kin_tasks, public.kin_drafts TO anon;

CREATE POLICY kin_tasks_anon_select ON public.kin_tasks FOR SELECT TO anon USING (true);
CREATE POLICY kin_tasks_anon_insert ON public.kin_tasks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY kin_tasks_anon_update ON public.kin_tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY kin_tasks_anon_delete ON public.kin_tasks FOR DELETE TO anon USING (true);
CREATE POLICY kin_drafts_anon_select ON public.kin_drafts FOR SELECT TO anon USING (true);
CREATE POLICY kin_drafts_anon_insert ON public.kin_drafts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY kin_drafts_anon_update ON public.kin_drafts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY kin_drafts_anon_delete ON public.kin_drafts FOR DELETE TO anon USING (true);

COMMIT;
