-- Backfill depth1~depth4 into classification jsonb and remove legacy 1Depth~4Depth keys
-- Tables:
-- - public.labels.classification
-- - public.generated_problems.classification
-- - public.generated_problems.source_classification

-- labels
update public.labels
set classification = jsonb_strip_nulls(
  (
    coalesce(classification, '{}'::jsonb)
    || jsonb_build_object(
      'depth1', coalesce(nullif(btrim(coalesce(classification->>'depth1','')), ''), nullif(btrim(coalesce(classification->>'1Depth','')), '')),
      'depth2', coalesce(nullif(btrim(coalesce(classification->>'depth2','')), ''), nullif(btrim(coalesce(classification->>'2Depth','')), '')),
      'depth3', coalesce(nullif(btrim(coalesce(classification->>'depth3','')), ''), nullif(btrim(coalesce(classification->>'3Depth','')), '')),
      'depth4', coalesce(nullif(btrim(coalesce(classification->>'depth4','')), ''), nullif(btrim(coalesce(classification->>'4Depth','')), ''))
    )
  )
  - '1Depth' - '2Depth' - '3Depth' - '4Depth'
)
where classification is not null
  and (
    classification ? '1Depth' or classification ? '2Depth' or classification ? '3Depth' or classification ? '4Depth'
    or classification ? 'depth1' or classification ? 'depth2' or classification ? 'depth3' or classification ? 'depth4'
  );

-- generated_problems.classification
update public.generated_problems
set classification = jsonb_strip_nulls(
  (
    coalesce(classification, '{}'::jsonb)
    || jsonb_build_object(
      'depth1', coalesce(nullif(btrim(coalesce(classification->>'depth1','')), ''), nullif(btrim(coalesce(classification->>'1Depth','')), '')),
      'depth2', coalesce(nullif(btrim(coalesce(classification->>'depth2','')), ''), nullif(btrim(coalesce(classification->>'2Depth','')), '')),
      'depth3', coalesce(nullif(btrim(coalesce(classification->>'depth3','')), ''), nullif(btrim(coalesce(classification->>'3Depth','')), '')),
      'depth4', coalesce(nullif(btrim(coalesce(classification->>'depth4','')), ''), nullif(btrim(coalesce(classification->>'4Depth','')), ''))
    )
  )
  - '1Depth' - '2Depth' - '3Depth' - '4Depth'
)
where classification is not null
  and (
    classification ? '1Depth' or classification ? '2Depth' or classification ? '3Depth' or classification ? '4Depth'
    or classification ? 'depth1' or classification ? 'depth2' or classification ? 'depth3' or classification ? 'depth4'
  );

-- generated_problems.source_classification (nullable)
update public.generated_problems
set source_classification = jsonb_strip_nulls(
  (
    coalesce(source_classification, '{}'::jsonb)
    || jsonb_build_object(
      'depth1', coalesce(nullif(btrim(coalesce(source_classification->>'depth1','')), ''), nullif(btrim(coalesce(source_classification->>'1Depth','')), '')),
      'depth2', coalesce(nullif(btrim(coalesce(source_classification->>'depth2','')), ''), nullif(btrim(coalesce(source_classification->>'2Depth','')), '')),
      'depth3', coalesce(nullif(btrim(coalesce(source_classification->>'depth3','')), ''), nullif(btrim(coalesce(source_classification->>'3Depth','')), '')),
      'depth4', coalesce(nullif(btrim(coalesce(source_classification->>'depth4','')), ''), nullif(btrim(coalesce(source_classification->>'4Depth','')), ''))
    )
  )
  - '1Depth' - '2Depth' - '3Depth' - '4Depth'
)
where source_classification is not null
  and (
    source_classification ? '1Depth' or source_classification ? '2Depth' or source_classification ? '3Depth' or source_classification ? '4Depth'
    or source_classification ? 'depth1' or source_classification ? 'depth2' or source_classification ? 'depth3' or source_classification ? 'depth4'
  );
;
