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
      a96_fit_state: {
        Row: {
          activated_at: string
          artifact_fit_id: string
          comparable_resolved_count: number
          fit_episode_id: string
          is_active: boolean
          layer_a_losses: number
          layer_a_net: number
          layer_a_wins: number
          layer_b_losses: number
          layer_b_net: number
          layer_b_wins: number
          reset_reason: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string
          artifact_fit_id: string
          comparable_resolved_count?: number
          fit_episode_id: string
          is_active?: boolean
          layer_a_losses?: number
          layer_a_net?: number
          layer_a_wins?: number
          layer_b_losses?: number
          layer_b_net?: number
          layer_b_wins?: number
          reset_reason?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string
          artifact_fit_id?: string
          comparable_resolved_count?: number
          fit_episode_id?: string
          is_active?: boolean
          layer_a_losses?: number
          layer_a_net?: number
          layer_a_wins?: number
          layer_b_losses?: number
          layer_b_net?: number
          layer_b_wins?: number
          reset_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      a96_predictions: {
        Row: {
          active_result: string | null
          active_result_score: number | null
          actual_close: number | null
          actual_direction: string | null
          actual_high: number | null
          actual_low: number | null
          actual_open: number | null
          actual_volume: number | null
          agreement_veto_fired: boolean
          aligned_macd_hist_atr: number | null
          artifact_fit_id: string
          base_prediction: string | null
          base_result_score: number | null
          base_selected_layer: string
          body_ratio_condition: boolean | null
          body_ratio_max: number | null
          body_ratio_veto_condition: boolean
          body_ratio_veto_fired: boolean | null
          candle_data_invalid_reason: string | null
          candle_data_valid: boolean | null
          candle_provider: string | null
          candle_symbol: string | null
          candle_timeframe: string | null
          decision_reason: string
          distance_from_4_candle_low_bps: number | null
          distance_veto_condition: boolean
          efficiency_veto_condition: boolean | null
          efficiency_veto_fired: boolean | null
          efficiency_veto_max: number | null
          efficiency_veto_min: number | null
          feature_history_error: string | null
          feature_history_valid: boolean | null
          final_prediction: string
          fit_episode_id: string
          fit_resolved_count_at_prediction: number
          fit_selector_override_fired: boolean
          four_candle_aligned_wick_pressure: number | null
          four_candle_net_displacement: number | null
          four_candle_path_efficiency: number | null
          four_candle_total_body_path: number | null
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          layer_a_direction: string
          layer_a_net_at_prediction: number
          layer_a_prob_margin: number | null
          layer_a_prob_mean: number | null
          layer_a_probability_valid: boolean | null
          layer_a_result_score: number | null
          layer_b_direction: string
          layer_b_net_at_prediction: number
          layer_b_result_score: number | null
          legacy_margin_condition: boolean | null
          legacy_margin_outside_band: boolean | null
          macd_veto_condition: boolean | null
          macd_veto_fired: boolean | null
          macd_veto_max: number | null
          margin_band_eligible: boolean | null
          margin_band_max: number | null
          margin_band_min: number | null
          margin_veto_fired: boolean | null
          mean_2_candle_body_to_range: number | null
          model_name: string
          model_version: string
          prediction_created_at: string
          prediction_id: string
          prior_atr14: number | null
          prior_candle_row_ids: string[] | null
          prior_candles_snapshot: Json | null
          prior_macd_hist: number | null
          prospective_invalid_reason: string | null
          prospective_valid: boolean
          r3_counterfactual_decision: string | null
          r3_counterfactual_direction: string | null
          r3_counterfactual_margin_condition: boolean | null
          r3_counterfactual_reason: string | null
          r3_counterfactual_result: string | null
          r3_counterfactual_result_score: number | null
          r4_feature_history_error: string | null
          r4_feature_history_valid: boolean | null
          r4_feature_snapshot: Json | null
          r4_input_candle_row_ids: Json | null
          r4_input_candle_times: Json | null
          resolution_attempt_count: number
          resolution_candle_row_id: string | null
          resolution_data_invalid: boolean
          resolution_provider: string | null
          resolved_at: string | null
          result_score: number | null
          selected_layer: string
          source_prediction_id: string | null
          target_candle_row_id: string | null
          target_candle_ts: string
          target_open: number | null
          target_open_difference_bps: number | null
          technical_source_candle_row_id: string | null
          technical_source_candle_time: string | null
          variant: string | null
          veto_counterfactual_direction: string | null
          veto_counterfactual_result: string | null
          veto_counterfactual_score: number | null
          webhook_attempt_count: number | null
          webhook_idempotency_key: string | null
          webhook_last_attempt_at: string | null
          webhook_last_error: string | null
          webhook_sent_at: string | null
          webhook_status: string | null
          wick_pressure_condition: boolean | null
          wick_pressure_max: number | null
          wick_pressure_veto_fired: boolean | null
        }
        Insert: {
          active_result?: string | null
          active_result_score?: number | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          actual_volume?: number | null
          agreement_veto_fired?: boolean
          aligned_macd_hist_atr?: number | null
          artifact_fit_id: string
          base_prediction?: string | null
          base_result_score?: number | null
          base_selected_layer: string
          body_ratio_condition?: boolean | null
          body_ratio_max?: number | null
          body_ratio_veto_condition?: boolean
          body_ratio_veto_fired?: boolean | null
          candle_data_invalid_reason?: string | null
          candle_data_valid?: boolean | null
          candle_provider?: string | null
          candle_symbol?: string | null
          candle_timeframe?: string | null
          decision_reason: string
          distance_from_4_candle_low_bps?: number | null
          distance_veto_condition?: boolean
          efficiency_veto_condition?: boolean | null
          efficiency_veto_fired?: boolean | null
          efficiency_veto_max?: number | null
          efficiency_veto_min?: number | null
          feature_history_error?: string | null
          feature_history_valid?: boolean | null
          final_prediction: string
          fit_episode_id: string
          fit_resolved_count_at_prediction: number
          fit_selector_override_fired?: boolean
          four_candle_aligned_wick_pressure?: number | null
          four_candle_net_displacement?: number | null
          four_candle_path_efficiency?: number | null
          four_candle_total_body_path?: number | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          layer_a_direction: string
          layer_a_net_at_prediction: number
          layer_a_prob_margin?: number | null
          layer_a_prob_mean?: number | null
          layer_a_probability_valid?: boolean | null
          layer_a_result_score?: number | null
          layer_b_direction: string
          layer_b_net_at_prediction: number
          layer_b_result_score?: number | null
          legacy_margin_condition?: boolean | null
          legacy_margin_outside_band?: boolean | null
          macd_veto_condition?: boolean | null
          macd_veto_fired?: boolean | null
          macd_veto_max?: number | null
          margin_band_eligible?: boolean | null
          margin_band_max?: number | null
          margin_band_min?: number | null
          margin_veto_fired?: boolean | null
          mean_2_candle_body_to_range?: number | null
          model_name?: string
          model_version?: string
          prediction_created_at?: string
          prediction_id: string
          prior_atr14?: number | null
          prior_candle_row_ids?: string[] | null
          prior_candles_snapshot?: Json | null
          prior_macd_hist?: number | null
          prospective_invalid_reason?: string | null
          prospective_valid?: boolean
          r3_counterfactual_decision?: string | null
          r3_counterfactual_direction?: string | null
          r3_counterfactual_margin_condition?: boolean | null
          r3_counterfactual_reason?: string | null
          r3_counterfactual_result?: string | null
          r3_counterfactual_result_score?: number | null
          r4_feature_history_error?: string | null
          r4_feature_history_valid?: boolean | null
          r4_feature_snapshot?: Json | null
          r4_input_candle_row_ids?: Json | null
          r4_input_candle_times?: Json | null
          resolution_attempt_count?: number
          resolution_candle_row_id?: string | null
          resolution_data_invalid?: boolean
          resolution_provider?: string | null
          resolved_at?: string | null
          result_score?: number | null
          selected_layer: string
          source_prediction_id?: string | null
          target_candle_row_id?: string | null
          target_candle_ts: string
          target_open?: number | null
          target_open_difference_bps?: number | null
          technical_source_candle_row_id?: string | null
          technical_source_candle_time?: string | null
          variant?: string | null
          veto_counterfactual_direction?: string | null
          veto_counterfactual_result?: string | null
          veto_counterfactual_score?: number | null
          webhook_attempt_count?: number | null
          webhook_idempotency_key?: string | null
          webhook_last_attempt_at?: string | null
          webhook_last_error?: string | null
          webhook_sent_at?: string | null
          webhook_status?: string | null
          wick_pressure_condition?: boolean | null
          wick_pressure_max?: number | null
          wick_pressure_veto_fired?: boolean | null
        }
        Update: {
          active_result?: string | null
          active_result_score?: number | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          actual_volume?: number | null
          agreement_veto_fired?: boolean
          aligned_macd_hist_atr?: number | null
          artifact_fit_id?: string
          base_prediction?: string | null
          base_result_score?: number | null
          base_selected_layer?: string
          body_ratio_condition?: boolean | null
          body_ratio_max?: number | null
          body_ratio_veto_condition?: boolean
          body_ratio_veto_fired?: boolean | null
          candle_data_invalid_reason?: string | null
          candle_data_valid?: boolean | null
          candle_provider?: string | null
          candle_symbol?: string | null
          candle_timeframe?: string | null
          decision_reason?: string
          distance_from_4_candle_low_bps?: number | null
          distance_veto_condition?: boolean
          efficiency_veto_condition?: boolean | null
          efficiency_veto_fired?: boolean | null
          efficiency_veto_max?: number | null
          efficiency_veto_min?: number | null
          feature_history_error?: string | null
          feature_history_valid?: boolean | null
          final_prediction?: string
          fit_episode_id?: string
          fit_resolved_count_at_prediction?: number
          fit_selector_override_fired?: boolean
          four_candle_aligned_wick_pressure?: number | null
          four_candle_net_displacement?: number | null
          four_candle_path_efficiency?: number | null
          four_candle_total_body_path?: number | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          layer_a_direction?: string
          layer_a_net_at_prediction?: number
          layer_a_prob_margin?: number | null
          layer_a_prob_mean?: number | null
          layer_a_probability_valid?: boolean | null
          layer_a_result_score?: number | null
          layer_b_direction?: string
          layer_b_net_at_prediction?: number
          layer_b_result_score?: number | null
          legacy_margin_condition?: boolean | null
          legacy_margin_outside_band?: boolean | null
          macd_veto_condition?: boolean | null
          macd_veto_fired?: boolean | null
          macd_veto_max?: number | null
          margin_band_eligible?: boolean | null
          margin_band_max?: number | null
          margin_band_min?: number | null
          margin_veto_fired?: boolean | null
          mean_2_candle_body_to_range?: number | null
          model_name?: string
          model_version?: string
          prediction_created_at?: string
          prediction_id?: string
          prior_atr14?: number | null
          prior_candle_row_ids?: string[] | null
          prior_candles_snapshot?: Json | null
          prior_macd_hist?: number | null
          prospective_invalid_reason?: string | null
          prospective_valid?: boolean
          r3_counterfactual_decision?: string | null
          r3_counterfactual_direction?: string | null
          r3_counterfactual_margin_condition?: boolean | null
          r3_counterfactual_reason?: string | null
          r3_counterfactual_result?: string | null
          r3_counterfactual_result_score?: number | null
          r4_feature_history_error?: string | null
          r4_feature_history_valid?: boolean | null
          r4_feature_snapshot?: Json | null
          r4_input_candle_row_ids?: Json | null
          r4_input_candle_times?: Json | null
          resolution_attempt_count?: number
          resolution_candle_row_id?: string | null
          resolution_data_invalid?: boolean
          resolution_provider?: string | null
          resolved_at?: string | null
          result_score?: number | null
          selected_layer?: string
          source_prediction_id?: string | null
          target_candle_row_id?: string | null
          target_candle_ts?: string
          target_open?: number | null
          target_open_difference_bps?: number | null
          technical_source_candle_row_id?: string | null
          technical_source_candle_time?: string | null
          variant?: string | null
          veto_counterfactual_direction?: string | null
          veto_counterfactual_result?: string | null
          veto_counterfactual_score?: number | null
          webhook_attempt_count?: number | null
          webhook_idempotency_key?: string | null
          webhook_last_attempt_at?: string | null
          webhook_last_error?: string | null
          webhook_sent_at?: string | null
          webhook_status?: string | null
          wick_pressure_condition?: boolean | null
          wick_pressure_max?: number | null
          wick_pressure_veto_fired?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "a96_predictions_fit_episode_id_fkey"
            columns: ["fit_episode_id"]
            isOneToOne: false
            referencedRelation: "a96_fit_state"
            referencedColumns: ["fit_episode_id"]
          },
        ]
      }
      a96_visual_stats_reset: {
        Row: {
          id: number
          reason: string | null
          reset_at: string
        }
        Insert: {
          id?: number
          reason?: string | null
          reset_at?: string
        }
        Update: {
          id?: number
          reason?: string | null
          reset_at?: string
        }
        Relationships: []
      }
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
          controller_decision: string | null
          controller_error: string | null
          controller_model_version: string | null
          controller_skip_reason: string | null
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
          history_cutoff_ts: string | null
          id: string
          in_sample_global_prob_mean: number | null
          in_sample_global_prob_std: number | null
          in_sample_recent_prob_mean: number | null
          in_sample_recent_prob_std: number | null
          latest_resolution_ts_used: string | null
          latest_source_candle_ts: string | null
          leakage_check_passed: boolean | null
          override_applied: boolean | null
          override_reason: string | null
          override_reasons_json: Json | null
          polarity_state: string | null
          predicted_direction: string | null
          prediction_id: string | null
          prediction_row_created_at: string | null
          prediction_row_lead_ms: number | null
          production_model_version: string | null
          prospective_test_id: string | null
          raw_counterfactual_result: string | null
          raw_direction: string | null
          recent_artifact_sha256: string | null
          recent_feature_vector_sha256: string | null
          recent_probability_green: number | null
          resolved_at: string | null
          rolling_raw_edge: number | null
          rolling_raw_losses: number | null
          rolling_raw_wins: number | null
          rolling_window_size: number | null
          scored_at: string | null
          shadow_error: string | null
          skip_reason: string | null
          status: string
          target_boundary_ts: string | null
          timing_guard_passed: boolean | null
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
          controller_decision?: string | null
          controller_error?: string | null
          controller_model_version?: string | null
          controller_skip_reason?: string | null
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
          history_cutoff_ts?: string | null
          id?: string
          in_sample_global_prob_mean?: number | null
          in_sample_global_prob_std?: number | null
          in_sample_recent_prob_mean?: number | null
          in_sample_recent_prob_std?: number | null
          latest_resolution_ts_used?: string | null
          latest_source_candle_ts?: string | null
          leakage_check_passed?: boolean | null
          override_applied?: boolean | null
          override_reason?: string | null
          override_reasons_json?: Json | null
          polarity_state?: string | null
          predicted_direction?: string | null
          prediction_id?: string | null
          prediction_row_created_at?: string | null
          prediction_row_lead_ms?: number | null
          production_model_version?: string | null
          prospective_test_id?: string | null
          raw_counterfactual_result?: string | null
          raw_direction?: string | null
          recent_artifact_sha256?: string | null
          recent_feature_vector_sha256?: string | null
          recent_probability_green?: number | null
          resolved_at?: string | null
          rolling_raw_edge?: number | null
          rolling_raw_losses?: number | null
          rolling_raw_wins?: number | null
          rolling_window_size?: number | null
          scored_at?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          status?: string
          target_boundary_ts?: string | null
          timing_guard_passed?: boolean | null
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
          controller_decision?: string | null
          controller_error?: string | null
          controller_model_version?: string | null
          controller_skip_reason?: string | null
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
          history_cutoff_ts?: string | null
          id?: string
          in_sample_global_prob_mean?: number | null
          in_sample_global_prob_std?: number | null
          in_sample_recent_prob_mean?: number | null
          in_sample_recent_prob_std?: number | null
          latest_resolution_ts_used?: string | null
          latest_source_candle_ts?: string | null
          leakage_check_passed?: boolean | null
          override_applied?: boolean | null
          override_reason?: string | null
          override_reasons_json?: Json | null
          polarity_state?: string | null
          predicted_direction?: string | null
          prediction_id?: string | null
          prediction_row_created_at?: string | null
          prediction_row_lead_ms?: number | null
          production_model_version?: string | null
          prospective_test_id?: string | null
          raw_counterfactual_result?: string | null
          raw_direction?: string | null
          recent_artifact_sha256?: string | null
          recent_feature_vector_sha256?: string | null
          recent_probability_green?: number | null
          resolved_at?: string | null
          rolling_raw_edge?: number | null
          rolling_raw_losses?: number | null
          rolling_raw_wins?: number | null
          rolling_window_size?: number | null
          scored_at?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          status?: string
          target_boundary_ts?: string | null
          timing_guard_passed?: boolean | null
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
      model3_se_blocks: {
        Row: {
          abstain_count: number
          abstained_losers: number
          abstained_winners: number
          block_end_ts: string
          block_id: string
          block_start_ts: string
          coverage: number
          created_at: string
          eligible_candles: number
          fit_id: string
          model_version: string
          published_count: number
          published_losses: number
          published_pushes: number
          published_win_rate: number | null
          published_wins: number
          raw_losses: number
          raw_pushes: number
          raw_win_rate: number | null
          raw_wins: number
          selector_net_effect_sum: number
        }
        Insert: {
          abstain_count: number
          abstained_losers: number
          abstained_winners: number
          block_end_ts: string
          block_id?: string
          block_start_ts: string
          coverage: number
          created_at?: string
          eligible_candles: number
          fit_id: string
          model_version: string
          published_count: number
          published_losses: number
          published_pushes: number
          published_win_rate?: number | null
          published_wins: number
          raw_losses: number
          raw_pushes: number
          raw_win_rate?: number | null
          raw_wins: number
          selector_net_effect_sum: number
        }
        Update: {
          abstain_count?: number
          abstained_losers?: number
          abstained_winners?: number
          block_end_ts?: string
          block_id?: string
          block_start_ts?: string
          coverage?: number
          created_at?: string
          eligible_candles?: number
          fit_id?: string
          model_version?: string
          published_count?: number
          published_losses?: number
          published_pushes?: number
          published_win_rate?: number | null
          published_wins?: number
          raw_losses?: number
          raw_pushes?: number
          raw_win_rate?: number | null
          raw_wins?: number
          selector_net_effect_sum?: number
        }
        Relationships: [
          {
            foreignKeyName: "model3_se_blocks_fit_id_fkey"
            columns: ["fit_id"]
            isOneToOne: false
            referencedRelation: "model3_se_fits"
            referencedColumns: ["fit_id"]
          },
        ]
      }
      model3_se_fits: {
        Row: {
          activated_at: string | null
          artifact: Json
          artifact_hash: string
          calibration_balanced_accuracy: number | null
          calibration_direction_accuracy: number | null
          calibration_direction_brier: number | null
          calibration_direction_log_loss: number | null
          calibration_end: string | null
          calibration_estimated_coverage: number | null
          calibration_rows: number | null
          calibration_start: string | null
          created_at: string
          direction_strength_calibration_max: number | null
          direction_strength_calibration_median: number | null
          direction_strength_calibration_min: number | null
          direction_strength_calibration_p65: number | null
          direction_strength_calibration_p70: number | null
          estimated_coverage: number | null
          failure_reason: string | null
          fast_lambda: number | null
          fast_recency_half_life: number | null
          fast_training_end: string | null
          fast_training_rows: number | null
          fast_training_start: string | null
          feature_schema_hash: string
          feature_schema_version: string
          fit_id: string
          fitted_at: string
          green_class_weight: number | null
          model_version: string
          oof_balanced_accuracy: number | null
          oof_block_size: number | null
          oof_direction_accuracy: number | null
          oof_direction_brier: number | null
          oof_direction_log_loss: number | null
          oof_end: string | null
          oof_rows: number | null
          oof_start: string | null
          predicted_green_share: number | null
          predicted_red_share: number | null
          red_class_weight: number | null
          retired_at: string | null
          selection_threshold: number | null
          selector_bottom40_accuracy: number | null
          selector_brier: number | null
          selector_lambda: number | null
          selector_lambda_search: Json | null
          selector_log_loss: number | null
          selector_pr_auc: number | null
          selector_roc_auc: number | null
          selector_score_calibration_max: number | null
          selector_score_calibration_median: number | null
          selector_score_calibration_min: number | null
          selector_score_calibration_p40: number | null
          selector_score_calibration_p60: number | null
          selector_top20_accuracy: number | null
          selector_top40_accuracy: number | null
          selector_top60_accuracy: number | null
          selector_top60_lift_vs_bottom40: number | null
          selector_top60_lift_vs_raw: number | null
          slow_lambda: number | null
          slow_training_end: string | null
          slow_training_rows: number | null
          slow_training_start: string | null
          stacker_lambda: number | null
          status: string
          target_coverage: number | null
          training_green_count: number | null
          training_red_count: number | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          artifact: Json
          artifact_hash: string
          calibration_balanced_accuracy?: number | null
          calibration_direction_accuracy?: number | null
          calibration_direction_brier?: number | null
          calibration_direction_log_loss?: number | null
          calibration_end?: string | null
          calibration_estimated_coverage?: number | null
          calibration_rows?: number | null
          calibration_start?: string | null
          created_at?: string
          direction_strength_calibration_max?: number | null
          direction_strength_calibration_median?: number | null
          direction_strength_calibration_min?: number | null
          direction_strength_calibration_p65?: number | null
          direction_strength_calibration_p70?: number | null
          estimated_coverage?: number | null
          failure_reason?: string | null
          fast_lambda?: number | null
          fast_recency_half_life?: number | null
          fast_training_end?: string | null
          fast_training_rows?: number | null
          fast_training_start?: string | null
          feature_schema_hash: string
          feature_schema_version: string
          fit_id: string
          fitted_at?: string
          green_class_weight?: number | null
          model_version: string
          oof_balanced_accuracy?: number | null
          oof_block_size?: number | null
          oof_direction_accuracy?: number | null
          oof_direction_brier?: number | null
          oof_direction_log_loss?: number | null
          oof_end?: string | null
          oof_rows?: number | null
          oof_start?: string | null
          predicted_green_share?: number | null
          predicted_red_share?: number | null
          red_class_weight?: number | null
          retired_at?: string | null
          selection_threshold?: number | null
          selector_bottom40_accuracy?: number | null
          selector_brier?: number | null
          selector_lambda?: number | null
          selector_lambda_search?: Json | null
          selector_log_loss?: number | null
          selector_pr_auc?: number | null
          selector_roc_auc?: number | null
          selector_score_calibration_max?: number | null
          selector_score_calibration_median?: number | null
          selector_score_calibration_min?: number | null
          selector_score_calibration_p40?: number | null
          selector_score_calibration_p60?: number | null
          selector_top20_accuracy?: number | null
          selector_top40_accuracy?: number | null
          selector_top60_accuracy?: number | null
          selector_top60_lift_vs_bottom40?: number | null
          selector_top60_lift_vs_raw?: number | null
          slow_lambda?: number | null
          slow_training_end?: string | null
          slow_training_rows?: number | null
          slow_training_start?: string | null
          stacker_lambda?: number | null
          status?: string
          target_coverage?: number | null
          training_green_count?: number | null
          training_red_count?: number | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          artifact?: Json
          artifact_hash?: string
          calibration_balanced_accuracy?: number | null
          calibration_direction_accuracy?: number | null
          calibration_direction_brier?: number | null
          calibration_direction_log_loss?: number | null
          calibration_end?: string | null
          calibration_estimated_coverage?: number | null
          calibration_rows?: number | null
          calibration_start?: string | null
          created_at?: string
          direction_strength_calibration_max?: number | null
          direction_strength_calibration_median?: number | null
          direction_strength_calibration_min?: number | null
          direction_strength_calibration_p65?: number | null
          direction_strength_calibration_p70?: number | null
          estimated_coverage?: number | null
          failure_reason?: string | null
          fast_lambda?: number | null
          fast_recency_half_life?: number | null
          fast_training_end?: string | null
          fast_training_rows?: number | null
          fast_training_start?: string | null
          feature_schema_hash?: string
          feature_schema_version?: string
          fit_id?: string
          fitted_at?: string
          green_class_weight?: number | null
          model_version?: string
          oof_balanced_accuracy?: number | null
          oof_block_size?: number | null
          oof_direction_accuracy?: number | null
          oof_direction_brier?: number | null
          oof_direction_log_loss?: number | null
          oof_end?: string | null
          oof_rows?: number | null
          oof_start?: string | null
          predicted_green_share?: number | null
          predicted_red_share?: number | null
          red_class_weight?: number | null
          retired_at?: string | null
          selection_threshold?: number | null
          selector_bottom40_accuracy?: number | null
          selector_brier?: number | null
          selector_lambda?: number | null
          selector_lambda_search?: Json | null
          selector_log_loss?: number | null
          selector_pr_auc?: number | null
          selector_roc_auc?: number | null
          selector_score_calibration_max?: number | null
          selector_score_calibration_median?: number | null
          selector_score_calibration_min?: number | null
          selector_score_calibration_p40?: number | null
          selector_score_calibration_p60?: number | null
          selector_top20_accuracy?: number | null
          selector_top40_accuracy?: number | null
          selector_top60_accuracy?: number | null
          selector_top60_lift_vs_bottom40?: number | null
          selector_top60_lift_vs_raw?: number | null
          slow_lambda?: number | null
          slow_training_end?: string | null
          slow_training_rows?: number | null
          slow_training_start?: string | null
          stacker_lambda?: number | null
          status?: string
          target_coverage?: number | null
          training_green_count?: number | null
          training_red_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      model3_se_predictions: {
        Row: {
          abstain_category: string | null
          abstain_detail: string | null
          abstain_reason: string | null
          abstained_loser: boolean | null
          abstained_winner: boolean | null
          actual_close: number | null
          actual_direction: string | null
          actual_high: number | null
          actual_low: number | null
          actual_open: number | null
          actual_volume: number | null
          aligned_body_to_atr: number | null
          aligned_ema21_minus_ema50_to_atr: number | null
          aligned_ema9_minus_ema21_to_atr: number | null
          aligned_realized_volatility_8_to_32: number | null
          aligned_ret_log_1: number | null
          aligned_ret_log_2: number | null
          aligned_ret_log_4: number | null
          aligned_ret_log_8: number | null
          aligned_rsi14_centered: number | null
          aligned_trend_efficiency_32: number | null
          atr_percentile_256: number | null
          body_to_atr: number | null
          close_location_in_range: number | null
          code_version: string | null
          consensus_strength: number | null
          created_at: string
          data_quality_reasons: string[] | null
          data_quality_valid: boolean
          direction_confidence_gap: number | null
          direction_strength: number | null
          direction_strength_percentile: number | null
          direction_strength_selected: boolean | null
          direction_strength_threshold: number | null
          ema21_minus_ema50_to_atr: number | null
          ema9_minus_ema21_to_atr: number | null
          expert_agreement: number | null
          expert_disagreement: number | null
          fast_logit: number | null
          fast_recency_half_life: number | null
          feature_nan_count: number | null
          feature_row_valid: boolean | null
          feature_schema_version: string
          fit_activated_at: string | null
          fit_age_predictions: number | null
          fit_calibration_direction_accuracy: number | null
          fit_estimated_coverage: number | null
          fit_id: string | null
          fit_oof_direction_accuracy: number | null
          fit_selector_brier: number | null
          fit_selector_pr_auc: number | null
          fit_selector_roc_auc: number | null
          fit_target_coverage: number | null
          green_class_weight: number | null
          history_rows_used: number | null
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          min_labeled_rows_required: number | null
          minimum_expert_strength: number | null
          model_version: string
          p_correct_calibrated: number | null
          p_correct_raw: number | null
          p_green_fast: number | null
          p_green_slow: number | null
          p_green_stacked_calibrated: number | null
          p_green_stacked_raw: number | null
          prediction_created_at: string
          prediction_id: string
          price_minus_ema21_to_atr: number | null
          prior_candle_poll_attempts: number | null
          prior_candle_ready: boolean | null
          provider: string
          publish_gates: Json | null
          published_net: number | null
          published_prediction: string
          published_result: string | null
          range_percentile_256: number | null
          range_to_atr: number | null
          raw_confidence: number | null
          raw_net: number | null
          raw_prediction: string | null
          raw_result: string | null
          raw_would_win: boolean | null
          realized_volatility_8_to_32: number | null
          red_class_weight: number | null
          resolved_at: string | null
          resolved_rows_since_fit: number | null
          ret_log_1: number | null
          ret_log_16: number | null
          ret_log_2: number | null
          ret_log_4: number | null
          ret_log_8: number | null
          retrain_reason: string | null
          retrained_this_run: boolean | null
          rolling_position_16: number | null
          rolling_position_32: number | null
          rsi14_centered: number | null
          selection_threshold: number | null
          selector_margin: number | null
          selector_net_effect: number | null
          selector_score_percentile: number | null
          selector_score_raw: number | null
          selector_shadow_net: number | null
          selector_shadow_result: string | null
          selector_shadow_selected: boolean | null
          signed_consensus: number | null
          slow_logit: number | null
          stacker_logit_margin: number | null
          symbol: string
          target_candle_ts: string
          target_open: number | null
          timeframe: string
          trend_efficiency_32: number | null
          trend_efficiency_8: number | null
          updated_at: string
          volume_zscore_32: number | null
          wick_imbalance: number | null
        }
        Insert: {
          abstain_category?: string | null
          abstain_detail?: string | null
          abstain_reason?: string | null
          abstained_loser?: boolean | null
          abstained_winner?: boolean | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          actual_volume?: number | null
          aligned_body_to_atr?: number | null
          aligned_ema21_minus_ema50_to_atr?: number | null
          aligned_ema9_minus_ema21_to_atr?: number | null
          aligned_realized_volatility_8_to_32?: number | null
          aligned_ret_log_1?: number | null
          aligned_ret_log_2?: number | null
          aligned_ret_log_4?: number | null
          aligned_ret_log_8?: number | null
          aligned_rsi14_centered?: number | null
          aligned_trend_efficiency_32?: number | null
          atr_percentile_256?: number | null
          body_to_atr?: number | null
          close_location_in_range?: number | null
          code_version?: string | null
          consensus_strength?: number | null
          created_at?: string
          data_quality_reasons?: string[] | null
          data_quality_valid?: boolean
          direction_confidence_gap?: number | null
          direction_strength?: number | null
          direction_strength_percentile?: number | null
          direction_strength_selected?: boolean | null
          direction_strength_threshold?: number | null
          ema21_minus_ema50_to_atr?: number | null
          ema9_minus_ema21_to_atr?: number | null
          expert_agreement?: number | null
          expert_disagreement?: number | null
          fast_logit?: number | null
          fast_recency_half_life?: number | null
          feature_nan_count?: number | null
          feature_row_valid?: boolean | null
          feature_schema_version: string
          fit_activated_at?: string | null
          fit_age_predictions?: number | null
          fit_calibration_direction_accuracy?: number | null
          fit_estimated_coverage?: number | null
          fit_id?: string | null
          fit_oof_direction_accuracy?: number | null
          fit_selector_brier?: number | null
          fit_selector_pr_auc?: number | null
          fit_selector_roc_auc?: number | null
          fit_target_coverage?: number | null
          green_class_weight?: number | null
          history_rows_used?: number | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          min_labeled_rows_required?: number | null
          minimum_expert_strength?: number | null
          model_version: string
          p_correct_calibrated?: number | null
          p_correct_raw?: number | null
          p_green_fast?: number | null
          p_green_slow?: number | null
          p_green_stacked_calibrated?: number | null
          p_green_stacked_raw?: number | null
          prediction_created_at?: string
          prediction_id?: string
          price_minus_ema21_to_atr?: number | null
          prior_candle_poll_attempts?: number | null
          prior_candle_ready?: boolean | null
          provider: string
          publish_gates?: Json | null
          published_net?: number | null
          published_prediction: string
          published_result?: string | null
          range_percentile_256?: number | null
          range_to_atr?: number | null
          raw_confidence?: number | null
          raw_net?: number | null
          raw_prediction?: string | null
          raw_result?: string | null
          raw_would_win?: boolean | null
          realized_volatility_8_to_32?: number | null
          red_class_weight?: number | null
          resolved_at?: string | null
          resolved_rows_since_fit?: number | null
          ret_log_1?: number | null
          ret_log_16?: number | null
          ret_log_2?: number | null
          ret_log_4?: number | null
          ret_log_8?: number | null
          retrain_reason?: string | null
          retrained_this_run?: boolean | null
          rolling_position_16?: number | null
          rolling_position_32?: number | null
          rsi14_centered?: number | null
          selection_threshold?: number | null
          selector_margin?: number | null
          selector_net_effect?: number | null
          selector_score_percentile?: number | null
          selector_score_raw?: number | null
          selector_shadow_net?: number | null
          selector_shadow_result?: string | null
          selector_shadow_selected?: boolean | null
          signed_consensus?: number | null
          slow_logit?: number | null
          stacker_logit_margin?: number | null
          symbol: string
          target_candle_ts: string
          target_open?: number | null
          timeframe: string
          trend_efficiency_32?: number | null
          trend_efficiency_8?: number | null
          updated_at?: string
          volume_zscore_32?: number | null
          wick_imbalance?: number | null
        }
        Update: {
          abstain_category?: string | null
          abstain_detail?: string | null
          abstain_reason?: string | null
          abstained_loser?: boolean | null
          abstained_winner?: boolean | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          actual_volume?: number | null
          aligned_body_to_atr?: number | null
          aligned_ema21_minus_ema50_to_atr?: number | null
          aligned_ema9_minus_ema21_to_atr?: number | null
          aligned_realized_volatility_8_to_32?: number | null
          aligned_ret_log_1?: number | null
          aligned_ret_log_2?: number | null
          aligned_ret_log_4?: number | null
          aligned_ret_log_8?: number | null
          aligned_rsi14_centered?: number | null
          aligned_trend_efficiency_32?: number | null
          atr_percentile_256?: number | null
          body_to_atr?: number | null
          close_location_in_range?: number | null
          code_version?: string | null
          consensus_strength?: number | null
          created_at?: string
          data_quality_reasons?: string[] | null
          data_quality_valid?: boolean
          direction_confidence_gap?: number | null
          direction_strength?: number | null
          direction_strength_percentile?: number | null
          direction_strength_selected?: boolean | null
          direction_strength_threshold?: number | null
          ema21_minus_ema50_to_atr?: number | null
          ema9_minus_ema21_to_atr?: number | null
          expert_agreement?: number | null
          expert_disagreement?: number | null
          fast_logit?: number | null
          fast_recency_half_life?: number | null
          feature_nan_count?: number | null
          feature_row_valid?: boolean | null
          feature_schema_version?: string
          fit_activated_at?: string | null
          fit_age_predictions?: number | null
          fit_calibration_direction_accuracy?: number | null
          fit_estimated_coverage?: number | null
          fit_id?: string | null
          fit_oof_direction_accuracy?: number | null
          fit_selector_brier?: number | null
          fit_selector_pr_auc?: number | null
          fit_selector_roc_auc?: number | null
          fit_target_coverage?: number | null
          green_class_weight?: number | null
          history_rows_used?: number | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          min_labeled_rows_required?: number | null
          minimum_expert_strength?: number | null
          model_version?: string
          p_correct_calibrated?: number | null
          p_correct_raw?: number | null
          p_green_fast?: number | null
          p_green_slow?: number | null
          p_green_stacked_calibrated?: number | null
          p_green_stacked_raw?: number | null
          prediction_created_at?: string
          prediction_id?: string
          price_minus_ema21_to_atr?: number | null
          prior_candle_poll_attempts?: number | null
          prior_candle_ready?: boolean | null
          provider?: string
          publish_gates?: Json | null
          published_net?: number | null
          published_prediction?: string
          published_result?: string | null
          range_percentile_256?: number | null
          range_to_atr?: number | null
          raw_confidence?: number | null
          raw_net?: number | null
          raw_prediction?: string | null
          raw_result?: string | null
          raw_would_win?: boolean | null
          realized_volatility_8_to_32?: number | null
          red_class_weight?: number | null
          resolved_at?: string | null
          resolved_rows_since_fit?: number | null
          ret_log_1?: number | null
          ret_log_16?: number | null
          ret_log_2?: number | null
          ret_log_4?: number | null
          ret_log_8?: number | null
          retrain_reason?: string | null
          retrained_this_run?: boolean | null
          rolling_position_16?: number | null
          rolling_position_32?: number | null
          rsi14_centered?: number | null
          selection_threshold?: number | null
          selector_margin?: number | null
          selector_net_effect?: number | null
          selector_score_percentile?: number | null
          selector_score_raw?: number | null
          selector_shadow_net?: number | null
          selector_shadow_result?: string | null
          selector_shadow_selected?: boolean | null
          signed_consensus?: number | null
          slow_logit?: number | null
          stacker_logit_margin?: number | null
          symbol?: string
          target_candle_ts?: string
          target_open?: number | null
          timeframe?: string
          trend_efficiency_32?: number | null
          trend_efficiency_8?: number | null
          updated_at?: string
          volume_zscore_32?: number | null
          wick_imbalance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "model3_se_predictions_fit_id_fkey"
            columns: ["fit_id"]
            isOneToOne: false
            referencedRelation: "model3_se_fits"
            referencedColumns: ["fit_id"]
          },
        ]
      }
      model7_aas96_fits: {
        Row: {
          active: boolean
          categorical_vocab_json: Json
          coef_l003: Json
          coef_l010: Json
          feature_names: Json
          feature_schema_hash: string
          fit_id: string
          fitted_at: string
          intercept_l003: number
          intercept_l010: number
          layer_b_expert_history_json: Json | null
          scaler_json: Json
          training_row_count: number
        }
        Insert: {
          active?: boolean
          categorical_vocab_json: Json
          coef_l003: Json
          coef_l010: Json
          feature_names: Json
          feature_schema_hash: string
          fit_id?: string
          fitted_at?: string
          intercept_l003: number
          intercept_l010: number
          layer_b_expert_history_json?: Json | null
          scaler_json: Json
          training_row_count: number
        }
        Update: {
          active?: boolean
          categorical_vocab_json?: Json
          coef_l003?: Json
          coef_l010?: Json
          feature_names?: Json
          feature_schema_hash?: string
          fit_id?: string
          fitted_at?: string
          intercept_l003?: number
          intercept_l010?: number
          layer_b_expert_history_json?: Json | null
          scaler_json?: Json
          training_row_count?: number
        }
        Relationships: []
      }
      model7_aas96_layer_b_history_episodes: {
        Row: {
          artifact_fit_id: string
          created_at: string
          history_episode_id: string
          history_payload: Json
          is_active: boolean
          resolved_count: number
          updated_at: string
        }
        Insert: {
          artifact_fit_id: string
          created_at?: string
          history_episode_id?: string
          history_payload?: Json
          is_active?: boolean
          resolved_count?: number
          updated_at?: string
        }
        Update: {
          artifact_fit_id?: string
          created_at?: string
          history_episode_id?: string
          history_payload?: Json
          is_active?: boolean
          resolved_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      model7_aas96_shadow: {
        Row: {
          active_abstain_rule: string | null
          actual_direction: string | null
          armor_override_fired: boolean | null
          armor_override_reason: string | null
          artifact_fit_id_at_prediction: string | null
          baseline_abstain_reason: string | null
          baseline_prediction: string | null
          baseline_would_lose: boolean | null
          baseline_would_win: boolean | null
          candle_ts: string
          cleanup_veto_v1_conflict_subtype: string | null
          cleanup_veto_v1_evaluable: boolean | null
          cleanup_veto_v1_fired: boolean | null
          cleanup_veto_v1_reason: string | null
          cleanup_veto_v1_version: string | null
          continuity_delta_seconds: number | null
          continuity_gate_passed: boolean | null
          created_at: string
          eligibility_passed: boolean | null
          feature_schema_hash: string | null
          final_prediction: string | null
          fit_id: string | null
          history_episode_ownership_unverified: boolean
          id: string
          input_candle_age_seconds: number | null
          input_candle_ts: string | null
          input_feature_timestamp: string | null
          last_training_at: string | null
          layer_a_base_direction: string | null
          layer_a_final_direction: string | null
          layer_a_last96_net: number | null
          layer_a_prob_l003: number | null
          layer_a_prob_l010: number | null
          layer_a_prob_mean: number | null
          layer_b_final_direction: string | null
          layer_b_h192_direction: string | null
          layer_b_h192_score: number | null
          layer_b_h32_direction: string | null
          layer_b_h32_score: number | null
          layer_b_h64_direction: string | null
          layer_b_h64_score: number | null
          layer_b_h96_direction: string | null
          layer_b_h96_score: number | null
          layer_b_history_application_error: string | null
          layer_b_history_application_status: string | null
          layer_b_history_applied_at: string | null
          layer_b_history_episode_id: string | null
          layer_b_horizon_pattern: string | null
          layer_b_last96_net: number | null
          next_retrain_at_count: number | null
          prediction_id: string | null
          published_abstain_reason: string | null
          published_prediction: string | null
          resolved_at: string | null
          result: string | null
          selected_layer: string | null
          selector_b_confirmation_v1_applied: boolean | null
          selector_b_confirmation_v1_btc_price: number | null
          selector_b_confirmation_v1_ema_separation: number | null
          selector_b_confirmation_v1_ema_separation_ratio: number | null
          selector_b_confirmation_v1_ema21: number | null
          selector_b_confirmation_v1_ema9: number | null
          selector_b_confirmation_v1_evaluable: boolean | null
          selector_b_confirmation_v1_final_prediction: string | null
          selector_b_confirmation_v1_final_selected_layer: string | null
          selector_b_confirmation_v1_master_prediction: string | null
          selector_b_confirmation_v1_mode: string | null
          selector_b_confirmation_v1_net_effect: number | null
          selector_b_confirmation_v1_reason: string | null
          selector_b_confirmation_v1_threshold: number | null
          selector_b_confirmation_v1_triggered: boolean | null
          selector_b_confirmation_v1_version: string | null
          selector_b_confirmation_v1_would_lose: boolean | null
          selector_b_confirmation_v1_would_win: boolean | null
          selector_pre_override_prediction: string | null
          selector_pre_override_selected_layer: string | null
          shadow_error: string | null
          skip_reason: string | null
          snapshot_belongs_to_prior_candle: boolean | null
          snapshot_minutes_elapsed: number | null
          status: string
          target_candle_ts: string | null
          training_row_count: number | null
          updated_at: string
          usable_training_row: boolean | null
          variant: string
          veto_avoided_loss: boolean | null
          veto_net_effect: number | null
          veto_sacrificed_win: boolean | null
        }
        Insert: {
          active_abstain_rule?: string | null
          actual_direction?: string | null
          armor_override_fired?: boolean | null
          armor_override_reason?: string | null
          artifact_fit_id_at_prediction?: string | null
          baseline_abstain_reason?: string | null
          baseline_prediction?: string | null
          baseline_would_lose?: boolean | null
          baseline_would_win?: boolean | null
          candle_ts: string
          cleanup_veto_v1_conflict_subtype?: string | null
          cleanup_veto_v1_evaluable?: boolean | null
          cleanup_veto_v1_fired?: boolean | null
          cleanup_veto_v1_reason?: string | null
          cleanup_veto_v1_version?: string | null
          continuity_delta_seconds?: number | null
          continuity_gate_passed?: boolean | null
          created_at?: string
          eligibility_passed?: boolean | null
          feature_schema_hash?: string | null
          final_prediction?: string | null
          fit_id?: string | null
          history_episode_ownership_unverified?: boolean
          id?: string
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_feature_timestamp?: string | null
          last_training_at?: string | null
          layer_a_base_direction?: string | null
          layer_a_final_direction?: string | null
          layer_a_last96_net?: number | null
          layer_a_prob_l003?: number | null
          layer_a_prob_l010?: number | null
          layer_a_prob_mean?: number | null
          layer_b_final_direction?: string | null
          layer_b_h192_direction?: string | null
          layer_b_h192_score?: number | null
          layer_b_h32_direction?: string | null
          layer_b_h32_score?: number | null
          layer_b_h64_direction?: string | null
          layer_b_h64_score?: number | null
          layer_b_h96_direction?: string | null
          layer_b_h96_score?: number | null
          layer_b_history_application_error?: string | null
          layer_b_history_application_status?: string | null
          layer_b_history_applied_at?: string | null
          layer_b_history_episode_id?: string | null
          layer_b_horizon_pattern?: string | null
          layer_b_last96_net?: number | null
          next_retrain_at_count?: number | null
          prediction_id?: string | null
          published_abstain_reason?: string | null
          published_prediction?: string | null
          resolved_at?: string | null
          result?: string | null
          selected_layer?: string | null
          selector_b_confirmation_v1_applied?: boolean | null
          selector_b_confirmation_v1_btc_price?: number | null
          selector_b_confirmation_v1_ema_separation?: number | null
          selector_b_confirmation_v1_ema_separation_ratio?: number | null
          selector_b_confirmation_v1_ema21?: number | null
          selector_b_confirmation_v1_ema9?: number | null
          selector_b_confirmation_v1_evaluable?: boolean | null
          selector_b_confirmation_v1_final_prediction?: string | null
          selector_b_confirmation_v1_final_selected_layer?: string | null
          selector_b_confirmation_v1_master_prediction?: string | null
          selector_b_confirmation_v1_mode?: string | null
          selector_b_confirmation_v1_net_effect?: number | null
          selector_b_confirmation_v1_reason?: string | null
          selector_b_confirmation_v1_threshold?: number | null
          selector_b_confirmation_v1_triggered?: boolean | null
          selector_b_confirmation_v1_version?: string | null
          selector_b_confirmation_v1_would_lose?: boolean | null
          selector_b_confirmation_v1_would_win?: boolean | null
          selector_pre_override_prediction?: string | null
          selector_pre_override_selected_layer?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          snapshot_belongs_to_prior_candle?: boolean | null
          snapshot_minutes_elapsed?: number | null
          status?: string
          target_candle_ts?: string | null
          training_row_count?: number | null
          updated_at?: string
          usable_training_row?: boolean | null
          variant?: string
          veto_avoided_loss?: boolean | null
          veto_net_effect?: number | null
          veto_sacrificed_win?: boolean | null
        }
        Update: {
          active_abstain_rule?: string | null
          actual_direction?: string | null
          armor_override_fired?: boolean | null
          armor_override_reason?: string | null
          artifact_fit_id_at_prediction?: string | null
          baseline_abstain_reason?: string | null
          baseline_prediction?: string | null
          baseline_would_lose?: boolean | null
          baseline_would_win?: boolean | null
          candle_ts?: string
          cleanup_veto_v1_conflict_subtype?: string | null
          cleanup_veto_v1_evaluable?: boolean | null
          cleanup_veto_v1_fired?: boolean | null
          cleanup_veto_v1_reason?: string | null
          cleanup_veto_v1_version?: string | null
          continuity_delta_seconds?: number | null
          continuity_gate_passed?: boolean | null
          created_at?: string
          eligibility_passed?: boolean | null
          feature_schema_hash?: string | null
          final_prediction?: string | null
          fit_id?: string | null
          history_episode_ownership_unverified?: boolean
          id?: string
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_feature_timestamp?: string | null
          last_training_at?: string | null
          layer_a_base_direction?: string | null
          layer_a_final_direction?: string | null
          layer_a_last96_net?: number | null
          layer_a_prob_l003?: number | null
          layer_a_prob_l010?: number | null
          layer_a_prob_mean?: number | null
          layer_b_final_direction?: string | null
          layer_b_h192_direction?: string | null
          layer_b_h192_score?: number | null
          layer_b_h32_direction?: string | null
          layer_b_h32_score?: number | null
          layer_b_h64_direction?: string | null
          layer_b_h64_score?: number | null
          layer_b_h96_direction?: string | null
          layer_b_h96_score?: number | null
          layer_b_history_application_error?: string | null
          layer_b_history_application_status?: string | null
          layer_b_history_applied_at?: string | null
          layer_b_history_episode_id?: string | null
          layer_b_horizon_pattern?: string | null
          layer_b_last96_net?: number | null
          next_retrain_at_count?: number | null
          prediction_id?: string | null
          published_abstain_reason?: string | null
          published_prediction?: string | null
          resolved_at?: string | null
          result?: string | null
          selected_layer?: string | null
          selector_b_confirmation_v1_applied?: boolean | null
          selector_b_confirmation_v1_btc_price?: number | null
          selector_b_confirmation_v1_ema_separation?: number | null
          selector_b_confirmation_v1_ema_separation_ratio?: number | null
          selector_b_confirmation_v1_ema21?: number | null
          selector_b_confirmation_v1_ema9?: number | null
          selector_b_confirmation_v1_evaluable?: boolean | null
          selector_b_confirmation_v1_final_prediction?: string | null
          selector_b_confirmation_v1_final_selected_layer?: string | null
          selector_b_confirmation_v1_master_prediction?: string | null
          selector_b_confirmation_v1_mode?: string | null
          selector_b_confirmation_v1_net_effect?: number | null
          selector_b_confirmation_v1_reason?: string | null
          selector_b_confirmation_v1_threshold?: number | null
          selector_b_confirmation_v1_triggered?: boolean | null
          selector_b_confirmation_v1_version?: string | null
          selector_b_confirmation_v1_would_lose?: boolean | null
          selector_b_confirmation_v1_would_win?: boolean | null
          selector_pre_override_prediction?: string | null
          selector_pre_override_selected_layer?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          snapshot_belongs_to_prior_candle?: boolean | null
          snapshot_minutes_elapsed?: number | null
          status?: string
          target_candle_ts?: string | null
          training_row_count?: number | null
          updated_at?: string
          usable_training_row?: boolean | null
          variant?: string
          veto_avoided_loss?: boolean | null
          veto_net_effect?: number | null
          veto_sacrificed_win?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "model7_aas96_shadow_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      model7_aas96_state: {
        Row: {
          id: number
          last_training_at: string | null
          market_directional_resolutions: number
          next_retrain_at_count: number
          resolved_directional_count: number
          updated_at: string
          usable_training_rows: number
        }
        Insert: {
          id?: number
          last_training_at?: string | null
          market_directional_resolutions?: number
          next_retrain_at_count?: number
          resolved_directional_count?: number
          updated_at?: string
          usable_training_rows?: number
        }
        Update: {
          id?: number
          last_training_at?: string | null
          market_directional_resolutions?: number
          next_retrain_at_count?: number
          resolved_directional_count?: number
          updated_at?: string
          usable_training_rows?: number
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
      model7_td1_fits: {
        Row: {
          activated_at: string | null
          active: boolean
          artifact_sha256: string
          base_variant: string
          created_at: string
          feature_order_json: Json
          fit_id: string
          forward_review_completed_at: string | null
          forward_review_resolved_count: number
          forward_review_started_at: string | null
          id: string
          incumbent_fit_id: string | null
          promoted_at: string | null
          rejected_at: string | null
          review_decision: string | null
          review_reason: string | null
          review_report: Json | null
          status: string
          trained_through_candle_ts: string
          trainer_version: string
          training_row_count: number
          tree_artifact_json: Json
        }
        Insert: {
          activated_at?: string | null
          active?: boolean
          artifact_sha256: string
          base_variant: string
          created_at?: string
          feature_order_json: Json
          fit_id: string
          forward_review_completed_at?: string | null
          forward_review_resolved_count?: number
          forward_review_started_at?: string | null
          id?: string
          incumbent_fit_id?: string | null
          promoted_at?: string | null
          rejected_at?: string | null
          review_decision?: string | null
          review_reason?: string | null
          review_report?: Json | null
          status?: string
          trained_through_candle_ts: string
          trainer_version: string
          training_row_count: number
          tree_artifact_json: Json
        }
        Update: {
          activated_at?: string | null
          active?: boolean
          artifact_sha256?: string
          base_variant?: string
          created_at?: string
          feature_order_json?: Json
          fit_id?: string
          forward_review_completed_at?: string | null
          forward_review_resolved_count?: number
          forward_review_started_at?: string | null
          id?: string
          incumbent_fit_id?: string | null
          promoted_at?: string | null
          rejected_at?: string | null
          review_decision?: string | null
          review_reason?: string | null
          review_report?: Json | null
          status?: string
          trained_through_candle_ts?: string
          trainer_version?: string
          training_row_count?: number
          tree_artifact_json?: Json
        }
        Relationships: []
      }
      model7_td1_rc_resolutions: {
        Row: {
          a2_counterfactual_result: string
          a2_decision: string
          base_variant: string
          candle_ts: string
          created_at: string
          prediction_id: string
          resolution_id: string
          state_after: Json
          state_before: Json
        }
        Insert: {
          a2_counterfactual_result: string
          a2_decision: string
          base_variant: string
          candle_ts: string
          created_at?: string
          prediction_id: string
          resolution_id: string
          state_after: Json
          state_before: Json
        }
        Update: {
          a2_counterfactual_result?: string
          a2_decision?: string
          base_variant?: string
          candle_ts?: string
          created_at?: string
          prediction_id?: string
          resolution_id?: string
          state_after?: Json
          state_before?: Json
        }
        Relationships: []
      }
      model7_td1_rc_shadow: {
        Row: {
          a2_counterfactual_result: string | null
          a2_model_fit_id: string | null
          a2_original_decision: string | null
          a2_probability_green: number | null
          a2_source_row_id: string | null
          a2_source_variant: string
          actual_direction: string | null
          all_veto_reasons_json: Json
          candle_ts: string
          containment_episode_armed_after: boolean | null
          containment_episode_armed_before: boolean | null
          containment_side: string | null
          containment_slots_after: number | null
          containment_slots_before: number | null
          containment_veto_fired: boolean
          created_at: string
          external_final_decision: string | null
          feature_values_json: Json | null
          id: string
          leakage_check_passed: boolean | null
          prediction_id: string
          prospective_test_id: string
          resolved_at: string | null
          result: string | null
          shadow_error: string | null
          skip_reason: string | null
          td1_artifact_sha256: string | null
          td1_candidate_evaluable: boolean | null
          td1_candidate_final_decision: string | null
          td1_candidate_fit_id: string | null
          td1_candidate_leaf_training_loss_count: number | null
          td1_candidate_leaf_training_loss_rate: number | null
          td1_candidate_leaf_training_sample_count: number | null
          td1_candidate_loss_probability: number | null
          td1_candidate_net_effect_vs_incumbent: number | null
          td1_candidate_net_score: number | null
          td1_candidate_shadow_only: boolean | null
          td1_candidate_tree_leaf_id: string | null
          td1_candidate_tree_path: string | null
          td1_candidate_veto_fired: boolean | null
          td1_candidate_would_lose: boolean | null
          td1_candidate_would_win: boolean | null
          td1_compressed_risk_attribution_version: string | null
          td1_compressed_risk_condition: boolean | null
          td1_compressed_risk_counterfactual_direction: string | null
          td1_compressed_risk_counterfactual_result: string | null
          td1_compressed_risk_counterfactual_score: number | null
          td1_compressed_risk_evaluable: boolean | null
          td1_compressed_risk_incremental_change: boolean | null
          td1_compressed_risk_market_condition: string | null
          td1_compressed_risk_probability: number | null
          td1_compressed_risk_reason: string | null
          td1_compressed_risk_source_prediction_row_id: string | null
          td1_compressed_risk_threshold: number | null
          td1_compressed_risk_veto_fired: boolean | null
          td1_compressed_risk_veto_value: number | null
          td1_feature_cutoff_ts: string | null
          td1_feature_vector_sha256: string | null
          td1_fit_id: string | null
          td1_incumbent_final_decision: string | null
          td1_incumbent_fit_id: string | null
          td1_incumbent_leaf_training_loss_count: number | null
          td1_incumbent_leaf_training_loss_rate: number | null
          td1_incumbent_leaf_training_sample_count: number | null
          td1_incumbent_loss_probability: number | null
          td1_incumbent_net_score: number | null
          td1_incumbent_tree_leaf_id: string | null
          td1_incumbent_tree_path: string | null
          td1_incumbent_veto_fired: boolean | null
          td1_incumbent_would_lose: boolean | null
          td1_incumbent_would_win: boolean | null
          td1_latest_source_candle_ts: string | null
          td1_legacy_global_veto_condition: boolean | null
          td1_no_global_veto_decision: string | null
          td1_no_global_veto_result: string | null
          td1_no_global_veto_score: number | null
          td1_no_global_veto_would_trade: boolean | null
          td1_policy_version: string | null
          td1_predicted_loss_probability: number | null
          td1_prev_policy_decision: string | null
          td1_prev_policy_result: string | null
          td1_prev_policy_score: number | null
          td1_prev_policy_skip_reason: string | null
          td1_prev_policy_would_trade: boolean | null
          td1_threshold: number
          td1_veto_fired: boolean
          timing_status: string | null
          updated_at: string
          variant: string
          would_trade: boolean
        }
        Insert: {
          a2_counterfactual_result?: string | null
          a2_model_fit_id?: string | null
          a2_original_decision?: string | null
          a2_probability_green?: number | null
          a2_source_row_id?: string | null
          a2_source_variant: string
          actual_direction?: string | null
          all_veto_reasons_json?: Json
          candle_ts: string
          containment_episode_armed_after?: boolean | null
          containment_episode_armed_before?: boolean | null
          containment_side?: string | null
          containment_slots_after?: number | null
          containment_slots_before?: number | null
          containment_veto_fired?: boolean
          created_at?: string
          external_final_decision?: string | null
          feature_values_json?: Json | null
          id?: string
          leakage_check_passed?: boolean | null
          prediction_id: string
          prospective_test_id: string
          resolved_at?: string | null
          result?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          td1_artifact_sha256?: string | null
          td1_candidate_evaluable?: boolean | null
          td1_candidate_final_decision?: string | null
          td1_candidate_fit_id?: string | null
          td1_candidate_leaf_training_loss_count?: number | null
          td1_candidate_leaf_training_loss_rate?: number | null
          td1_candidate_leaf_training_sample_count?: number | null
          td1_candidate_loss_probability?: number | null
          td1_candidate_net_effect_vs_incumbent?: number | null
          td1_candidate_net_score?: number | null
          td1_candidate_shadow_only?: boolean | null
          td1_candidate_tree_leaf_id?: string | null
          td1_candidate_tree_path?: string | null
          td1_candidate_veto_fired?: boolean | null
          td1_candidate_would_lose?: boolean | null
          td1_candidate_would_win?: boolean | null
          td1_compressed_risk_attribution_version?: string | null
          td1_compressed_risk_condition?: boolean | null
          td1_compressed_risk_counterfactual_direction?: string | null
          td1_compressed_risk_counterfactual_result?: string | null
          td1_compressed_risk_counterfactual_score?: number | null
          td1_compressed_risk_evaluable?: boolean | null
          td1_compressed_risk_incremental_change?: boolean | null
          td1_compressed_risk_market_condition?: string | null
          td1_compressed_risk_probability?: number | null
          td1_compressed_risk_reason?: string | null
          td1_compressed_risk_source_prediction_row_id?: string | null
          td1_compressed_risk_threshold?: number | null
          td1_compressed_risk_veto_fired?: boolean | null
          td1_compressed_risk_veto_value?: number | null
          td1_feature_cutoff_ts?: string | null
          td1_feature_vector_sha256?: string | null
          td1_fit_id?: string | null
          td1_incumbent_final_decision?: string | null
          td1_incumbent_fit_id?: string | null
          td1_incumbent_leaf_training_loss_count?: number | null
          td1_incumbent_leaf_training_loss_rate?: number | null
          td1_incumbent_leaf_training_sample_count?: number | null
          td1_incumbent_loss_probability?: number | null
          td1_incumbent_net_score?: number | null
          td1_incumbent_tree_leaf_id?: string | null
          td1_incumbent_tree_path?: string | null
          td1_incumbent_veto_fired?: boolean | null
          td1_incumbent_would_lose?: boolean | null
          td1_incumbent_would_win?: boolean | null
          td1_latest_source_candle_ts?: string | null
          td1_legacy_global_veto_condition?: boolean | null
          td1_no_global_veto_decision?: string | null
          td1_no_global_veto_result?: string | null
          td1_no_global_veto_score?: number | null
          td1_no_global_veto_would_trade?: boolean | null
          td1_policy_version?: string | null
          td1_predicted_loss_probability?: number | null
          td1_prev_policy_decision?: string | null
          td1_prev_policy_result?: string | null
          td1_prev_policy_score?: number | null
          td1_prev_policy_skip_reason?: string | null
          td1_prev_policy_would_trade?: boolean | null
          td1_threshold?: number
          td1_veto_fired?: boolean
          timing_status?: string | null
          updated_at?: string
          variant?: string
          would_trade?: boolean
        }
        Update: {
          a2_counterfactual_result?: string | null
          a2_model_fit_id?: string | null
          a2_original_decision?: string | null
          a2_probability_green?: number | null
          a2_source_row_id?: string | null
          a2_source_variant?: string
          actual_direction?: string | null
          all_veto_reasons_json?: Json
          candle_ts?: string
          containment_episode_armed_after?: boolean | null
          containment_episode_armed_before?: boolean | null
          containment_side?: string | null
          containment_slots_after?: number | null
          containment_slots_before?: number | null
          containment_veto_fired?: boolean
          created_at?: string
          external_final_decision?: string | null
          feature_values_json?: Json | null
          id?: string
          leakage_check_passed?: boolean | null
          prediction_id?: string
          prospective_test_id?: string
          resolved_at?: string | null
          result?: string | null
          shadow_error?: string | null
          skip_reason?: string | null
          td1_artifact_sha256?: string | null
          td1_candidate_evaluable?: boolean | null
          td1_candidate_final_decision?: string | null
          td1_candidate_fit_id?: string | null
          td1_candidate_leaf_training_loss_count?: number | null
          td1_candidate_leaf_training_loss_rate?: number | null
          td1_candidate_leaf_training_sample_count?: number | null
          td1_candidate_loss_probability?: number | null
          td1_candidate_net_effect_vs_incumbent?: number | null
          td1_candidate_net_score?: number | null
          td1_candidate_shadow_only?: boolean | null
          td1_candidate_tree_leaf_id?: string | null
          td1_candidate_tree_path?: string | null
          td1_candidate_veto_fired?: boolean | null
          td1_candidate_would_lose?: boolean | null
          td1_candidate_would_win?: boolean | null
          td1_compressed_risk_attribution_version?: string | null
          td1_compressed_risk_condition?: boolean | null
          td1_compressed_risk_counterfactual_direction?: string | null
          td1_compressed_risk_counterfactual_result?: string | null
          td1_compressed_risk_counterfactual_score?: number | null
          td1_compressed_risk_evaluable?: boolean | null
          td1_compressed_risk_incremental_change?: boolean | null
          td1_compressed_risk_market_condition?: string | null
          td1_compressed_risk_probability?: number | null
          td1_compressed_risk_reason?: string | null
          td1_compressed_risk_source_prediction_row_id?: string | null
          td1_compressed_risk_threshold?: number | null
          td1_compressed_risk_veto_fired?: boolean | null
          td1_compressed_risk_veto_value?: number | null
          td1_feature_cutoff_ts?: string | null
          td1_feature_vector_sha256?: string | null
          td1_fit_id?: string | null
          td1_incumbent_final_decision?: string | null
          td1_incumbent_fit_id?: string | null
          td1_incumbent_leaf_training_loss_count?: number | null
          td1_incumbent_leaf_training_loss_rate?: number | null
          td1_incumbent_leaf_training_sample_count?: number | null
          td1_incumbent_loss_probability?: number | null
          td1_incumbent_net_score?: number | null
          td1_incumbent_tree_leaf_id?: string | null
          td1_incumbent_tree_path?: string | null
          td1_incumbent_veto_fired?: boolean | null
          td1_incumbent_would_lose?: boolean | null
          td1_incumbent_would_win?: boolean | null
          td1_latest_source_candle_ts?: string | null
          td1_legacy_global_veto_condition?: boolean | null
          td1_no_global_veto_decision?: string | null
          td1_no_global_veto_result?: string | null
          td1_no_global_veto_score?: number | null
          td1_no_global_veto_would_trade?: boolean | null
          td1_policy_version?: string | null
          td1_predicted_loss_probability?: number | null
          td1_prev_policy_decision?: string | null
          td1_prev_policy_result?: string | null
          td1_prev_policy_score?: number | null
          td1_prev_policy_skip_reason?: string | null
          td1_prev_policy_would_trade?: boolean | null
          td1_threshold?: number
          td1_veto_fired?: boolean
          timing_status?: string | null
          updated_at?: string
          variant?: string
          would_trade?: boolean
        }
        Relationships: []
      }
      model7_td1_rc_state: {
        Row: {
          base_variant: string
          last_resolution_id: string | null
          no_consecutive_losses: number
          no_episode_armed: boolean
          no_slots_remaining: number
          updated_at: string
          yes_consecutive_losses: number
          yes_episode_armed: boolean
          yes_slots_remaining: number
        }
        Insert: {
          base_variant: string
          last_resolution_id?: string | null
          no_consecutive_losses?: number
          no_episode_armed?: boolean
          no_slots_remaining?: number
          updated_at?: string
          yes_consecutive_losses?: number
          yes_episode_armed?: boolean
          yes_slots_remaining?: number
        }
        Update: {
          base_variant?: string
          last_resolution_id?: string | null
          no_consecutive_losses?: number
          no_episode_armed?: boolean
          no_slots_remaining?: number
          updated_at?: string
          yes_consecutive_losses?: number
          yes_episode_armed?: boolean
          yes_slots_remaining?: number
        }
        Relationships: []
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
      model8_v3_fit_reviews: {
        Row: {
          active_fit_id: string | null
          candidate_fit_id: string
          created_at: string
          decision: string | null
          model_version: string
          notes: string | null
          report: Json
          requested_at: string
          review_id: string
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          active_fit_id?: string | null
          candidate_fit_id: string
          created_at?: string
          decision?: string | null
          model_version: string
          notes?: string | null
          report: Json
          requested_at?: string
          review_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          active_fit_id?: string | null
          candidate_fit_id?: string
          created_at?: string
          decision?: string | null
          model_version?: string
          notes?: string | null
          report?: Json
          requested_at?: string
          review_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model8_v3_fit_reviews_candidate_fit_id_fkey"
            columns: ["candidate_fit_id"]
            isOneToOne: false
            referencedRelation: "model8_v3_fits"
            referencedColumns: ["fit_id"]
          },
        ]
      }
      model8_v3_fits: {
        Row: {
          activated_at: string
          activation_target_candle_ts: string | null
          calibration_end_ts: string
          calibration_metrics: Json
          calibration_start_ts: string
          code_version: string
          config_snapshot: Json
          direction_coefficients: Json
          direction_intercept: number
          feature_order: Json
          feature_schema_version: string
          fit_id: string
          fitted_at: string
          l2_penalty: number
          model_version: string
          movement_coefficients: Json
          movement_intercept: number
          platt_direction: Json
          platt_movement: Json
          preprocess: Json
          prior_active_fit_id: string | null
          review_decision: string | null
          review_notes: string | null
          review_report: Json | null
          review_requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          symbol: string
          timeframe: string
          training_end_ts: string
          training_metrics: Json
          training_start_ts: string
        }
        Insert: {
          activated_at?: string
          activation_target_candle_ts?: string | null
          calibration_end_ts: string
          calibration_metrics: Json
          calibration_start_ts: string
          code_version: string
          config_snapshot: Json
          direction_coefficients: Json
          direction_intercept: number
          feature_order: Json
          feature_schema_version: string
          fit_id: string
          fitted_at?: string
          l2_penalty: number
          model_version: string
          movement_coefficients: Json
          movement_intercept: number
          platt_direction: Json
          platt_movement: Json
          preprocess: Json
          prior_active_fit_id?: string | null
          review_decision?: string | null
          review_notes?: string | null
          review_report?: Json | null
          review_requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          symbol: string
          timeframe: string
          training_end_ts: string
          training_metrics: Json
          training_start_ts: string
        }
        Update: {
          activated_at?: string
          activation_target_candle_ts?: string | null
          calibration_end_ts?: string
          calibration_metrics?: Json
          calibration_start_ts?: string
          code_version?: string
          config_snapshot?: Json
          direction_coefficients?: Json
          direction_intercept?: number
          feature_order?: Json
          feature_schema_version?: string
          fit_id?: string
          fitted_at?: string
          l2_penalty?: number
          model_version?: string
          movement_coefficients?: Json
          movement_intercept?: number
          platt_direction?: Json
          platt_movement?: Json
          preprocess?: Json
          prior_active_fit_id?: string | null
          review_decision?: string | null
          review_notes?: string | null
          review_report?: Json | null
          review_requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          symbol?: string
          timeframe?: string
          training_end_ts?: string
          training_metrics?: Json
          training_start_ts?: string
        }
        Relationships: []
      }
      model8_v3_predictions: {
        Row: {
          abstain_reason: string | null
          actual_body_bps: number | null
          actual_close: number | null
          actual_direction: string | null
          actual_high: number | null
          actual_low: number | null
          actual_movement_hit: boolean | null
          actual_open: number | null
          actual_volume: number | null
          atr_14_to_price: number | null
          calibrated_probability_green: number | null
          calibrated_probability_movement: number | null
          code_version: string | null
          created_at: string
          data_quality_invalid_reason: string | null
          data_quality_valid: boolean
          ema9_minus_ema21_to_atr: number | null
          episode_type: string
          feature_cutoff_ts: string
          feature_history_valid: boolean
          feature_schema_version: string
          feature_values: Json | null
          fit_id: string | null
          fit_snapshot: Json | null
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          minimum_direction_edge: number | null
          minimum_movement_probability: number | null
          model_version: string
          movement_threshold_bps: number | null
          official_forward_eligible: boolean
          official_forward_test_row: boolean
          prediction_created_before_target: boolean
          prediction_id: string
          prediction_latency_ms: number | null
          qualified_prediction: string
          qualified_result: string | null
          raw_prediction: string | null
          raw_probability_green: number | null
          raw_probability_movement: number | null
          raw_result: string | null
          realized_volatility_32: number | null
          realized_volatility_8: number | null
          regime_alerts: Json | null
          regime_label: string | null
          regime_transition_score: number | null
          resolved_at: string | null
          symbol: string
          target_candle_ts: string
          target_open_at_prediction: number | null
          timeframe: string
          trend_efficiency_32: number | null
          trend_efficiency_8: number | null
          trend_percentile_256: number | null
          updated_at: string
          volatility_percentile_256: number | null
          volatility_ratio_8_32: number | null
          volume_percentile_256: number | null
          volume_zscore_32: number | null
        }
        Insert: {
          abstain_reason?: string | null
          actual_body_bps?: number | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_movement_hit?: boolean | null
          actual_open?: number | null
          actual_volume?: number | null
          atr_14_to_price?: number | null
          calibrated_probability_green?: number | null
          calibrated_probability_movement?: number | null
          code_version?: string | null
          created_at?: string
          data_quality_invalid_reason?: string | null
          data_quality_valid: boolean
          ema9_minus_ema21_to_atr?: number | null
          episode_type?: string
          feature_cutoff_ts: string
          feature_history_valid: boolean
          feature_schema_version?: string
          feature_values?: Json | null
          fit_id?: string | null
          fit_snapshot?: Json | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          minimum_direction_edge?: number | null
          minimum_movement_probability?: number | null
          model_version?: string
          movement_threshold_bps?: number | null
          official_forward_eligible?: boolean
          official_forward_test_row?: boolean
          prediction_created_before_target: boolean
          prediction_id?: string
          prediction_latency_ms?: number | null
          qualified_prediction: string
          qualified_result?: string | null
          raw_prediction?: string | null
          raw_probability_green?: number | null
          raw_probability_movement?: number | null
          raw_result?: string | null
          realized_volatility_32?: number | null
          realized_volatility_8?: number | null
          regime_alerts?: Json | null
          regime_label?: string | null
          regime_transition_score?: number | null
          resolved_at?: string | null
          symbol?: string
          target_candle_ts: string
          target_open_at_prediction?: number | null
          timeframe?: string
          trend_efficiency_32?: number | null
          trend_efficiency_8?: number | null
          trend_percentile_256?: number | null
          updated_at?: string
          volatility_percentile_256?: number | null
          volatility_ratio_8_32?: number | null
          volume_percentile_256?: number | null
          volume_zscore_32?: number | null
        }
        Update: {
          abstain_reason?: string | null
          actual_body_bps?: number | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_movement_hit?: boolean | null
          actual_open?: number | null
          actual_volume?: number | null
          atr_14_to_price?: number | null
          calibrated_probability_green?: number | null
          calibrated_probability_movement?: number | null
          code_version?: string | null
          created_at?: string
          data_quality_invalid_reason?: string | null
          data_quality_valid?: boolean
          ema9_minus_ema21_to_atr?: number | null
          episode_type?: string
          feature_cutoff_ts?: string
          feature_history_valid?: boolean
          feature_schema_version?: string
          feature_values?: Json | null
          fit_id?: string | null
          fit_snapshot?: Json | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          minimum_direction_edge?: number | null
          minimum_movement_probability?: number | null
          model_version?: string
          movement_threshold_bps?: number | null
          official_forward_eligible?: boolean
          official_forward_test_row?: boolean
          prediction_created_before_target?: boolean
          prediction_id?: string
          prediction_latency_ms?: number | null
          qualified_prediction?: string
          qualified_result?: string | null
          raw_prediction?: string | null
          raw_probability_green?: number | null
          raw_probability_movement?: number | null
          raw_result?: string | null
          realized_volatility_32?: number | null
          realized_volatility_8?: number | null
          regime_alerts?: Json | null
          regime_label?: string | null
          regime_transition_score?: number | null
          resolved_at?: string | null
          symbol?: string
          target_candle_ts?: string
          target_open_at_prediction?: number | null
          timeframe?: string
          trend_efficiency_32?: number | null
          trend_efficiency_8?: number | null
          trend_percentile_256?: number | null
          updated_at?: string
          volatility_percentile_256?: number | null
          volatility_ratio_8_32?: number | null
          volume_percentile_256?: number | null
          volume_zscore_32?: number | null
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
      td1_rc_visual_stats_reset: {
        Row: {
          created_at: string
          id: number
          reason: string | null
          reset_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          reason?: string | null
          reset_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          reason?: string | null
          reset_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      v6_predictions: {
        Row: {
          abstain_reason: string | null
          abstain_status: string | null
          aligned_wick_pressure_4: number | null
          anchor_percentile: number | null
          anchor_score: number | null
          base_green_count_last8: number | null
          base_predictions_last8_json: Json | null
          base_v6_adjusted_score: number | null
          base_v6_prediction: string | null
          base_v6_raw_score: number | null
          broad_percentile: number | null
          broad_score: number | null
          canonical_actual_direction: string | null
          canonical_candle_row_id: string | null
          canonical_close: number | null
          canonical_ground_truth_valid: boolean | null
          canonical_high: number | null
          canonical_low: number | null
          canonical_open: number | null
          canonical_volume: number | null
          continuity_valid: boolean
          created_at: string
          cum_vol_delta_to_avg: number | null
          dist_to_high20_pct: number | null
          ema21_50_pct: number | null
          feature_schema_version: string | null
          feature_valid: boolean
          final_adjusted_score: number | null
          final_prediction: string
          final_prediction_source: string | null
          final_raw_score: number | null
          final_score: number | null
          fit_id: string | null
          gb_features_json: Json | null
          gb_p_green: number | null
          gb_percentile: number | null
          green_pickup_adjusted_contribution: number | null
          green_pickup_evaluable: boolean
          green_pickup_raw_contribution: number | null
          green_pickup_triggered: boolean
          green_threshold: number | null
          imputed_feature_count: number
          imputed_features_json: Json | null
          input_candle_ts: string | null
          input_close: number | null
          input_cutoff_ts: string | null
          input_high: number | null
          input_low: number | null
          input_open: number | null
          input_volume: number | null
          lower_wick_pct: number | null
          model_artifact_sha256: string | null
          model_revision: string | null
          model_revision_activated_at: string | null
          model_version: string
          operational_error: string | null
          operational_status: string
          original_v6_base_prediction: string | null
          original_v6_base_source: string | null
          original_v6_shadow_adjusted_score: number | null
          original_v6_shadow_raw_score: number | null
          pickup_conflict: boolean
          pre_inverter_adjusted_score: number | null
          pre_inverter_prediction: string | null
          pre_inverter_prediction_source: string | null
          pre_inverter_raw_score: number | null
          pre_weak_red_veto_adjusted_score: number | null
          pre_weak_red_veto_prediction: string | null
          pre_weak_red_veto_raw_score: number | null
          prediction_after_weak_red_recovery: string | null
          prediction_created_at: string
          prediction_created_before_target: boolean
          prediction_id: string
          prediction_source: string | null
          prediction_source_after_weak_red_recovery: string | null
          prior_candle_ids_json: Json | null
          provider: string
          range_expansion_vs_avg20: number | null
          red_pickup_adjusted_contribution: number | null
          red_pickup_evaluable: boolean
          red_pickup_raw_contribution: number | null
          red_pickup_triggered: boolean
          red_threshold: number | null
          regime_inverter_activation_threshold: number | null
          regime_inverter_active: boolean | null
          regime_inverter_adjusted_contribution: number | null
          regime_inverter_evaluable: boolean | null
          regime_inverter_history_count: number | null
          regime_inverter_history_json: Json | null
          regime_inverter_last20_adjusted_net: number | null
          regime_inverter_last20_losses: number | null
          regime_inverter_last20_wins: number | null
          regime_inverter_original_prediction: string | null
          regime_inverter_raw_contribution: number | null
          regime_inverter_ready: boolean | null
          regime_inverter_reason: string | null
          regime_inverter_replacement_prediction: string | null
          regime_inverter_triggered: boolean | null
          resolution_timestamp: string | null
          ridge_features_json: Json | null
          ridge_p_green: number | null
          ridge_percentile: number | null
          roc_4: number | null
          rsi14: number | null
          saturation_veto_adjusted_contribution: number | null
          saturation_veto_avoided_loss: boolean | null
          saturation_veto_evaluable: boolean
          saturation_veto_raw_contribution: number | null
          saturation_veto_sacrificed_win: boolean | null
          saturation_veto_triggered: boolean
          symbol: string
          target_candle_ts: string
          timeframe: string
          timing_valid: boolean
          updated_at: string
          weak_broad_red_veto_adjusted_contribution: number | null
          weak_broad_red_veto_avoided_loss: boolean | null
          weak_broad_red_veto_evaluable: boolean
          weak_broad_red_veto_raw_contribution: number | null
          weak_broad_red_veto_sacrificed_win: boolean | null
          weak_broad_red_veto_triggered: boolean
          weak_red_recovery_adjusted_contribution: number | null
          weak_red_recovery_adjusted_score: number | null
          weak_red_recovery_counterfactual_adjusted_score: number | null
          weak_red_recovery_evaluable: boolean | null
          weak_red_recovery_published_prediction: string | null
          weak_red_recovery_raw_contribution: number | null
          weak_red_recovery_raw_score: number | null
          weak_red_recovery_reason: string | null
          weak_red_recovery_triggered: boolean | null
          weak_red_roc4_recovery_evaluable: boolean | null
          weak_red_roc4_recovery_triggered: boolean | null
          weak_red_roc4_threshold: number | null
          weak_red_roc4_value: number | null
          weak_red_rsi_recovery_evaluable: boolean | null
          weak_red_rsi_recovery_triggered: boolean | null
          weak_red_rsi_threshold: number | null
          weak_red_rsi_value: number | null
          weak_red_underlying_adjusted_score: number | null
          weak_red_underlying_prediction: string | null
          weak_red_underlying_raw_score: number | null
          weak_red_veto_broad_percentile: number | null
          weak_red_veto_candidate: boolean | null
          weak_red_veto_original_prediction: string | null
        }
        Insert: {
          abstain_reason?: string | null
          abstain_status?: string | null
          aligned_wick_pressure_4?: number | null
          anchor_percentile?: number | null
          anchor_score?: number | null
          base_green_count_last8?: number | null
          base_predictions_last8_json?: Json | null
          base_v6_adjusted_score?: number | null
          base_v6_prediction?: string | null
          base_v6_raw_score?: number | null
          broad_percentile?: number | null
          broad_score?: number | null
          canonical_actual_direction?: string | null
          canonical_candle_row_id?: string | null
          canonical_close?: number | null
          canonical_ground_truth_valid?: boolean | null
          canonical_high?: number | null
          canonical_low?: number | null
          canonical_open?: number | null
          canonical_volume?: number | null
          continuity_valid?: boolean
          created_at?: string
          cum_vol_delta_to_avg?: number | null
          dist_to_high20_pct?: number | null
          ema21_50_pct?: number | null
          feature_schema_version?: string | null
          feature_valid?: boolean
          final_adjusted_score?: number | null
          final_prediction: string
          final_prediction_source?: string | null
          final_raw_score?: number | null
          final_score?: number | null
          fit_id?: string | null
          gb_features_json?: Json | null
          gb_p_green?: number | null
          gb_percentile?: number | null
          green_pickup_adjusted_contribution?: number | null
          green_pickup_evaluable?: boolean
          green_pickup_raw_contribution?: number | null
          green_pickup_triggered?: boolean
          green_threshold?: number | null
          imputed_feature_count?: number
          imputed_features_json?: Json | null
          input_candle_ts?: string | null
          input_close?: number | null
          input_cutoff_ts?: string | null
          input_high?: number | null
          input_low?: number | null
          input_open?: number | null
          input_volume?: number | null
          lower_wick_pct?: number | null
          model_artifact_sha256?: string | null
          model_revision?: string | null
          model_revision_activated_at?: string | null
          model_version?: string
          operational_error?: string | null
          operational_status?: string
          original_v6_base_prediction?: string | null
          original_v6_base_source?: string | null
          original_v6_shadow_adjusted_score?: number | null
          original_v6_shadow_raw_score?: number | null
          pickup_conflict?: boolean
          pre_inverter_adjusted_score?: number | null
          pre_inverter_prediction?: string | null
          pre_inverter_prediction_source?: string | null
          pre_inverter_raw_score?: number | null
          pre_weak_red_veto_adjusted_score?: number | null
          pre_weak_red_veto_prediction?: string | null
          pre_weak_red_veto_raw_score?: number | null
          prediction_after_weak_red_recovery?: string | null
          prediction_created_at?: string
          prediction_created_before_target?: boolean
          prediction_id?: string
          prediction_source?: string | null
          prediction_source_after_weak_red_recovery?: string | null
          prior_candle_ids_json?: Json | null
          provider?: string
          range_expansion_vs_avg20?: number | null
          red_pickup_adjusted_contribution?: number | null
          red_pickup_evaluable?: boolean
          red_pickup_raw_contribution?: number | null
          red_pickup_triggered?: boolean
          red_threshold?: number | null
          regime_inverter_activation_threshold?: number | null
          regime_inverter_active?: boolean | null
          regime_inverter_adjusted_contribution?: number | null
          regime_inverter_evaluable?: boolean | null
          regime_inverter_history_count?: number | null
          regime_inverter_history_json?: Json | null
          regime_inverter_last20_adjusted_net?: number | null
          regime_inverter_last20_losses?: number | null
          regime_inverter_last20_wins?: number | null
          regime_inverter_original_prediction?: string | null
          regime_inverter_raw_contribution?: number | null
          regime_inverter_ready?: boolean | null
          regime_inverter_reason?: string | null
          regime_inverter_replacement_prediction?: string | null
          regime_inverter_triggered?: boolean | null
          resolution_timestamp?: string | null
          ridge_features_json?: Json | null
          ridge_p_green?: number | null
          ridge_percentile?: number | null
          roc_4?: number | null
          rsi14?: number | null
          saturation_veto_adjusted_contribution?: number | null
          saturation_veto_avoided_loss?: boolean | null
          saturation_veto_evaluable?: boolean
          saturation_veto_raw_contribution?: number | null
          saturation_veto_sacrificed_win?: boolean | null
          saturation_veto_triggered?: boolean
          symbol?: string
          target_candle_ts: string
          timeframe?: string
          timing_valid?: boolean
          updated_at?: string
          weak_broad_red_veto_adjusted_contribution?: number | null
          weak_broad_red_veto_avoided_loss?: boolean | null
          weak_broad_red_veto_evaluable?: boolean
          weak_broad_red_veto_raw_contribution?: number | null
          weak_broad_red_veto_sacrificed_win?: boolean | null
          weak_broad_red_veto_triggered?: boolean
          weak_red_recovery_adjusted_contribution?: number | null
          weak_red_recovery_adjusted_score?: number | null
          weak_red_recovery_counterfactual_adjusted_score?: number | null
          weak_red_recovery_evaluable?: boolean | null
          weak_red_recovery_published_prediction?: string | null
          weak_red_recovery_raw_contribution?: number | null
          weak_red_recovery_raw_score?: number | null
          weak_red_recovery_reason?: string | null
          weak_red_recovery_triggered?: boolean | null
          weak_red_roc4_recovery_evaluable?: boolean | null
          weak_red_roc4_recovery_triggered?: boolean | null
          weak_red_roc4_threshold?: number | null
          weak_red_roc4_value?: number | null
          weak_red_rsi_recovery_evaluable?: boolean | null
          weak_red_rsi_recovery_triggered?: boolean | null
          weak_red_rsi_threshold?: number | null
          weak_red_rsi_value?: number | null
          weak_red_underlying_adjusted_score?: number | null
          weak_red_underlying_prediction?: string | null
          weak_red_underlying_raw_score?: number | null
          weak_red_veto_broad_percentile?: number | null
          weak_red_veto_candidate?: boolean | null
          weak_red_veto_original_prediction?: string | null
        }
        Update: {
          abstain_reason?: string | null
          abstain_status?: string | null
          aligned_wick_pressure_4?: number | null
          anchor_percentile?: number | null
          anchor_score?: number | null
          base_green_count_last8?: number | null
          base_predictions_last8_json?: Json | null
          base_v6_adjusted_score?: number | null
          base_v6_prediction?: string | null
          base_v6_raw_score?: number | null
          broad_percentile?: number | null
          broad_score?: number | null
          canonical_actual_direction?: string | null
          canonical_candle_row_id?: string | null
          canonical_close?: number | null
          canonical_ground_truth_valid?: boolean | null
          canonical_high?: number | null
          canonical_low?: number | null
          canonical_open?: number | null
          canonical_volume?: number | null
          continuity_valid?: boolean
          created_at?: string
          cum_vol_delta_to_avg?: number | null
          dist_to_high20_pct?: number | null
          ema21_50_pct?: number | null
          feature_schema_version?: string | null
          feature_valid?: boolean
          final_adjusted_score?: number | null
          final_prediction?: string
          final_prediction_source?: string | null
          final_raw_score?: number | null
          final_score?: number | null
          fit_id?: string | null
          gb_features_json?: Json | null
          gb_p_green?: number | null
          gb_percentile?: number | null
          green_pickup_adjusted_contribution?: number | null
          green_pickup_evaluable?: boolean
          green_pickup_raw_contribution?: number | null
          green_pickup_triggered?: boolean
          green_threshold?: number | null
          imputed_feature_count?: number
          imputed_features_json?: Json | null
          input_candle_ts?: string | null
          input_close?: number | null
          input_cutoff_ts?: string | null
          input_high?: number | null
          input_low?: number | null
          input_open?: number | null
          input_volume?: number | null
          lower_wick_pct?: number | null
          model_artifact_sha256?: string | null
          model_revision?: string | null
          model_revision_activated_at?: string | null
          model_version?: string
          operational_error?: string | null
          operational_status?: string
          original_v6_base_prediction?: string | null
          original_v6_base_source?: string | null
          original_v6_shadow_adjusted_score?: number | null
          original_v6_shadow_raw_score?: number | null
          pickup_conflict?: boolean
          pre_inverter_adjusted_score?: number | null
          pre_inverter_prediction?: string | null
          pre_inverter_prediction_source?: string | null
          pre_inverter_raw_score?: number | null
          pre_weak_red_veto_adjusted_score?: number | null
          pre_weak_red_veto_prediction?: string | null
          pre_weak_red_veto_raw_score?: number | null
          prediction_after_weak_red_recovery?: string | null
          prediction_created_at?: string
          prediction_created_before_target?: boolean
          prediction_id?: string
          prediction_source?: string | null
          prediction_source_after_weak_red_recovery?: string | null
          prior_candle_ids_json?: Json | null
          provider?: string
          range_expansion_vs_avg20?: number | null
          red_pickup_adjusted_contribution?: number | null
          red_pickup_evaluable?: boolean
          red_pickup_raw_contribution?: number | null
          red_pickup_triggered?: boolean
          red_threshold?: number | null
          regime_inverter_activation_threshold?: number | null
          regime_inverter_active?: boolean | null
          regime_inverter_adjusted_contribution?: number | null
          regime_inverter_evaluable?: boolean | null
          regime_inverter_history_count?: number | null
          regime_inverter_history_json?: Json | null
          regime_inverter_last20_adjusted_net?: number | null
          regime_inverter_last20_losses?: number | null
          regime_inverter_last20_wins?: number | null
          regime_inverter_original_prediction?: string | null
          regime_inverter_raw_contribution?: number | null
          regime_inverter_ready?: boolean | null
          regime_inverter_reason?: string | null
          regime_inverter_replacement_prediction?: string | null
          regime_inverter_triggered?: boolean | null
          resolution_timestamp?: string | null
          ridge_features_json?: Json | null
          ridge_p_green?: number | null
          ridge_percentile?: number | null
          roc_4?: number | null
          rsi14?: number | null
          saturation_veto_adjusted_contribution?: number | null
          saturation_veto_avoided_loss?: boolean | null
          saturation_veto_evaluable?: boolean
          saturation_veto_raw_contribution?: number | null
          saturation_veto_sacrificed_win?: boolean | null
          saturation_veto_triggered?: boolean
          symbol?: string
          target_candle_ts?: string
          timeframe?: string
          timing_valid?: boolean
          updated_at?: string
          weak_broad_red_veto_adjusted_contribution?: number | null
          weak_broad_red_veto_avoided_loss?: boolean | null
          weak_broad_red_veto_evaluable?: boolean
          weak_broad_red_veto_raw_contribution?: number | null
          weak_broad_red_veto_sacrificed_win?: boolean | null
          weak_broad_red_veto_triggered?: boolean
          weak_red_recovery_adjusted_contribution?: number | null
          weak_red_recovery_adjusted_score?: number | null
          weak_red_recovery_counterfactual_adjusted_score?: number | null
          weak_red_recovery_evaluable?: boolean | null
          weak_red_recovery_published_prediction?: string | null
          weak_red_recovery_raw_contribution?: number | null
          weak_red_recovery_raw_score?: number | null
          weak_red_recovery_reason?: string | null
          weak_red_recovery_triggered?: boolean | null
          weak_red_roc4_recovery_evaluable?: boolean | null
          weak_red_roc4_recovery_triggered?: boolean | null
          weak_red_roc4_threshold?: number | null
          weak_red_roc4_value?: number | null
          weak_red_rsi_recovery_evaluable?: boolean | null
          weak_red_rsi_recovery_triggered?: boolean | null
          weak_red_rsi_threshold?: number | null
          weak_red_rsi_value?: number | null
          weak_red_underlying_adjusted_score?: number | null
          weak_red_underlying_prediction?: string | null
          weak_red_underlying_raw_score?: number | null
          weak_red_veto_broad_percentile?: number | null
          weak_red_veto_candidate?: boolean | null
          weak_red_veto_original_prediction?: string | null
        }
        Relationships: []
      }
      v6_regime_inverter_state: {
        Row: {
          created_at: string
          feature_schema_version: string | null
          fit_id: string | null
          model_artifact_sha256: string | null
          model_version: string
          regime_inverter_activation_threshold: number
          regime_inverter_active: boolean
          regime_inverter_history_count: number
          regime_inverter_history_json: Json
          regime_inverter_last_resolved_target_ts: string | null
          regime_inverter_last20_adjusted_net: number
          regime_inverter_last20_losses: number
          regime_inverter_last20_wins: number
          regime_inverter_model_revision: string
          regime_inverter_ready: boolean
          regime_inverter_state_updated_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feature_schema_version?: string | null
          fit_id?: string | null
          model_artifact_sha256?: string | null
          model_version: string
          regime_inverter_activation_threshold?: number
          regime_inverter_active?: boolean
          regime_inverter_history_count?: number
          regime_inverter_history_json?: Json
          regime_inverter_last_resolved_target_ts?: string | null
          regime_inverter_last20_adjusted_net?: number
          regime_inverter_last20_losses?: number
          regime_inverter_last20_wins?: number
          regime_inverter_model_revision: string
          regime_inverter_ready?: boolean
          regime_inverter_state_updated_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feature_schema_version?: string | null
          fit_id?: string | null
          model_artifact_sha256?: string | null
          model_version?: string
          regime_inverter_activation_threshold?: number
          regime_inverter_active?: boolean
          regime_inverter_history_count?: number
          regime_inverter_history_json?: Json
          regime_inverter_last_resolved_target_ts?: string | null
          regime_inverter_last20_adjusted_net?: number
          regime_inverter_last20_losses?: number
          regime_inverter_last20_wins?: number
          regime_inverter_model_revision?: string
          regime_inverter_ready?: boolean
          regime_inverter_state_updated_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      v6_visual_stats_reset: {
        Row: {
          id: number
          reason: string | null
          reset_at: string
        }
        Insert: {
          id: number
          reason?: string | null
          reset_at?: string
        }
        Update: {
          id?: number
          reason?: string | null
          reset_at?: string
        }
        Relationships: []
      }
      v6_warmup_state: {
        Row: {
          created_at: string
          feature_schema_version: string | null
          fit_id: string | null
          id: string
          model_artifact_sha256: string | null
          model_version: string
          updated_at: string
          v6_warmup_status: string
          warmup_base_predictions_count: number
          warmup_base_predictions_json: Json
          warmup_candle_count: number
          warmup_completed_at: string | null
          warmup_continuity_valid: boolean
          warmup_error: string | null
          warmup_feature_valid: boolean
          warmup_first_candle_ts: string | null
          warmup_last_candle_ts: string | null
          warmup_next_target_ts: string | null
          warmup_started_at: string | null
        }
        Insert: {
          created_at?: string
          feature_schema_version?: string | null
          fit_id?: string | null
          id?: string
          model_artifact_sha256?: string | null
          model_version: string
          updated_at?: string
          v6_warmup_status?: string
          warmup_base_predictions_count?: number
          warmup_base_predictions_json?: Json
          warmup_candle_count?: number
          warmup_completed_at?: string | null
          warmup_continuity_valid?: boolean
          warmup_error?: string | null
          warmup_feature_valid?: boolean
          warmup_first_candle_ts?: string | null
          warmup_last_candle_ts?: string | null
          warmup_next_target_ts?: string | null
          warmup_started_at?: string | null
        }
        Update: {
          created_at?: string
          feature_schema_version?: string | null
          fit_id?: string | null
          id?: string
          model_artifact_sha256?: string | null
          model_version?: string
          updated_at?: string
          v6_warmup_status?: string
          warmup_base_predictions_count?: number
          warmup_base_predictions_json?: Json
          warmup_candle_count?: number
          warmup_completed_at?: string | null
          warmup_continuity_valid?: boolean
          warmup_error?: string | null
          warmup_feature_valid?: boolean
          warmup_first_candle_ts?: string | null
          warmup_last_candle_ts?: string | null
          warmup_next_target_ts?: string | null
          warmup_started_at?: string | null
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
      a96_daily_performance: {
        Row: {
          abstains: number | null
          losses: number | null
          net_score: number | null
          resolved_predictions: number | null
          utc_date: string | null
          wins: number | null
        }
        Relationships: []
      }
      a96_fit_performance: {
        Row: {
          abstains: number | null
          agreement_vetoes: number | null
          artifact_fit_id: string | null
          first_target_candle_ts: string | null
          fit_episode_id: string | null
          last_target_candle_ts: string | null
          losses: number | null
          net_score: number | null
          resolved_predictions: number | null
          selector_overrides: number | null
          wins: number | null
        }
        Relationships: [
          {
            foreignKeyName: "a96_predictions_fit_episode_id_fkey"
            columns: ["fit_episode_id"]
            isOneToOne: false
            referencedRelation: "a96_fit_state"
            referencedColumns: ["fit_episode_id"]
          },
        ]
      }
    }
    Functions: {
      activate_model8_v3_fit: {
        Args: { p_fit_id: string; p_notes: string; p_reviewed_by: string }
        Returns: Json
      }
      apply_aas96_layer_b_history: {
        Args: {
          p_actual_direction: string
          p_history_episode_id: string
          p_new_history_payload: Json
          p_prediction_id: string
        }
        Returns: Json
      }
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
      apply_td1_rc_resolution: {
        Args: {
          p_base_variant: string
          p_candle_ts: string
          p_prediction_id: string
          p_resolution_id: string
          p_result: string
          p_side: string
        }
        Returns: Json
      }
      arm_b4_2_probe: {
        Args: { p_date_mt: string; p_prediction_id: string }
        Returns: Json
      }
      consume_td1_containment_slot: {
        Args: { p_base_variant: string; p_side: string }
        Returns: Json
      }
      get_or_mint_a96_fit_episode: {
        Args: { p_artifact_fit_id: string }
        Returns: {
          activated_at: string
          artifact_fit_id: string
          comparable_resolved_count: number
          fit_episode_id: string
          is_active: boolean
          layer_a_losses: number
          layer_a_net: number
          layer_a_wins: number
          layer_b_losses: number
          layer_b_net: number
          layer_b_wins: number
          reset_reason: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "a96_fit_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_or_mint_aas96_layer_b_episode: {
        Args: { p_artifact_fit_id: string }
        Returns: {
          artifact_fit_id: string
          created_at: string
          history_episode_id: string
          history_payload: Json
          is_active: boolean
          resolved_count: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "model7_aas96_layer_b_history_episodes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      prediction_stats: { Args: never; Returns: Json }
      prediction_stats_filtered: {
        Args: { model_version_filter?: string }
        Returns: Json
      }
      promote_td1_candidate: {
        Args: {
          p_candidate_fit_id: string
          p_expected_incumbent_fit_id: string
          p_report: Json
        }
        Returns: Json
      }
      reject_model8_v3_fit: {
        Args: {
          p_decision: string
          p_fit_id: string
          p_notes: string
          p_reviewed_by: string
        }
        Returns: Json
      }
      reject_td1_candidate: {
        Args: { p_candidate_fit_id: string; p_reason: string; p_report: Json }
        Returns: Json
      }
      resolve_a96_prediction: {
        Args: {
          p_actual_close: number
          p_actual_high?: number
          p_actual_low?: number
          p_actual_open: number
          p_actual_volume?: number
          p_prediction_id: string
        }
        Returns: Json
      }
      resolve_model8_v3_prediction: {
        Args: {
          p_actual_close: number
          p_actual_high: number
          p_actual_low: number
          p_actual_open: number
          p_actual_volume?: number
          p_prediction_id: string
        }
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
