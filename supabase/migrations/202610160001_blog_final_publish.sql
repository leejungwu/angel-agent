BEGIN;

ALTER TABLE public.blog_publication_jobs
  ADD COLUMN finalize_mode text NOT NULL DEFAULT 'review',
  ADD CONSTRAINT blog_publication_jobs_finalize_mode_check CHECK (
    finalize_mode = 'review' OR (finalize_mode = 'auto' AND publish_mode = 'scheduled')
  );

-- Final action is consent fixed at registration, independently of execution state.
CREATE FUNCTION public.protect_blog_publication_job_finalize_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.finalize_mode IS DISTINCT FROM OLD.finalize_mode THEN
    RAISE EXCEPTION 'Publication Job finalize mode is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_publication_job_finalize_mode_immutable
BEFORE UPDATE ON public.blog_publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.protect_blog_publication_job_finalize_mode();

COMMIT;
