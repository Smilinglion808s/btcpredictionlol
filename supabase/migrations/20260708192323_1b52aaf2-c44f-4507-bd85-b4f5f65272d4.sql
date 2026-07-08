UPDATE public.predictions
SET model_version = '5.1-mislabeled'
WHERE model_version = '6.0'
  AND engine_version_hash IS NULL;

UPDATE public.predictions_archive
SET model_version = '5.1-mislabeled'
WHERE model_version = '6.0'
  AND engine_version_hash IS NULL;