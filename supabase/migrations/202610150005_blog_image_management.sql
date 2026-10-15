BEGIN;

-- Keep provenance after a Product photo is removed; the Blog object is independent.
ALTER TABLE public.blog_task_assets ADD COLUMN source_product_asset_id bigint;
CREATE UNIQUE INDEX blog_task_assets_product_source_unique
  ON public.blog_task_assets (blog_task_id, source_product_asset_id)
  WHERE source_product_asset_id IS NOT NULL;

GRANT UPDATE (sort_order) ON public.blog_task_assets TO anon, authenticated;
CREATE POLICY blog_task_assets_update_order ON public.blog_task_assets
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- One transaction validates the complete list before assigning contiguous positions.
CREATE FUNCTION public.reorder_blog_task_assets(p_task_id bigint, p_asset_ids bigint[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE current_ids bigint[];
BEGIN
  PERFORM id FROM public.blog_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Blog task not found'; END IF;
  PERFORM id FROM public.blog_task_assets WHERE blog_task_id = p_task_id ORDER BY id FOR UPDATE;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'::bigint[]) INTO current_ids
    FROM public.blog_task_assets WHERE blog_task_id = p_task_id;
  IF p_asset_ids IS NULL OR cardinality(p_asset_ids) <> cardinality(current_ids)
    OR cardinality(p_asset_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_asset_ids) AS ids(id))
    OR NOT (p_asset_ids @> current_ids AND current_ids @> p_asset_ids) THEN
    RAISE EXCEPTION 'Photo list changed; refresh before reordering';
  END IF;
  UPDATE public.blog_task_assets AS asset SET sort_order = requested.position - 1
    FROM unnest(p_asset_ids) WITH ORDINALITY AS requested(id, position)
    WHERE asset.blog_task_id = p_task_id AND asset.id = requested.id;
END;
$$;

CREATE FUNCTION public.delete_blog_task_asset(p_task_id bigint, p_asset_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE remaining_ids bigint[];
BEGIN
  PERFORM id FROM public.blog_tasks WHERE id = p_task_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.blog_task_assets AS asset
    JOIN public.blog_publication_jobs AS job ON EXISTS (
      SELECT 1 FROM jsonb_array_elements(job.execution_snapshot->'images') AS image
      WHERE image->>'assetId' = asset.id::text OR image->>'storagePath' = asset.storage_path
    )
    WHERE asset.blog_task_id = p_task_id AND asset.id = p_asset_id
  ) THEN RAISE EXCEPTION 'Publication Job references this photo'; END IF;
  DELETE FROM public.blog_task_assets WHERE blog_task_id = p_task_id AND id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Blog photo not found'; END IF;
  SELECT coalesce(array_agg(id ORDER BY sort_order, id), '{}'::bigint[]) INTO remaining_ids
    FROM public.blog_task_assets WHERE blog_task_id = p_task_id;
  PERFORM public.reorder_blog_task_assets(p_task_id, remaining_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_blog_task_assets(bigint, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_blog_task_asset(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_blog_task_assets(bigint, bigint[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_blog_task_asset(bigint, bigint) TO anon, authenticated;

COMMIT;
