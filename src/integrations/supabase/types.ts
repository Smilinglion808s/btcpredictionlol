export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_runs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          request_payload: Json | null
          response_payload: Json | null
          run_type: string
          success: boolean
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          run_type: string
          success?: boolean
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          run_type?: string
          success?: boolean
        }
        Relationships: []
      }
      candles: {
        Row: {
          candle_ts: string
          close: number
          confirm: boolean
          created_at: string
          fetch_source: string | null
          high: number
          id: string
          low: number
          open: number
          raw: Json | null
          symbol: string
          timeframe: string
          volume: number
          volume_quote: number | null
        }
        Insert: {
          candle_ts: string
          close: number
          confirm?: boolean
          created_at?: string
          fetch_source?: string | null
          high: number
          id?: string
          low: number
          open: number
          raw?: Json | null
          symbol?: string
          timeframe?: string
          volume: number
          volume_quote?: number | null
        }
        Update: {
          candle_ts?: string
          close?: number
          confirm?: boolean
          created_at?: string
          fetch_source?: string | null
          high?: number
          id?: string
          low?: number
          open?: number
          raw?: Json | null
          symbol?: string
          timeframe?: string
          volume?: number
          volume_quote?: number | null
        }
        Relationships: []
      }
      model_archives: {
        Row: {
          api_model_id: string | null
          archived_at: string
          auto_run_enabled: boolean | null
          confidence_threshold: number | null
          created_at: string
          id: string
          indicator_weights: Json
          model_version: string
          notes: string | null
          prompt_template: string
          require_manual_approval: boolean | null
        }
        Insert: {
          api_model_id?: string | null
          archived_at?: string
          auto_run_enabled?: boolean | null
          confidence_threshold?: number | null
          created_at?: string
          id?: string
          indicator_weights?: Json
          model_version: string
          notes?: string | null
          prompt_template: string
          require_manual_approval?: boolean | null
        }
        Update: {
          api_model_id?: string | null
          archived_at?: string
          auto_run_enabled?: boolean | null
          confidence_threshold?: number | null
          created_at?: string
          id?: string
          indicator_weights?: Json
          model_version?: string
          notes?: string | null
          prompt_template?: string
          require_manual_approval?: boolean | null
        }
        Relationships: []
      }
      model_c_shadow: {
        Row: {
          actual_direction: string | null
          base_decision: string | null
          blend_weight_global: number | null
          blend_weight_recent: number | null
          boundary_delta_ms: number | null
          candle_ts: string
          created_at: string
          ensemble_delta: number | null
          ensemble_probability_green: number | null
          ensemble_threshold: number | null
          feature_cutoff_ts: string | null
          final_decision: string | null
          fit_id: string | null
          global_artifact_sha256: string | null
          global_feature_vector_sha256: string | null
          global_probability_green: number | null
          id: string
          in_sample_global_prob_mean: number | null
          in_sample_global_prob_std: number | null
          in_sample_recent_prob_mean: number | null
          in_sample_recent_prob_std: number | null
          latest_source_candle_ts: string | null
          leakage_check_passed: boolean | null
          override_applied: boolean | null
          override_reason: string | null
          override_reasons_json: Json | null
          predicted_direction: string | null
          prediction_id: string | null
          prediction_row_created_at: string | null
          prediction_row_lead_ms: number | null
          production_model_version: string | null
          prospective_test_id: string | null
          recent_artifact_sha256: string | null
          recent_feature_vector_sha256: string | null
          recent_probability_green: number | null
          resolved_at: string | null
          scored_at: string | null
          shadow_error: string | null
          skip_reason: string | null
          status: string
          target_boundary_ts: string | null
          timing_status: string | null
          trade: boolean | null
          variant: string
          won: boolean | null
        }
        Insert: {
          actual_direction?: string | null
          base_decision?: string | null
          blend_weight_global?: number | null
          blend_weight_recent?: number | null
          boundary_delta_ms?: number | null
          candle_ts: string
          created_at?: string
          ensemble_delta?: number | null
          ensemble_probability_green?: number | null
          ensemble_threshold?: number | null
          feature_cutoff_ts?: string | null
          final_decision?: string | null
          fit_id?: string | null
          global_artifact_sha256?: string | null
          global_feature_vector_sha256?: string | null
          global_probability_green?: number | null
          id?: string
          in_sample_global_prob_mean?: number | null
          in_sample_global_prob_std?: number | null
          in_sample_recent_prob_mean?: number | null
          in_sample_recent_prob_std?: number | null
          latest_source_candle_ts?: string | null
          leakage_check_passed?: boolean | null
          override_applied?: boolean | null
          override_reason?: string | null
          override_reasons_json?: Json | null
          predicted_direction?: string | null
          prediction_id?: string | null
          prediction_row_created_at?: string | null
          prediction_row_lead_ms?: number | null
          production_model_version?: string | null
          prospective_test_id?: string | null
          recent_artifact_sha256?: string | null
          recent_feature_vector_sha256?: string | null
          recent_probability_green?: number | null
          resolved_at?: string | null
          scored_at?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          status?: string
          target_boundary_ts?: string | null
          timing_status?: string | null
          trade?: boolean | null
          variant?: string
          won?: boolean | null
        }
        Update: {
          actual_direction?: string | null
          base_decision?: string | null
          blend_weight_global?: number | null
          blend_weight_recent?: number | null
          boundary_delta_ms?: number | null
          candle_ts?: string
          created_at?: string
          ensemble_delta?: number | null
          ensemble_probability_green?: number | null
          ensemble_threshold?: number | null
          feature_cutoff_ts?: string | null
          final_decision?: string | null
          fit_id?: string | null
          global_artifact_sha256?: string | null
          global_feature_vector_sha256?: string | null
          global_probability_green?: number | null
          id?: string
          in_sample_global_prob_mean?: number | null
          in_sample_global_prob_std?: number | null
          in_sample_recent_prob_mean?: number | null
          in_sample_recent_prob_std?: number | null
          latest_source_candle_ts?: string | null
          leakage_check_passed?: boolean | null
          override_applied?: boolean | null
          override_reason?: string | null
          override_reasons_json?: Json | null
          predicted_direction?: string | null
          prediction_id?: string | null
          prediction_row_created_at?: string | null
          prediction_row_lead_ms?: number | null
          production_model_version?: string | null
          prospective_test_id?: string | null
          recent_artifact_sha256?: string | null
          recent_feature_vector_sha256?: string | null
          recent_probability_green?: number | null
          resolved_at?: string | null
          scored_at?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          status?: string
          target_boundary_ts?: string | null
          timing_status?: string | null
          trade?: boolean | null
          variant?: string
          won?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "model_c_shadow_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      model_c_training_fits: {
        Row: {
          combined_fit_sha256: string | null
          created_at: string
          first_eligible_target_ts: string | null
          first_scored_candle_ts: string | null
          fit_id: string
          fit_meta: Json | null
          fit_source: string | null
          global_artifact_sha256: string | null
          global_component_fit: Json | null
          global_training_row_count: number | null
          global_training_window_end_ts: string | null
          global_training_window_start_ts: string | null
          in_sample_global_prob_mean: number | null
          in_sample_global_prob_std: number | null
          in_sample_recent_prob_mean: number | null
          in_sample_recent_prob_std: number | null
          promoted_at: string | null
          recent_artifact_sha256: string | null
          recent_component_fit: Json | null
          recent_training_row_count: number | null
          recent_training_window_end_ts: string | null
          recent_training_window_start_ts: string | null
          status: string
          training_cutoff_ts: string
          training_model_version: string
        }
        Insert: {
          combined_fit_sha256?: string | null
          created_at?: string
          first_eligible_target_ts?: string | null
          first_scored_candle_ts?: string | null
          fit_id: string
          fit_meta?: Json | null
          fit_source?: string | null
          global_artifact_sha256?: string | null
          global_component_fit?: Json | null
          global_training_row_count?: number | null
          global_training_window_end_ts?: string | null
          global_training_window_start_ts?: string | null
          in_sample_global_prob_mean?: number | null
          in_sample_global_prob_std?: number | null
          in_sample_recent_prob_mean?: number | null
          in_sample_recent_prob_std?: number | null
          promoted_at?: string | null
          recent_artifact_sha256?: string | null
          recent_component_fit?: Json | null
          recent_training_row_count?: number | null
          recent_training_window_end_ts?: string | null
          recent_training_window_start_ts?: string | null
          status?: string
          training_cutoff_ts: string
          training_model_version?: string
        }
        Update: {
          combined_fit_sha256?: string | null
          created_at?: string
          first_eligible_target_ts?: string | null
          first_scored_candle_ts?: string | null
          fit_id?: string
          fit_meta?: Json | null
          fit_source?: string | null
          global_artifact_sha256?: string | null
          global_component_fit?: Json | null
          global_training_row_count?: number | null
          global_training_window_end_ts?: string | null
          global_training_window_start_ts?: string | null
          in_sample_global_prob_mean?: number | null
          in_sample_global_prob_std?: number | null
          in_sample_recent_prob_mean?: number | null
          in_sample_recent_prob_std?: number | null
          promoted_at?: string | null
          recent_artifact_sha256?: string | null
          recent_component_fit?: Json | null
          recent_training_row_count?: number | null
          recent_training_window_end_ts?: string | null
          recent_training_window_start_ts?: string | null
          status?: string
          training_cutoff_ts?: string
          training_model_version?: string
        }
        Relationships: []
      }
      model_settings: {
        Row: {
          api_model_id: string | null
          auto_run_enabled: boolean
          confidence_threshold: number
          created_at: string
          id: string
          indicator_weights: Json
          is_active: boolean
          model_version: string
          prompt_template: string
          require_manual_approval: boolean
          updated_at: string
        }
        Insert: {
          api_model_id?: string | null
          auto_run_enabled?: boolean
          confidence_threshold?: number
          created_at?: string
          id?: string
          indicator_weights?: Json
          is_active?: boolean
          model_version: string
          prompt_template?: string
          require_manual_approval?: boolean
          updated_at?: string
        }
        Update: {
          api_model_id?: string | null
          auto_run_enabled?: boolean
          confidence_threshold?: number
          created_at?: string
          id?: string
          indicator_weights?: Json
          is_active?: boolean
          model_version?: string
          prompt_template?: string
          require_manual_approval?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      model_stats_archive: {
        Row: {
          archived_at: string
          avg_confidence: number | null
          id: string
          losses: number
          model_version: string
          pending: number
          pushes: number
          stats: Json | null
          total: number
          win_rate: number | null
          wins: number
        }
        Insert: {
          archived_at?: string
          avg_confidence?: number | null
          id?: string
          losses: number
          model_version: string
          pending: number
          pushes: number
          stats?: Json | null
          total: number
          win_rate?: number | null
          wins: number
        }
        Update: {
          archived_at?: string
          avg_confidence?: number | null
          id?: string
          losses?: number
          model_version?: string
          pending?: number
          pushes?: number
          stats?: Json | null
          total?: number
          win_rate?: number | null
          wins?: number
        }
        Relationships: []
      }
      model7_b4_2_no_history: {
        Row: {
          b2_final_decision: string
          candle_ts: string
          created_at: string
          date_mt: string
          id: string
          policy_version: string
          resolution_id: string
          resolved_at: string
          result: string
          symbol: string
          timeframe: string
        }
        Insert: {
          b2_final_decision: string
          candle_ts: string
          created_at?: string
          date_mt: string
          id?: string
          policy_version?: string
          resolution_id: string
          resolved_at: string
          result: string
          symbol?: string
          timeframe?: string
        }
        Update: {
          b2_final_decision?: string
          candle_ts?: string
          created_at?: string
          date_mt?: string
          id?: string
          policy_version?: string
          resolution_id?: string
          resolved_at?: string
          result?: string
          symbol?: string
          timeframe?: string
        }
        Relationships: []
      }
      model7_b4_2_resolutions: {
        Row: {
          applied_at: string
          b2_final_decision: string
          b4_2_final_decision: string
          b4_2_skipped: boolean
          candle_ts: string
          cooldown_after: number | null
          cooldown_before: number | null
          counterfactual_b2_result: string | null
          date_mt: string
          edge_score_after: number | null
          edge_score_before: number | null
          id: string
          policy_version: string
          resolution_id: string
        }
        Insert: {
          applied_at?: string
          b2_final_decision: string
          b4_2_final_decision: string
          b4_2_skipped: boolean
          candle_ts: string
          cooldown_after?: number | null
          cooldown_before?: number | null
          counterfactual_b2_result?: string | null
          date_mt: string
          edge_score_after?: number | null
          edge_score_before?: number | null
          id?: string
          policy_version?: string
          resolution_id: string
        }
        Update: {
          applied_at?: string
          b2_final_decision?: string
          b4_2_final_decision?: string
          b4_2_skipped?: boolean
          candle_ts?: string
          cooldown_after?: number | null
          cooldown_before?: number | null
          counterfactual_b2_result?: string | null
          date_mt?: string
          edge_score_after?: number | null
          edge_score_before?: number | null
          id?: string
          policy_version?: string
          resolution_id?: string
        }
        Relationships: []
      }
      model7_b4_2_state: {
        Row: {
          awaiting_probe_resolution: boolean
          circuit_active: boolean
          cooldown_remaining: number
          date_mt: string
          edge_score: number
          id: string
          last_processed_resolution_id: string | null
          policy_version: string
          symbol: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          awaiting_probe_resolution?: boolean
          circuit_active?: boolean
          cooldown_remaining?: number
          date_mt: string
          edge_score?: number
          id?: string
          last_processed_resolution_id?: string | null
          policy_version?: string
          symbol?: string
          timeframe?: string
          updated_at?: string
        }
        Update: {
          awaiting_probe_resolution?: boolean
          circuit_active?: boolean
          cooldown_remaining?: number
          date_mt?: string
          edge_score?: number
          id?: string
          last_processed_resolution_id?: string | null
          policy_version?: string
          symbol?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      model7_shadow: {
        Row: {
          a2_counterfactual_result: string | null
          a2_filter_fired: boolean | null
          a2_filter_reason: string | null
          a2_probability_bucket: string | null
          a2_variant_a_applied_override_reason: string | null
          a2_variant_a_base_decision: string | null
          a2_variant_a_final_decision: string | null
          a2_variant_a_override_applied: boolean | null
          actual_direction: string | null
          b4_2_b2_would_have_won: boolean | null
          b4_2_cooldown_before: number | null
          b4_2_counterfactual_b2_result: string | null
          b4_2_date_mt: string | null
          b4_2_edge_score_before: number | null
          b4_2_guard_fired: boolean | null
          b4_2_guard_reason: string | null
          b4_2_last_two_no_results_json: Json | null
          b4_2_policy_version: string | null
          base_decision: string | null
          boundary_delta_ms: number | null
          candle_ts: string
          created_at: string
          decision: string | null
          feature_cutoff_ts: string | null
          feature_vector_nonzero_count: number | null
          feature_vector_sha256: string | null
          hard_no_override_fired: string | null
          history_candles_available: number | null
          history_gap_encountered: boolean | null
          id: string
          latest_source_candle_ts: string | null
          latest_source_event_ts: string | null
          leakage_block_reason: string | null
          leakage_check_passed: boolean | null
          logit: number | null
          missing_raw_numeric_fields_json: Json | null
          model_artifact_sha256: string | null
          model_fit_id: string | null
          offending_features_json: Json | null
          override_reasons_json: Json | null
          prediction_id: string
          prediction_row_created_at: string | null
          prediction_row_lead_ms: number | null
          previous_candle_ts: string | null
          probability_green: number | null
          production_model_version: string | null
          resolved_at: string | null
          score_not_before_ts: string | null
          scored_at: string | null
          shadow_error: string | null
          snapshot_ts: string | null
          status: string
          target_boundary_ts: string | null
          timing_status: string | null
          unknown_categories: Json | null
          updated_at: string
          variant: string
          warm_cache_hit: boolean | null
          would_trade: boolean | null
        }
        Insert: {
          a2_counterfactual_result?: string | null
          a2_filter_fired?: boolean | null
          a2_filter_reason?: string | null
          a2_probability_bucket?: string | null
          a2_variant_a_applied_override_reason?: string | null
          a2_variant_a_base_decision?: string | null
          a2_variant_a_final_decision?: string | null
          a2_variant_a_override_applied?: boolean | null
          actual_direction?: string | null
          b4_2_b2_would_have_won?: boolean | null
          b4_2_cooldown_before?: number | null
          b4_2_counterfactual_b2_result?: string | null
          b4_2_date_mt?: string | null
          b4_2_edge_score_before?: number | null
          b4_2_guard_fired?: boolean | null
          b4_2_guard_reason?: string | null
          b4_2_last_two_no_results_json?: Json | null
          b4_2_policy_version?: string | null
          base_decision?: string | null
          boundary_delta_ms?: number | null
          candle_ts: string
          created_at?: string
          decision?: string | null
          feature_cutoff_ts?: string | null
          feature_vector_nonzero_count?: number | null
          feature_vector_sha256?: string | null
          hard_no_override_fired?: string | null
          history_candles_available?: number | null
          history_gap_encountered?: boolean | null
          id?: string
          latest_source_candle_ts?: string | null
          latest_source_event_ts?: string | null
          leakage_block_reason?: string | null
          leakage_check_passed?: boolean | null
          logit?: number | null
          missing_raw_numeric_fields_json?: Json | null
          model_artifact_sha256?: string | null
          model_fit_id?: string | null
          offending_features_json?: Json | null
          override_reasons_json?: Json | null
          prediction_id: string
          prediction_row_created_at?: string | null
          prediction_row_lead_ms?: number | null
          previous_candle_ts?: string | null
          probability_green?: number | null
          production_model_version?: string | null
          resolved_at?: string | null
          score_not_before_ts?: string | null
          scored_at?: string | null
          shadow_error?: string | null
          snapshot_ts?: string | null
          status?: string
          target_boundary_ts?: string | null
          timing_status?: string | null
          unknown_categories?: Json | null
          updated_at?: string
          variant: string
          warm_cache_hit?: boolean | null
          would_trade?: boolean | null
        }
        Update: {
          a2_counterfactual_result?: string | null
          a2_filter_fired?: boolean | null
          a2_filter_reason?: string | null
          a2_probability_bucket?: string | null
          a2_variant_a_applied_override_reason?: string | null
          a2_variant_a_base_decision?: string | null
          a2_variant_a_final_decision?: string | null
          a2_variant_a_override_applied?: boolean | null
          actual_direction?: string | null
          b4_2_b2_would_have_won?: boolean | null
          b4_2_cooldown_before?: number | null
          b4_2_counterfactual_b2_result?: string | null
          b4_2_date_mt?: string | null
          b4_2_edge_score_before?: number | null
          b4_2_guard_fired?: boolean | null
          b4_2_guard_reason?: string | null
          b4_2_last_two_no_results_json?: Json | null
          b4_2_policy_version?: string | null
          base_decision?: string | null
          boundary_delta_ms?: number | null
          candle_ts?: string
          created_at?: string
          decision?: string | null
          feature_cutoff_ts?: string | null
          feature_vector_nonzero_count?: number | null
          feature_vector_sha256?: string | null
          hard_no_override_fired?: string | null
          history_candles_available?: number | null
          history_gap_encountered?: boolean | null
          id?: string
          latest_source_candle_ts?: string | null
          latest_source_event_ts?: string | null
          leakage_block_reason?: string | null
          leakage_check_passed?: boolean | null
          logit?: number | null
          missing_raw_numeric_fields_json?: Json | null
          model_artifact_sha256?: string | null
          model_fit_id?: string | null
          offending_features_json?: Json | null
          override_reasons_json?: Json | null
          prediction_id?: string
          prediction_row_created_at?: string | null
          prediction_row_lead_ms?: number | null
          previous_candle_ts?: string | null
          probability_green?: number | null
          production_model_version?: string | null
          resolved_at?: string | null
          score_not_before_ts?: string | null
          scored_at?: string | null
          shadow_error?: string | null
          snapshot_ts?: string | null
          status?: string
          target_boundary_ts?: string | null
          timing_status?: string | null
          unknown_categories?: Json | null
          updated_at?: string
          variant?: string
          warm_cache_hit?: boolean | null
          would_trade?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "model7_shadow_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      model7_training_fits: {
        Row: {
          artifact_sha256: string | null
          categorical_vocab: Json
          coefficients: Json
          created_at: string
          feature_means: Json
          feature_order: Json
          feature_scales: Json
          first_scored_candle_ts: string | null
          fit_meta: Json | null
          id: string
          intercept: number
          model_fit_id: string
          training_cutoff_ts: string | null
          training_model_version: string
          training_row_count: number
          training_window_end: string | null
          training_window_start: string | null
          updated_at: string
          variant: string
        }
        Insert: {
          artifact_sha256?: string | null
          categorical_vocab: Json
          coefficients: Json
          created_at?: string
          feature_means: Json
          feature_order: Json
          feature_scales: Json
          first_scored_candle_ts?: string | null
          fit_meta?: Json | null
          id?: string
          intercept: number
          model_fit_id: string
          training_cutoff_ts?: string | null
          training_model_version: string
          training_row_count: number
          training_window_end?: string | null
          training_window_start?: string | null
          updated_at?: string
          variant: string
        }
        Update: {
          artifact_sha256?: string | null
          categorical_vocab?: Json
          coefficients?: Json
          created_at?: string
          feature_means?: Json
          feature_order?: Json
          feature_scales?: Json
          first_scored_candle_ts?: string | null
          fit_meta?: Json | null
          id?: string
          intercept?: number
          model_fit_id?: string
          training_cutoff_ts?: string | null
          training_model_version?: string
          training_row_count?: number
          training_window_end?: string | null
          training_window_start?: string | null
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      predictions: {
        Row: {
          actual_direction: string | null
          actual_next_candle_close: number | null
          actual_next_candle_high: number | null
          actual_next_candle_low: number | null
          actual_next_candle_open: number | null
          advance_check_passed: boolean | null
          agreement_gate_applied: boolean
          agreement_gate_reason: string | null
          api_model_id: string | null
          base_bearish_score: number | null
          base_bullish_score: number | null
          bearish_score: number | null
          btc_price_at_prediction: number
          bullish_score: number | null
          candle_ts: string
          change_reason: string | null
          changed_by_partial: boolean | null
          confidence: number
          config_hash: string | null
          conflict_downgrade_applied: boolean
          conviction_active: boolean | null
          conviction_aligned: boolean | null
          conviction_direction: string | null
          conviction_reasons: string[] | null
          created_at: string
          current_partial_minutes_elapsed: number | null
          current_partial_snapshot: Json | null
          degraded_mode: boolean
          engine_version_hash: string | null
          feed_mismatch: boolean
          fetch_source: string | null
          final_trade_status: string | null
          freshness_action: string | null
          full_ai_response: Json | null
          id: string
          indicators: Json | null
          input_candle_age_seconds: number | null
          input_candle_ts: string | null
          input_features_fresh: boolean | null
          market_condition: string | null
          model_version: string
          module_points: Json | null
          notes: string | null
          orderbook: Json | null
          original_prediction_before_partial: string | null
          partial_agreement: string
          partial_close_position_pct: number | null
          partial_completeness: number | null
          partial_direction: string | null
          partial_fetch_source: string | null
          partial_hard_override_fired: boolean
          partial_module_bear_pts: number
          partial_module_bull_pts: number
          partial_range_vs_atr: number | null
          partial_snapshot_failure_reason: string | null
          partial_snapshot_present: boolean
          partial_veto_active: boolean
          partial_veto_direction: string | null
          partial_veto_tier: string
          partial_vwap_event: string
          prediction: string
          reasoning_summary: string | null
          resolved_at: string | null
          score_margin: number | null
          score_sum_mismatch: boolean
          settlement_source: string | null
          settlement_ticker: string | null
          settlement_value: number | null
          setup_type: string | null
          status: string
          symbol: string
          timeframe: string
          units: number | null
        }
        Insert: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          advance_check_passed?: boolean | null
          agreement_gate_applied?: boolean
          agreement_gate_reason?: string | null
          api_model_id?: string | null
          base_bearish_score?: number | null
          base_bullish_score?: number | null
          bearish_score?: number | null
          btc_price_at_prediction: number
          bullish_score?: number | null
          candle_ts: string
          change_reason?: string | null
          changed_by_partial?: boolean | null
          confidence: number
          config_hash?: string | null
          conflict_downgrade_applied?: boolean
          conviction_active?: boolean | null
          conviction_aligned?: boolean | null
          conviction_direction?: string | null
          conviction_reasons?: string[] | null
          created_at?: string
          current_partial_minutes_elapsed?: number | null
          current_partial_snapshot?: Json | null
          degraded_mode?: boolean
          engine_version_hash?: string | null
          feed_mismatch?: boolean
          fetch_source?: string | null
          final_trade_status?: string | null
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version: string
          module_points?: Json | null
          notes?: string | null
          orderbook?: Json | null
          original_prediction_before_partial?: string | null
          partial_agreement?: string
          partial_close_position_pct?: number | null
          partial_completeness?: number | null
          partial_direction?: string | null
          partial_fetch_source?: string | null
          partial_hard_override_fired?: boolean
          partial_module_bear_pts?: number
          partial_module_bull_pts?: number
          partial_range_vs_atr?: number | null
          partial_snapshot_failure_reason?: string | null
          partial_snapshot_present?: boolean
          partial_veto_active?: boolean
          partial_veto_direction?: string | null
          partial_veto_tier?: string
          partial_vwap_event?: string
          prediction: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          score_margin?: number | null
          score_sum_mismatch?: boolean
          settlement_source?: string | null
          settlement_ticker?: string | null
          settlement_value?: number | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
          units?: number | null
        }
        Update: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          advance_check_passed?: boolean | null
          agreement_gate_applied?: boolean
          agreement_gate_reason?: string | null
          api_model_id?: string | null
          base_bearish_score?: number | null
          base_bullish_score?: number | null
          bearish_score?: number | null
          btc_price_at_prediction?: number
          bullish_score?: number | null
          candle_ts?: string
          change_reason?: string | null
          changed_by_partial?: boolean | null
          confidence?: number
          config_hash?: string | null
          conflict_downgrade_applied?: boolean
          conviction_active?: boolean | null
          conviction_aligned?: boolean | null
          conviction_direction?: string | null
          conviction_reasons?: string[] | null
          created_at?: string
          current_partial_minutes_elapsed?: number | null
          current_partial_snapshot?: Json | null
          degraded_mode?: boolean
          engine_version_hash?: string | null
          feed_mismatch?: boolean
          fetch_source?: string | null
          final_trade_status?: string | null
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version?: string
          module_points?: Json | null
          notes?: string | null
          orderbook?: Json | null
          original_prediction_before_partial?: string | null
          partial_agreement?: string
          partial_close_position_pct?: number | null
          partial_completeness?: number | null
          partial_direction?: string | null
          partial_fetch_source?: string | null
          partial_hard_override_fired?: boolean
          partial_module_bear_pts?: number
          partial_module_bull_pts?: number
          partial_range_vs_atr?: number | null
          partial_snapshot_failure_reason?: string | null
          partial_snapshot_present?: boolean
          partial_veto_active?: boolean
          partial_veto_direction?: string | null
          partial_veto_tier?: string
          partial_vwap_event?: string
          prediction?: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          score_margin?: number | null
          score_sum_mismatch?: boolean
          settlement_source?: string | null
          settlement_ticker?: string | null
          settlement_value?: number | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
          units?: number | null
        }
        Relationships: []
      }
      predictions_archive: {
        Row: {
          actual_direction: string | null
          actual_next_candle_close: number | null
          actual_next_candle_high: number | null
          actual_next_candle_low: number | null
          actual_next_candle_open: number | null
          advance_check_passed: boolean | null
          agreement_gate_applied: boolean
          agreement_gate_reason: string | null
          api_model_id: string | null
          archived_at: string
          base_bearish_score: number | null
          base_bullish_score: number | null
          bearish_score: number | null
          btc_price_at_prediction: number
          bullish_score: number | null
          candle_ts: string
          change_reason: string | null
          changed_by_partial: boolean | null
          confidence: number
          config_hash: string | null
          conflict_downgrade_applied: boolean
          conviction_active: boolean | null
          conviction_aligned: boolean | null
          conviction_direction: string | null
          conviction_reasons: string[] | null
          created_at: string
          current_partial_minutes_elapsed: number | null
          current_partial_snapshot: Json | null
          degraded_mode: boolean
          engine_version_hash: string | null
          feed_mismatch: boolean
          fetch_source: string | null
          final_trade_status: string | null
          freshness_action: string | null
          full_ai_response: Json | null
          id: string
          indicators: Json | null
          input_candle_age_seconds: number | null
          input_candle_ts: string | null
          input_features_fresh: boolean | null
          market_condition: string | null
          model_version: string
          module_points: Json | null
          notes: string | null
          orderbook: Json | null
          original_prediction_before_partial: string | null
          partial_agreement: string
          partial_close_position_pct: number | null
          partial_completeness: number | null
          partial_direction: string | null
          partial_fetch_source: string | null
          partial_hard_override_fired: boolean
          partial_module_bear_pts: number
          partial_module_bull_pts: number
          partial_range_vs_atr: number | null
          partial_snapshot_failure_reason: string | null
          partial_snapshot_present: boolean
          partial_veto_active: boolean
          partial_veto_direction: string | null
          partial_veto_tier: string
          partial_vwap_event: string
          prediction: string
          reasoning_summary: string | null
          resolved_at: string | null
          score_margin: number | null
          score_sum_mismatch: boolean
          settlement_source: string | null
          settlement_ticker: string | null
          settlement_value: number | null
          setup_type: string | null
          status: string
          symbol: string
          timeframe: string
          units: number | null
        }
        Insert: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          advance_check_passed?: boolean | null
          agreement_gate_applied?: boolean
          agreement_gate_reason?: string | null
          api_model_id?: string | null
          archived_at?: string
          base_bearish_score?: number | null
          base_bullish_score?: number | null
          bearish_score?: number | null
          btc_price_at_prediction: number
          bullish_score?: number | null
          candle_ts: string
          change_reason?: string | null
          changed_by_partial?: boolean | null
          confidence: number
          config_hash?: string | null
          conflict_downgrade_applied?: boolean
          conviction_active?: boolean | null
          conviction_aligned?: boolean | null
          conviction_direction?: string | null
          conviction_reasons?: string[] | null
          created_at?: string
          current_partial_minutes_elapsed?: number | null
          current_partial_snapshot?: Json | null
          degraded_mode?: boolean
          engine_version_hash?: string | null
          feed_mismatch?: boolean
          fetch_source?: string | null
          final_trade_status?: string | null
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version: string
          module_points?: Json | null
          notes?: string | null
          orderbook?: Json | null
          original_prediction_before_partial?: string | null
          partial_agreement?: string
          partial_close_position_pct?: number | null
          partial_completeness?: number | null
          partial_direction?: string | null
          partial_fetch_source?: string | null
          partial_hard_override_fired?: boolean
          partial_module_bear_pts?: number
          partial_module_bull_pts?: number
          partial_range_vs_atr?: number | null
          partial_snapshot_failure_reason?: string | null
          partial_snapshot_present?: boolean
          partial_veto_active?: boolean
          partial_veto_direction?: string | null
          partial_veto_tier?: string
          partial_vwap_event?: string
          prediction: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          score_margin?: number | null
          score_sum_mismatch?: boolean
          settlement_source?: string | null
          settlement_ticker?: string | null
          settlement_value?: number | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
          units?: number | null
        }
        Update: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          advance_check_passed?: boolean | null
          agreement_gate_applied?: boolean
          agreement_gate_reason?: string | null
          api_model_id?: string | null
          archived_at?: string
          base_bearish_score?: number | null
          base_bullish_score?: number | null
          bearish_score?: number | null
          btc_price_at_prediction?: number
          bullish_score?: number | null
          candle_ts?: string
          change_reason?: string | null
          changed_by_partial?: boolean | null
          confidence?: number
          config_hash?: string | null
          conflict_downgrade_applied?: boolean
          conviction_active?: boolean | null
          conviction_aligned?: boolean | null
          conviction_direction?: string | null
          conviction_reasons?: string[] | null
          created_at?: string
          current_partial_minutes_elapsed?: number | null
          current_partial_snapshot?: Json | null
          degraded_mode?: boolean
          engine_version_hash?: string | null
          feed_mismatch?: boolean
          fetch_source?: string | null
          final_trade_status?: string | null
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version?: string
          module_points?: Json | null
          notes?: string | null
          orderbook?: Json | null
          original_prediction_before_partial?: string | null
          partial_agreement?: string
          partial_close_position_pct?: number | null
          partial_completeness?: number | null
          partial_direction?: string | null
          partial_fetch_source?: string | null
          partial_hard_override_fired?: boolean
          partial_module_bear_pts?: number
          partial_module_bull_pts?: number
          partial_range_vs_atr?: number | null
          partial_snapshot_failure_reason?: string | null
          partial_snapshot_present?: boolean
          partial_veto_active?: boolean
          partial_veto_direction?: string | null
          partial_veto_tier?: string
          partial_vwap_event?: string
          prediction?: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          score_margin?: number | null
          score_sum_mismatch?: boolean
          settlement_source?: string | null
          settlement_ticker?: string | null
          settlement_value?: number | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
          units?: number | null
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          delivered_at: string
          endpoint_id: string | null
          error: string | null
          event: string
          id: string
          payload: Json
          response_body: string | null
          status_code: number | null
        }
        Insert: {
          attempt?: number
          delivered_at?: string
          endpoint_id?: string | null
          error?: string | null
          event: string
          id?: string
          payload: Json
          response_body?: string | null
          status_code?: number | null
        }
        Update: {
          attempt?: number
          delivered_at?: string
          endpoint_id?: string | null
          error?: string | null
          event?: string
          id?: string
          payload?: Json
          response_body?: string | null
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          events: string[]
          id: string
          is_active: boolean
          last_delivery_at: string | null
          last_status: number | null
          secret: string
          url: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          last_status?: number | null
          secret: string
          url: string
        }
        Update: {
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          last_status?: number | null
          secret?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_b4_2_resolution: {
        Args: {
          p_b2_final_decision: string
          p_b2_result: string
          p_candle_ts: string
          p_date_mt: string
          p_resolution_id: string
          p_resolved_at: string
        }
        Returns: Json
      }
      arm_b4_2_probe: {
        Args: { p_date_mt: string; p_prediction_id: string }
        Returns: Json
      }
      prediction_stats: { Args: never; Returns: Json }
      prediction_stats_filtered: {
        Args: { model_version_filter?: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
