UPDATE public.v6_predictions
SET operational_status = 'OK',
    operational_error = 'late_publish:16s',
    final_prediction = pre_weak_red_veto_prediction,
    abstain_status = CASE WHEN pre_weak_red_veto_prediction = 'ABSTAIN' THEN 'STRATEGIC_ABSTAIN' ELSE NULL END
WHERE model_version = 'V6'
  AND operational_error = 'prediction_after_target_open'
  AND continuity_valid = true
  AND feature_valid = true
  AND base_v6_prediction IS NOT NULL;