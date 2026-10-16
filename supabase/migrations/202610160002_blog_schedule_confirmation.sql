BEGIN;

-- Additive execution metadata; existing snapshots, statuses and rows remain unchanged.
ALTER TABLE public.blog_publication_jobs
  ADD COLUMN reservation_confirmed_at timestamptz NULL,
  ADD CONSTRAINT blog_publication_jobs_reservation_confirmation_check CHECK (
    reservation_confirmed_at IS NULL OR publish_mode = 'scheduled'
  );

-- Rollback after reverting readers/writers: drop the constraint, then this nullable column.
COMMIT;
