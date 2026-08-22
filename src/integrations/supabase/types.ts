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
      b4x4_es1_activation: {
        Row: {
          activation_readiness_snapshot: Json
          activation_set_at: string
          activation_target_ts: string
          balanced_activation_set_at: string | null
          balanced_activation_snapshot: Json | null
          balanced_activation_target_ts: string | null
          balanced_policy_version: string | null
          dual_adaptive_activation_snapshot: Json | null
          dual_adaptive_activation_target_ts: string | null
          dual_adaptive_approval_note: string | null
          dual_adaptive_approved_at: string | null
          dual_adaptive_config_hash: string | null
          dual_adaptive_created_at: string | null
          dual_adaptive_mode: string | null
          dual_adaptive_model_version: string | null
          dual_adaptive_policy_version: string | null
          forward_test_sequence_number: number
          id: string
          model_version: string
          precision_activation_snapshot: Json | null
          precision_activation_target_ts: string | null
          precision_approval_note: string | null
          precision_approved_at: string | null
          precision_config_hash: string | null
          precision_created_at: string | null
          precision_mode: string | null
          precision_policy_id: string | null
          precision_policy_version: string | null
        }
        Insert: {
          activation_readiness_snapshot?: Json
          activation_set_at?: string
          activation_target_ts: string
          balanced_activation_set_at?: string | null
          balanced_activation_snapshot?: Json | null
          balanced_activation_target_ts?: string | null
          balanced_policy_version?: string | null
          dual_adaptive_activation_snapshot?: Json | null
          dual_adaptive_activation_target_ts?: string | null
          dual_adaptive_approval_note?: string | null
          dual_adaptive_approved_at?: string | null
          dual_adaptive_config_hash?: string | null
          dual_adaptive_created_at?: string | null
          dual_adaptive_mode?: string | null
          dual_adaptive_model_version?: string | null
          dual_adaptive_policy_version?: string | null
          forward_test_sequence_number?: number
          id: string
          model_version: string
          precision_activation_snapshot?: Json | null
          precision_activation_target_ts?: string | null
          precision_approval_note?: string | null
          precision_approved_at?: string | null
          precision_config_hash?: string | null
          precision_created_at?: string | null
          precision_mode?: string | null
          precision_policy_id?: string | null
          precision_policy_version?: string | null
        }
        Update: {
          activation_readiness_snapshot?: Json
          activation_set_at?: string
          activation_target_ts?: string
          balanced_activation_set_at?: string | null
          balanced_activation_snapshot?: Json | null
          balanced_activation_target_ts?: string | null
          balanced_policy_version?: string | null
          dual_adaptive_activation_snapshot?: Json | null
          dual_adaptive_activation_target_ts?: string | null
          dual_adaptive_approval_note?: string | null
          dual_adaptive_approved_at?: string | null
          dual_adaptive_config_hash?: string | null
          dual_adaptive_created_at?: string | null
          dual_adaptive_mode?: string | null
          dual_adaptive_model_version?: string | null
          dual_adaptive_policy_version?: string | null
          forward_test_sequence_number?: number
          id?: string
          model_version?: string
          precision_activation_snapshot?: Json | null
          precision_activation_target_ts?: string | null
          precision_approval_note?: string | null
          precision_approved_at?: string | null
          precision_config_hash?: string | null
          precision_created_at?: string | null
          precision_mode?: string | null
          precision_policy_id?: string | null
          precision_policy_version?: string | null
        }
        Relationships: []
      }
      b4x4_es1_balanced_shadows: {
        Row: {
          actual_direction: string | null
          agreement_tier: string | null
          candidate_direction: string | null
          config_hash: string | null
          created_at: string
          es1_vote: number | null
          id: string
          implementation_revision: string | null
          incremental_value: number | null
          input_values_hash: string | null
          is_active_policy: boolean
          perp_fade_vote: number | null
          perp_feature_id: string | null
          perp_final_imbalance_10bps: number | null
          perp_mean_imbalance_10bps_60s: number | null
          policy_name: string
          policy_version: string
          prediction_id: string | null
          primary_result_score: number | null
          qualification_reason: string | null
          qualified: boolean
          resolved_at: string | null
          result: string | null
          result_score: number | null
          run_mode: string
          spot_depth_vote: number | null
          spot_feature_id: string | null
          spot_final_imbalance_10bps: number | null
          spot_mean_imbalance_10bps_60s: number | null
          spot_ofi60_vote: number | null
          target_ts: string
          vote_pattern: string | null
          webhook_eligible: boolean
          webhook_sent: boolean
          would_trade: boolean
        }
        Insert: {
          actual_direction?: string | null
          agreement_tier?: string | null
          candidate_direction?: string | null
          config_hash?: string | null
          created_at?: string
          es1_vote?: number | null
          id?: string
          implementation_revision?: string | null
          incremental_value?: number | null
          input_values_hash?: string | null
          is_active_policy?: boolean
          perp_fade_vote?: number | null
          perp_feature_id?: string | null
          perp_final_imbalance_10bps?: number | null
          perp_mean_imbalance_10bps_60s?: number | null
          policy_name: string
          policy_version: string
          prediction_id?: string | null
          primary_result_score?: number | null
          qualification_reason?: string | null
          qualified?: boolean
          resolved_at?: string | null
          result?: string | null
          result_score?: number | null
          run_mode?: string
          spot_depth_vote?: number | null
          spot_feature_id?: string | null
          spot_final_imbalance_10bps?: number | null
          spot_mean_imbalance_10bps_60s?: number | null
          spot_ofi60_vote?: number | null
          target_ts: string
          vote_pattern?: string | null
          webhook_eligible?: boolean
          webhook_sent?: boolean
          would_trade?: boolean
        }
        Update: {
          actual_direction?: string | null
          agreement_tier?: string | null
          candidate_direction?: string | null
          config_hash?: string | null
          created_at?: string
          es1_vote?: number | null
          id?: string
          implementation_revision?: string | null
          incremental_value?: number | null
          input_values_hash?: string | null
          is_active_policy?: boolean
          perp_fade_vote?: number | null
          perp_feature_id?: string | null
          perp_final_imbalance_10bps?: number | null
          perp_mean_imbalance_10bps_60s?: number | null
          policy_name?: string
          policy_version?: string
          prediction_id?: string | null
          primary_result_score?: number | null
          qualification_reason?: string | null
          qualified?: boolean
          resolved_at?: string | null
          result?: string | null
          result_score?: number | null
          run_mode?: string
          spot_depth_vote?: number | null
          spot_feature_id?: string | null
          spot_final_imbalance_10bps?: number | null
          spot_mean_imbalance_10bps_60s?: number | null
          spot_ofi60_vote?: number | null
          target_ts?: string
          vote_pattern?: string | null
          webhook_eligible?: boolean
          webhook_sent?: boolean
          would_trade?: boolean
        }
        Relationships: []
      }
      b4x4_es1_binance_ob_activation: {
        Row: {
          activated_by: string | null
          activation_target_ts: string | null
          approval_note: string | null
          approved_at: string | null
          config_hash: string | null
          created_at: string
          mode: Database["public"]["Enums"]["binance_ob_mode"]
          policy_version: string | null
          selected_policy:
            | Database["public"]["Enums"]["binance_ob_policy_name"]
            | null
          singleton_key: string
          updated_at: string
        }
        Insert: {
          activated_by?: string | null
          activation_target_ts?: string | null
          approval_note?: string | null
          approved_at?: string | null
          config_hash?: string | null
          created_at?: string
          mode?: Database["public"]["Enums"]["binance_ob_mode"]
          policy_version?: string | null
          selected_policy?:
            | Database["public"]["Enums"]["binance_ob_policy_name"]
            | null
          singleton_key?: string
          updated_at?: string
        }
        Update: {
          activated_by?: string | null
          activation_target_ts?: string | null
          approval_note?: string | null
          approved_at?: string | null
          config_hash?: string | null
          created_at?: string
          mode?: Database["public"]["Enums"]["binance_ob_mode"]
          policy_version?: string | null
          selected_policy?:
            | Database["public"]["Enums"]["binance_ob_policy_name"]
            | null
          singleton_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      b4x4_es1_binance_ob_boundary_features: {
        Row: {
          abs_imbalance_percentile_96: number | null
          ask_replenishment_btc_15s: number | null
          ask_replenishment_btc_5s: number | null
          ask_replenishment_btc_60s: number | null
          bid_replenishment_btc_15s: number | null
          bid_replenishment_btc_5s: number | null
          bid_replenishment_btc_60s: number | null
          book_complete_10bps: boolean
          build_identifier: string | null
          capture_status: Database["public"]["Enums"]["binance_ob_capture_status"]
          collector_version: string
          config_hash: string
          created_at: string
          expected_observation_count_60s: number
          failure_reason: string | null
          feature_cutoff_ts: string
          feature_schema_hash: string
          feature_values_hash: string
          feature_version: string
          final_abs_imbalance_10bps: number | null
          final_ask_depth_btc_10bps: number | null
          final_ask_depth_btc_1bps: number | null
          final_ask_depth_btc_2bps: number | null
          final_ask_depth_btc_5bps: number | null
          final_ask_depth_usd_10bps: number | null
          final_best_ask: number | null
          final_best_bid: number | null
          final_bid_depth_btc_10bps: number | null
          final_bid_depth_btc_1bps: number | null
          final_bid_depth_btc_2bps: number | null
          final_bid_depth_btc_5bps: number | null
          final_bid_depth_usd_10bps: number | null
          final_exchange_event_ts: string | null
          final_imbalance_10bps: number | null
          final_imbalance_1bps: number | null
          final_imbalance_2bps: number | null
          final_imbalance_5bps: number | null
          final_microprice_displacement_bps: number | null
          final_mid_price: number | null
          final_received_at: string | null
          final_spread_bps: number | null
          final_target_age_ms: number | null
          final_total_depth_btc_10bps: number | null
          final_total_depth_btc_1bps: number | null
          final_total_depth_btc_2bps: number | null
          final_total_depth_btc_5bps: number | null
          final_total_depth_usd_10bps: number | null
          final_update_id: number | null
          finalized_at: string
          history_ready: boolean
          history_ready_reason: string | null
          history_valid_count: number | null
          id: string
          implementation_revision: string
          market_kind: Database["public"]["Enums"]["binance_ob_market_kind"]
          mean_imbalance_10bps_15s: number | null
          mean_imbalance_10bps_5s: number | null
          mean_imbalance_10bps_60s: number | null
          median_imbalance_10bps_15s: number | null
          median_imbalance_10bps_5s: number | null
          median_imbalance_10bps_60s: number | null
          normalized_ofi_15s: number | null
          normalized_ofi_5s: number | null
          normalized_ofi_60s: number | null
          observation_count_60s: number
          range_imbalance_10bps_15s: number | null
          range_imbalance_10bps_5s: number | null
          range_imbalance_10bps_60s: number | null
          ready: boolean
          ready_reason: string | null
          receive_latency_p50_ms: number | null
          receive_latency_p95_ms: number | null
          resync_continuous: boolean | null
          resync_generation: number
          resync_generation_max: number | null
          resync_generation_min: number | null
          sequence_ok: boolean
          sign_change_count_60s: number | null
          sign_persistence_15s: number | null
          sign_persistence_5s: number | null
          sign_persistence_60s: number | null
          slope_imbalance_10bps_15s: number | null
          slope_imbalance_10bps_5s: number | null
          slope_imbalance_10bps_60s: number | null
          source_ws_url_id: string
          spread_percentile_96: number | null
          stddev_imbalance_10bps_15s: number | null
          stddev_imbalance_10bps_5s: number | null
          stddev_imbalance_10bps_60s: number | null
          symbol: string
          target_ts: string
          total_depth_percentile_96: number | null
          venue: string
          watchdog_created: boolean
        }
        Insert: {
          abs_imbalance_percentile_96?: number | null
          ask_replenishment_btc_15s?: number | null
          ask_replenishment_btc_5s?: number | null
          ask_replenishment_btc_60s?: number | null
          bid_replenishment_btc_15s?: number | null
          bid_replenishment_btc_5s?: number | null
          bid_replenishment_btc_60s?: number | null
          book_complete_10bps?: boolean
          build_identifier?: string | null
          capture_status: Database["public"]["Enums"]["binance_ob_capture_status"]
          collector_version: string
          config_hash: string
          created_at?: string
          expected_observation_count_60s?: number
          failure_reason?: string | null
          feature_cutoff_ts: string
          feature_schema_hash: string
          feature_values_hash: string
          feature_version?: string
          final_abs_imbalance_10bps?: number | null
          final_ask_depth_btc_10bps?: number | null
          final_ask_depth_btc_1bps?: number | null
          final_ask_depth_btc_2bps?: number | null
          final_ask_depth_btc_5bps?: number | null
          final_ask_depth_usd_10bps?: number | null
          final_best_ask?: number | null
          final_best_bid?: number | null
          final_bid_depth_btc_10bps?: number | null
          final_bid_depth_btc_1bps?: number | null
          final_bid_depth_btc_2bps?: number | null
          final_bid_depth_btc_5bps?: number | null
          final_bid_depth_usd_10bps?: number | null
          final_exchange_event_ts?: string | null
          final_imbalance_10bps?: number | null
          final_imbalance_1bps?: number | null
          final_imbalance_2bps?: number | null
          final_imbalance_5bps?: number | null
          final_microprice_displacement_bps?: number | null
          final_mid_price?: number | null
          final_received_at?: string | null
          final_spread_bps?: number | null
          final_target_age_ms?: number | null
          final_total_depth_btc_10bps?: number | null
          final_total_depth_btc_1bps?: number | null
          final_total_depth_btc_2bps?: number | null
          final_total_depth_btc_5bps?: number | null
          final_total_depth_usd_10bps?: number | null
          final_update_id?: number | null
          finalized_at?: string
          history_ready?: boolean
          history_ready_reason?: string | null
          history_valid_count?: number | null
          id?: string
          implementation_revision?: string
          market_kind: Database["public"]["Enums"]["binance_ob_market_kind"]
          mean_imbalance_10bps_15s?: number | null
          mean_imbalance_10bps_5s?: number | null
          mean_imbalance_10bps_60s?: number | null
          median_imbalance_10bps_15s?: number | null
          median_imbalance_10bps_5s?: number | null
          median_imbalance_10bps_60s?: number | null
          normalized_ofi_15s?: number | null
          normalized_ofi_5s?: number | null
          normalized_ofi_60s?: number | null
          observation_count_60s?: number
          range_imbalance_10bps_15s?: number | null
          range_imbalance_10bps_5s?: number | null
          range_imbalance_10bps_60s?: number | null
          ready?: boolean
          ready_reason?: string | null
          receive_latency_p50_ms?: number | null
          receive_latency_p95_ms?: number | null
          resync_continuous?: boolean | null
          resync_generation?: number
          resync_generation_max?: number | null
          resync_generation_min?: number | null
          sequence_ok?: boolean
          sign_change_count_60s?: number | null
          sign_persistence_15s?: number | null
          sign_persistence_5s?: number | null
          sign_persistence_60s?: number | null
          slope_imbalance_10bps_15s?: number | null
          slope_imbalance_10bps_5s?: number | null
          slope_imbalance_10bps_60s?: number | null
          source_ws_url_id: string
          spread_percentile_96?: number | null
          stddev_imbalance_10bps_15s?: number | null
          stddev_imbalance_10bps_5s?: number | null
          stddev_imbalance_10bps_60s?: number | null
          symbol?: string
          target_ts: string
          total_depth_percentile_96?: number | null
          venue?: string
          watchdog_created?: boolean
        }
        Update: {
          abs_imbalance_percentile_96?: number | null
          ask_replenishment_btc_15s?: number | null
          ask_replenishment_btc_5s?: number | null
          ask_replenishment_btc_60s?: number | null
          bid_replenishment_btc_15s?: number | null
          bid_replenishment_btc_5s?: number | null
          bid_replenishment_btc_60s?: number | null
          book_complete_10bps?: boolean
          build_identifier?: string | null
          capture_status?: Database["public"]["Enums"]["binance_ob_capture_status"]
          collector_version?: string
          config_hash?: string
          created_at?: string
          expected_observation_count_60s?: number
          failure_reason?: string | null
          feature_cutoff_ts?: string
          feature_schema_hash?: string
          feature_values_hash?: string
          feature_version?: string
          final_abs_imbalance_10bps?: number | null
          final_ask_depth_btc_10bps?: number | null
          final_ask_depth_btc_1bps?: number | null
          final_ask_depth_btc_2bps?: number | null
          final_ask_depth_btc_5bps?: number | null
          final_ask_depth_usd_10bps?: number | null
          final_best_ask?: number | null
          final_best_bid?: number | null
          final_bid_depth_btc_10bps?: number | null
          final_bid_depth_btc_1bps?: number | null
          final_bid_depth_btc_2bps?: number | null
          final_bid_depth_btc_5bps?: number | null
          final_bid_depth_usd_10bps?: number | null
          final_exchange_event_ts?: string | null
          final_imbalance_10bps?: number | null
          final_imbalance_1bps?: number | null
          final_imbalance_2bps?: number | null
          final_imbalance_5bps?: number | null
          final_microprice_displacement_bps?: number | null
          final_mid_price?: number | null
          final_received_at?: string | null
          final_spread_bps?: number | null
          final_target_age_ms?: number | null
          final_total_depth_btc_10bps?: number | null
          final_total_depth_btc_1bps?: number | null
          final_total_depth_btc_2bps?: number | null
          final_total_depth_btc_5bps?: number | null
          final_total_depth_usd_10bps?: number | null
          final_update_id?: number | null
          finalized_at?: string
          history_ready?: boolean
          history_ready_reason?: string | null
          history_valid_count?: number | null
          id?: string
          implementation_revision?: string
          market_kind?: Database["public"]["Enums"]["binance_ob_market_kind"]
          mean_imbalance_10bps_15s?: number | null
          mean_imbalance_10bps_5s?: number | null
          mean_imbalance_10bps_60s?: number | null
          median_imbalance_10bps_15s?: number | null
          median_imbalance_10bps_5s?: number | null
          median_imbalance_10bps_60s?: number | null
          normalized_ofi_15s?: number | null
          normalized_ofi_5s?: number | null
          normalized_ofi_60s?: number | null
          observation_count_60s?: number
          range_imbalance_10bps_15s?: number | null
          range_imbalance_10bps_5s?: number | null
          range_imbalance_10bps_60s?: number | null
          ready?: boolean
          ready_reason?: string | null
          receive_latency_p50_ms?: number | null
          receive_latency_p95_ms?: number | null
          resync_continuous?: boolean | null
          resync_generation?: number
          resync_generation_max?: number | null
          resync_generation_min?: number | null
          sequence_ok?: boolean
          sign_change_count_60s?: number | null
          sign_persistence_15s?: number | null
          sign_persistence_5s?: number | null
          sign_persistence_60s?: number | null
          slope_imbalance_10bps_15s?: number | null
          slope_imbalance_10bps_5s?: number | null
          slope_imbalance_10bps_60s?: number | null
          source_ws_url_id?: string
          spread_percentile_96?: number | null
          stddev_imbalance_10bps_15s?: number | null
          stddev_imbalance_10bps_5s?: number | null
          stddev_imbalance_10bps_60s?: number | null
          symbol?: string
          target_ts?: string
          total_depth_percentile_96?: number | null
          venue?: string
          watchdog_created?: boolean
        }
        Relationships: []
      }
      b4x4_es1_binance_ob_collector_health: {
        Row: {
          build_identifier: string | null
          collector_status: string
          collector_version: string
          config_hash: string
          connection_started_at: string | null
          consecutive_error_count: number
          deployment_id: string | null
          heartbeat_interval_ms: number
          last_error_code: string | null
          last_error_message: string | null
          last_event: string | null
          last_event_at: string | null
          last_exchange_event_ts: string | null
          last_heartbeat_at: string
          last_received_at: string | null
          last_update_id: number | null
          local_book_initialized: boolean
          market_kind: Database["public"]["Enums"]["binance_ob_market_kind"]
          planned_rollover_count: number
          reconnect_count: number
          region_blocked: boolean
          resync_count: number
          sequence_gap_count: number
          sequence_ok: boolean
          snapshot_sync_count: number
          symbol: string
          updated_at: string
          venue: string
        }
        Insert: {
          build_identifier?: string | null
          collector_status: string
          collector_version: string
          config_hash: string
          connection_started_at?: string | null
          consecutive_error_count?: number
          deployment_id?: string | null
          heartbeat_interval_ms?: number
          last_error_code?: string | null
          last_error_message?: string | null
          last_event?: string | null
          last_event_at?: string | null
          last_exchange_event_ts?: string | null
          last_heartbeat_at: string
          last_received_at?: string | null
          last_update_id?: number | null
          local_book_initialized?: boolean
          market_kind: Database["public"]["Enums"]["binance_ob_market_kind"]
          planned_rollover_count?: number
          reconnect_count?: number
          region_blocked?: boolean
          resync_count?: number
          sequence_gap_count?: number
          sequence_ok?: boolean
          snapshot_sync_count?: number
          symbol?: string
          updated_at?: string
          venue?: string
        }
        Update: {
          build_identifier?: string | null
          collector_status?: string
          collector_version?: string
          config_hash?: string
          connection_started_at?: string | null
          consecutive_error_count?: number
          deployment_id?: string | null
          heartbeat_interval_ms?: number
          last_error_code?: string | null
          last_error_message?: string | null
          last_event?: string | null
          last_event_at?: string | null
          last_exchange_event_ts?: string | null
          last_heartbeat_at?: string
          last_received_at?: string | null
          last_update_id?: number | null
          local_book_initialized?: boolean
          market_kind?: Database["public"]["Enums"]["binance_ob_market_kind"]
          planned_rollover_count?: number
          reconnect_count?: number
          region_blocked?: boolean
          resync_count?: number
          sequence_gap_count?: number
          sequence_ok?: boolean
          snapshot_sync_count?: number
          symbol?: string
          updated_at?: string
          venue?: string
        }
        Relationships: []
      }
      b4x4_es1_binance_ob_observations: {
        Row: {
          abs_imbalance_10bps: number | null
          ask_added_btc_1s: number | null
          ask_depth_btc_10bps: number | null
          ask_depth_btc_1bps: number | null
          ask_depth_btc_2bps: number | null
          ask_depth_btc_5bps: number | null
          ask_depth_usd_10bps: number | null
          ask_removed_btc_1s: number | null
          best_ask: number | null
          best_ask_qty_btc: number | null
          best_bid: number | null
          best_bid_qty_btc: number | null
          bid_added_btc_1s: number | null
          bid_depth_btc_10bps: number | null
          bid_depth_btc_1bps: number | null
          bid_depth_btc_2bps: number | null
          bid_depth_btc_5bps: number | null
          bid_depth_usd_10bps: number | null
          bid_removed_btc_1s: number | null
          book_complete_10bps: boolean
          build_identifier: string | null
          capture_reason: string | null
          capture_status: Database["public"]["Enums"]["binance_ob_capture_status"]
          collector_version: string
          config_hash: string
          created_at: string
          exchange_event_ts: string | null
          exchange_to_receive_ms: number | null
          feature_cutoff_ts: string
          feature_schema_hash: string
          first_update_id: number | null
          id: string
          imbalance_10bps: number | null
          imbalance_1bps: number | null
          imbalance_2bps: number | null
          imbalance_5bps: number | null
          implementation_revision: string
          last_update_id: number | null
          local_book_initialized: boolean
          market_kind: Database["public"]["Enums"]["binance_ob_market_kind"]
          microprice: number | null
          microprice_displacement_bps: number | null
          mid_price: number | null
          normalized_ofi_1s: number | null
          previous_update_id: number | null
          received_at: string | null
          resync_generation: number
          sample_offset_seconds: number
          sample_ts: string
          sequence_ok: boolean
          source_ws_url_id: string
          spread_bps: number | null
          symbol: string
          target_age_ms: number | null
          target_ts: string
          total_depth_btc_10bps: number | null
          total_depth_btc_1bps: number | null
          total_depth_btc_2bps: number | null
          total_depth_btc_5bps: number | null
          total_depth_usd_10bps: number | null
          update_count_1s: number
          venue: string
        }
        Insert: {
          abs_imbalance_10bps?: number | null
          ask_added_btc_1s?: number | null
          ask_depth_btc_10bps?: number | null
          ask_depth_btc_1bps?: number | null
          ask_depth_btc_2bps?: number | null
          ask_depth_btc_5bps?: number | null
          ask_depth_usd_10bps?: number | null
          ask_removed_btc_1s?: number | null
          best_ask?: number | null
          best_ask_qty_btc?: number | null
          best_bid?: number | null
          best_bid_qty_btc?: number | null
          bid_added_btc_1s?: number | null
          bid_depth_btc_10bps?: number | null
          bid_depth_btc_1bps?: number | null
          bid_depth_btc_2bps?: number | null
          bid_depth_btc_5bps?: number | null
          bid_depth_usd_10bps?: number | null
          bid_removed_btc_1s?: number | null
          book_complete_10bps?: boolean
          build_identifier?: string | null
          capture_reason?: string | null
          capture_status: Database["public"]["Enums"]["binance_ob_capture_status"]
          collector_version: string
          config_hash: string
          created_at?: string
          exchange_event_ts?: string | null
          exchange_to_receive_ms?: number | null
          feature_cutoff_ts: string
          feature_schema_hash: string
          first_update_id?: number | null
          id?: string
          imbalance_10bps?: number | null
          imbalance_1bps?: number | null
          imbalance_2bps?: number | null
          imbalance_5bps?: number | null
          implementation_revision?: string
          last_update_id?: number | null
          local_book_initialized?: boolean
          market_kind: Database["public"]["Enums"]["binance_ob_market_kind"]
          microprice?: number | null
          microprice_displacement_bps?: number | null
          mid_price?: number | null
          normalized_ofi_1s?: number | null
          previous_update_id?: number | null
          received_at?: string | null
          resync_generation?: number
          sample_offset_seconds: number
          sample_ts: string
          sequence_ok?: boolean
          source_ws_url_id: string
          spread_bps?: number | null
          symbol?: string
          target_age_ms?: number | null
          target_ts: string
          total_depth_btc_10bps?: number | null
          total_depth_btc_1bps?: number | null
          total_depth_btc_2bps?: number | null
          total_depth_btc_5bps?: number | null
          total_depth_usd_10bps?: number | null
          update_count_1s?: number
          venue?: string
        }
        Update: {
          abs_imbalance_10bps?: number | null
          ask_added_btc_1s?: number | null
          ask_depth_btc_10bps?: number | null
          ask_depth_btc_1bps?: number | null
          ask_depth_btc_2bps?: number | null
          ask_depth_btc_5bps?: number | null
          ask_depth_usd_10bps?: number | null
          ask_removed_btc_1s?: number | null
          best_ask?: number | null
          best_ask_qty_btc?: number | null
          best_bid?: number | null
          best_bid_qty_btc?: number | null
          bid_added_btc_1s?: number | null
          bid_depth_btc_10bps?: number | null
          bid_depth_btc_1bps?: number | null
          bid_depth_btc_2bps?: number | null
          bid_depth_btc_5bps?: number | null
          bid_depth_usd_10bps?: number | null
          bid_removed_btc_1s?: number | null
          book_complete_10bps?: boolean
          build_identifier?: string | null
          capture_reason?: string | null
          capture_status?: Database["public"]["Enums"]["binance_ob_capture_status"]
          collector_version?: string
          config_hash?: string
          created_at?: string
          exchange_event_ts?: string | null
          exchange_to_receive_ms?: number | null
          feature_cutoff_ts?: string
          feature_schema_hash?: string
          first_update_id?: number | null
          id?: string
          imbalance_10bps?: number | null
          imbalance_1bps?: number | null
          imbalance_2bps?: number | null
          imbalance_5bps?: number | null
          implementation_revision?: string
          last_update_id?: number | null
          local_book_initialized?: boolean
          market_kind?: Database["public"]["Enums"]["binance_ob_market_kind"]
          microprice?: number | null
          microprice_displacement_bps?: number | null
          mid_price?: number | null
          normalized_ofi_1s?: number | null
          previous_update_id?: number | null
          received_at?: string | null
          resync_generation?: number
          sample_offset_seconds?: number
          sample_ts?: string
          sequence_ok?: boolean
          source_ws_url_id?: string
          spread_bps?: number | null
          symbol?: string
          target_age_ms?: number | null
          target_ts?: string
          total_depth_btc_10bps?: number | null
          total_depth_btc_1bps?: number | null
          total_depth_btc_2bps?: number | null
          total_depth_btc_5bps?: number | null
          total_depth_usd_10bps?: number | null
          update_count_1s?: number
          venue?: string
        }
        Relationships: []
      }
      b4x4_es1_binance_ob_policy_shadows: {
        Row: {
          actual_direction: string | null
          candidate_direction: string | null
          config_hash: string
          created_at: string
          decision_reason: string
          id: string
          implementation_revision: string
          input_values_hash: string
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          perp_abs_percentile_96: number | null
          perp_feature_id: string | null
          perp_final_imbalance_10bps: number | null
          perp_sign_persistence_15s: number | null
          policy_name: Database["public"]["Enums"]["binance_ob_policy_name"]
          policy_version: string
          prediction_id: string | null
          qualification_reason: string
          qualified: boolean
          resolution_attempt_count: number
          resolved_at: string | null
          resolver_version: string | null
          result: string | null
          result_score: number | null
          run_mode: string
          spot_abs_percentile_96: number | null
          spot_feature_id: string | null
          spot_final_imbalance_10bps: number | null
          spot_perp_sign_agree: boolean | null
          spot_sign_persistence_15s: number | null
          target_ts: string
          updated_at: string
          webhook_eligible: boolean
          would_trade: boolean
        }
        Insert: {
          actual_direction?: string | null
          candidate_direction?: string | null
          config_hash: string
          created_at?: string
          decision_reason: string
          id?: string
          implementation_revision?: string
          input_values_hash: string
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          perp_abs_percentile_96?: number | null
          perp_feature_id?: string | null
          perp_final_imbalance_10bps?: number | null
          perp_sign_persistence_15s?: number | null
          policy_name: Database["public"]["Enums"]["binance_ob_policy_name"]
          policy_version?: string
          prediction_id?: string | null
          qualification_reason: string
          qualified?: boolean
          resolution_attempt_count?: number
          resolved_at?: string | null
          resolver_version?: string | null
          result?: string | null
          result_score?: number | null
          run_mode: string
          spot_abs_percentile_96?: number | null
          spot_feature_id?: string | null
          spot_final_imbalance_10bps?: number | null
          spot_perp_sign_agree?: boolean | null
          spot_sign_persistence_15s?: number | null
          target_ts: string
          updated_at?: string
          webhook_eligible?: boolean
          would_trade?: boolean
        }
        Update: {
          actual_direction?: string | null
          candidate_direction?: string | null
          config_hash?: string
          created_at?: string
          decision_reason?: string
          id?: string
          implementation_revision?: string
          input_values_hash?: string
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          perp_abs_percentile_96?: number | null
          perp_feature_id?: string | null
          perp_final_imbalance_10bps?: number | null
          perp_sign_persistence_15s?: number | null
          policy_name?: Database["public"]["Enums"]["binance_ob_policy_name"]
          policy_version?: string
          prediction_id?: string | null
          qualification_reason?: string
          qualified?: boolean
          resolution_attempt_count?: number
          resolved_at?: string | null
          resolver_version?: string | null
          result?: string | null
          result_score?: number | null
          run_mode?: string
          spot_abs_percentile_96?: number | null
          spot_feature_id?: string | null
          spot_final_imbalance_10bps?: number | null
          spot_perp_sign_agree?: boolean | null
          spot_sign_persistence_15s?: number | null
          target_ts?: string
          updated_at?: string
          webhook_eligible?: boolean
          would_trade?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "b4x4_es1_binance_ob_policy_shadows_perp_feature_id_fkey"
            columns: ["perp_feature_id"]
            isOneToOne: false
            referencedRelation: "b4x4_es1_binance_ob_boundary_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b4x4_es1_binance_ob_policy_shadows_spot_feature_id_fkey"
            columns: ["spot_feature_id"]
            isOneToOne: false
            referencedRelation: "b4x4_es1_binance_ob_boundary_features"
            referencedColumns: ["id"]
          },
        ]
      }
      b4x4_es1_fits: {
        Row: {
          artifact_sha256: string
          block_index: number
          certified_fitter_code_hash: string | null
          coefficients: Json
          config_hash: string | null
          converged: boolean | null
          created_at: string
          feature_schema_hash: string
          fit_id: string
          fit_source: string | null
          gradient_norm: number | null
          intercept: number
          iterations: number | null
          logistic_c: number
          model_version: string | null
          price_fit_certified: boolean | null
          scaler_center: Json
          scaler_name: string
          scaler_scale: Json
          solver: string
          specification: string
          training_end_index: number | null
          training_end_ts: string | null
          training_row_count: number
          training_start_index: number | null
          training_start_ts: string | null
          window_fingerprint: string | null
        }
        Insert: {
          artifact_sha256: string
          block_index: number
          certified_fitter_code_hash?: string | null
          coefficients: Json
          config_hash?: string | null
          converged?: boolean | null
          created_at?: string
          feature_schema_hash: string
          fit_id: string
          fit_source?: string | null
          gradient_norm?: number | null
          intercept: number
          iterations?: number | null
          logistic_c: number
          model_version?: string | null
          price_fit_certified?: boolean | null
          scaler_center: Json
          scaler_name: string
          scaler_scale: Json
          solver: string
          specification: string
          training_end_index?: number | null
          training_end_ts?: string | null
          training_row_count: number
          training_start_index?: number | null
          training_start_ts?: string | null
          window_fingerprint?: string | null
        }
        Update: {
          artifact_sha256?: string
          block_index?: number
          certified_fitter_code_hash?: string | null
          coefficients?: Json
          config_hash?: string | null
          converged?: boolean | null
          created_at?: string
          feature_schema_hash?: string
          fit_id?: string
          fit_source?: string | null
          gradient_norm?: number | null
          intercept?: number
          iterations?: number | null
          logistic_c?: number
          model_version?: string | null
          price_fit_certified?: boolean | null
          scaler_center?: Json
          scaler_name?: string
          scaler_scale?: Json
          solver?: string
          specification?: string
          training_end_index?: number | null
          training_end_ts?: string | null
          training_row_count?: number
          training_start_index?: number | null
          training_start_ts?: string | null
          window_fingerprint?: string | null
        }
        Relationships: []
      }
      b4x4_es1_predictions: {
        Row: {
          a2_agrees: boolean | null
          a2_confidence: number | null
          a2_confidence_rank: number | null
          a2_direction: string | null
          a2_model_fit_id: string | null
          a2_prediction_id: string | null
          a2_probability_green: number | null
          a2_production_model_version: string | null
          a2_rank_history_count: number | null
          a2_row_id: string | null
          a2_source_variant: string | null
          actual_close: number | null
          actual_direction: string | null
          actual_high: number | null
          actual_low: number | null
          actual_open: number | null
          actual_volume: number | null
          aligned_candidate_before_b4: boolean | null
          aligned_candidate_direction: string | null
          b4_cell: string | null
          b4_cell_losses: number | null
          b4_cell_resolved_count: number | null
          b4_cell_wins: number | null
          b4_global_history_count: number | null
          b4_global_quartile: number | null
          b4_global_rank: number | null
          b4_guard_attribution_class: string | null
          b4_guard_incremental_value: number | null
          b4_guard_version: string | null
          b4_guard_veto_fired: boolean | null
          b4_not_ready_reason: string | null
          b4_p_correct: number | null
          b4_quality_percentile: number | null
          b4_ready: boolean | null
          b4_reference_count: number | null
          b4_reference_end_index: number | null
          b4_reference_start_index: number | null
          b4_same_side_history_count: number | null
          b4_same_side_input_count: number | null
          b4_same_side_quartile: number | null
          b4_same_side_rank: number | null
          b4_training_end_index: number | null
          b4_training_start_index: number | null
          balanced_activation_target_ts: string | null
          balanced_active: boolean | null
          balanced_agreement_tier: string | null
          balanced_binance_loaded_at: string | null
          balanced_config_hash: string | null
          balanced_decision_at: string | null
          balanced_decision_reason: string | null
          balanced_es1_confidence: number | null
          balanced_es1_parity_certified: boolean | null
          balanced_es1_price_direction: string | null
          balanced_es1_probability_green: number | null
          balanced_es1_vote: number | null
          balanced_feature_schema: string | null
          balanced_final_prediction: string | null
          balanced_green_vote_count: number | null
          balanced_implementation_revision: string | null
          balanced_incremental_value: number | null
          balanced_legacy_decision_reason: string | null
          balanced_legacy_direction: string | null
          balanced_legacy_result: string | null
          balanced_legacy_score: number | null
          balanced_legacy_would_trade: boolean | null
          balanced_model_version: string | null
          balanced_perp_capture_status: string | null
          balanced_perp_fade_vote: number | null
          balanced_perp_feature_id: string | null
          balanced_perp_final_imbalance_10bps: number | null
          balanced_perp_gate_reason: string | null
          balanced_perp_ready: boolean | null
          balanced_perp_ready_reason: string | null
          balanced_perp_resync_continuous: boolean | null
          balanced_perp_values_hash: string | null
          balanced_policy_version: string | null
          balanced_price_fit_id: string | null
          balanced_price_fit_source: string | null
          balanced_prospective_test_id: string | null
          balanced_red_vote_count: number | null
          balanced_resolved_at: string | null
          balanced_result: string | null
          balanced_result_score: number | null
          balanced_spot_capture_status: string | null
          balanced_spot_depth_vote: number | null
          balanced_spot_feature_id: string | null
          balanced_spot_final_imbalance_10bps: number | null
          balanced_spot_gate_reason: string | null
          balanced_spot_normalized_ofi_60s: number | null
          balanced_spot_ofi60_vote: number | null
          balanced_spot_ready: boolean | null
          balanced_spot_ready_reason: string | null
          balanced_spot_resync_continuous: boolean | null
          balanced_spot_values_hash: string | null
          balanced_vote_margin: number | null
          balanced_vote_pattern: string | null
          balanced_vote_sum: number | null
          balanced_webhook_eligible: boolean | null
          balanced_webhook_sent_at: string | null
          balanced_would_trade: boolean | null
          binance_ob_abs_percentile_96: number | null
          binance_ob_capture_status: string | null
          binance_ob_config_hash: string | null
          binance_ob_feature_schema_hash: string | null
          binance_ob_final_imbalance_10bps: number | null
          binance_ob_history_ready: boolean | null
          binance_ob_history_valid_count: number | null
          binance_ob_influenced_decision: boolean
          binance_ob_mode: Database["public"]["Enums"]["binance_ob_mode"] | null
          binance_ob_perp_feature_id: string | null
          binance_ob_perp_ready: boolean | null
          binance_ob_ready: boolean | null
          binance_ob_ready_reason: string | null
          binance_ob_run_mode: string | null
          binance_ob_selected_shadow_policy:
            | Database["public"]["Enums"]["binance_ob_policy_name"]
            | null
          binance_ob_shadow_direction: string | null
          binance_ob_shadow_reason: string | null
          binance_ob_shadow_would_trade: boolean | null
          binance_ob_sign_persistence_15s: number | null
          binance_ob_spot_feature_id: string | null
          binance_ob_spot_ready: boolean | null
          binance_ob_version: string | null
          build_commit_sha: string | null
          build_identifier: string | null
          canonical_candle_source: string | null
          catchup_target_ts: string | null
          certified_fitter_code_hash: string | null
          combined_confidence_rank: number | null
          combined_rank_qualified: boolean | null
          config_hash: string | null
          created_at: string
          data_invalid_reason: string | null
          data_valid: boolean | null
          decision_reason: string | null
          decision_state_certified: boolean | null
          decision_state_checksum: string | null
          deploy_environment: string | null
          directional_version: string | null
          dual_adaptive_activation_id: string | null
          dual_adaptive_activation_target_ts: string | null
          dual_adaptive_candidate_direction: string | null
          dual_adaptive_config_hash: string | null
          dual_adaptive_decision_reason: string | null
          dual_adaptive_detailed_reason: string | null
          dual_adaptive_feature_schema: string | null
          dual_adaptive_implementation_revision: string | null
          dual_adaptive_influenced_decision: boolean | null
          dual_adaptive_input_hash: string | null
          dual_adaptive_model_version: string | null
          dual_adaptive_perp_capture_status: string | null
          dual_adaptive_perp_direction: string | null
          dual_adaptive_perp_feature_id: string | null
          dual_adaptive_perp_final_imbalance_10bps: number | null
          dual_adaptive_perp_final_sign: number | null
          dual_adaptive_perp_history_ready: boolean | null
          dual_adaptive_perp_mean_imbalance_10bps_60s: number | null
          dual_adaptive_perp_mean60_sign: number | null
          dual_adaptive_perp_mode: string | null
          dual_adaptive_perp_mode_reason: string | null
          dual_adaptive_perp_ready: boolean | null
          dual_adaptive_perp_ready_reason: string | null
          dual_adaptive_policy_version: string | null
          dual_adaptive_ready: boolean | null
          dual_adaptive_ready_reason: string | null
          dual_adaptive_resolution_attempt_count: number
          dual_adaptive_resolved_at: string | null
          dual_adaptive_resolver_version: string | null
          dual_adaptive_result: string | null
          dual_adaptive_result_score: number | null
          dual_adaptive_spot_capture_status: string | null
          dual_adaptive_spot_direction: string | null
          dual_adaptive_spot_feature_id: string | null
          dual_adaptive_spot_final_imbalance_10bps: number | null
          dual_adaptive_spot_final_sign: number | null
          dual_adaptive_spot_history_ready: boolean | null
          dual_adaptive_spot_mean_imbalance_10bps_60s: number | null
          dual_adaptive_spot_mean60_sign: number | null
          dual_adaptive_spot_mode: string | null
          dual_adaptive_spot_mode_reason: string | null
          dual_adaptive_spot_ready: boolean | null
          dual_adaptive_spot_ready_reason: string | null
          dual_adaptive_venue_agreement: boolean | null
          dual_adaptive_webhook_eligible: boolean | null
          dual_adaptive_webhook_sent_at: string | null
          dual_adaptive_would_trade: boolean | null
          feature_cutoff_ts: string | null
          feature_invalid_reason: string | null
          feature_schema_hash: string | null
          feature_valid: boolean | null
          feature_values_json: Json | null
          feature_vector_hash: string | null
          final_prediction: string | null
          hybrid_direction: string | null
          hybrid_evidence: number | null
          hybrid_route: string | null
          id: string
          implementation_revision: string | null
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          latest_source_candle_ts: string | null
          legacy_es1_model_version: string | null
          local_date: string | null
          model_name: string
          model_version: string
          ob_abs_depth: number | null
          ob_abs_percentile: number | null
          ob_book_complete: boolean | null
          ob_capture_status: string | null
          ob_depth_imbalance_10bps: number | null
          ob_history_cap: number | null
          ob_history_count: number | null
          ob_history_end_ts: string | null
          ob_history_start_ts: string | null
          ob_route_qualified: boolean | null
          ob_route_reject_reason: string | null
          ob_snapshot_ts: string | null
          operational_gap_reason: string | null
          operational_gap_status: string | null
          parity_certified: boolean | null
          precision_activated: boolean | null
          precision_activation_id: string | null
          precision_activation_target_ts: string | null
          precision_activity_guard_passed: boolean | null
          precision_balanced_direction: string | null
          precision_balanced_result: string | null
          precision_balanced_result_score: number | null
          precision_balanced_route: string | null
          precision_balanced_would_trade: boolean | null
          precision_build_ms: number | null
          precision_candidate_direction: string | null
          precision_config_hash: string | null
          precision_decision_reason: string | null
          precision_implementation_revision: string | null
          precision_input_hash: string | null
          precision_opportunity_index: number | null
          precision_perp_direction: string | null
          precision_perp_final_imbalance_10bps: number | null
          precision_perp_mean_imbalance_10bps_60s: number | null
          precision_perp_mode: string | null
          precision_perp_ready: boolean | null
          precision_perp_sign_change_count_60s: number | null
          precision_policy_id: string | null
          precision_policy_version: string | null
          precision_primary_direction: string | null
          precision_primary_would_trade: boolean | null
          precision_prior_trend_age_candles: number | null
          precision_ready: boolean | null
          precision_ready_reason: string | null
          precision_rescue_direction: string | null
          precision_rescue_would_trade: boolean | null
          precision_resolution_attempt_count: number | null
          precision_resolved_at: string | null
          precision_resolver_version: string | null
          precision_result: string | null
          precision_result_score: number | null
          precision_sleeve: string | null
          precision_spot_direction: string | null
          precision_spot_final_imbalance_10bps: number | null
          precision_spot_mean_imbalance_10bps_60s: number | null
          precision_spot_mode: string | null
          precision_spot_normalized_ofi_5s: number | null
          precision_spot_ready: boolean | null
          precision_technical_confidence: number | null
          precision_technical_direction: string | null
          precision_technical_error: string | null
          precision_technical_model_available: boolean | null
          precision_technical_p_green: number | null
          precision_technical_train_rows: number | null
          precision_upper_wick_percentile_96: number | null
          precision_venue_agreement: boolean | null
          precision_webhook_eligible: boolean | null
          precision_webhook_sent_at: string | null
          precision_would_trade: boolean | null
          price_confidence: number | null
          price_confidence_rank: number | null
          price_direction: string | null
          price_fit_artifact_sha256: string | null
          price_fit_certified: boolean | null
          price_fit_id: string | null
          price_fit_source: string | null
          price_fit_window_fingerprint: string | null
          price_probability_green: number | null
          price_rank_history_count: number | null
          price_shadow_fit_id: string | null
          price_shadow_probability_green: number | null
          price_training_end_ts: string | null
          price_training_row_count: number | null
          price_training_start_ts: string | null
          prospective_test_id: string | null
          raw_counterfactual_result: string | null
          raw_counterfactual_score: number | null
          resolution_attempt_count: number
          resolved_at: string | null
          resolver_version: string | null
          result: string | null
          result_score: number | null
          run_finished_at: string | null
          run_mode: string
          run_started_at: string | null
          scheduler_invocation_id: string | null
          source_index_absolute: number | null
          target_candle_ts: string
          timing_invalid_reason: string | null
          timing_valid: boolean | null
          updated_at: string
          variant: string | null
          webhook_eligible: boolean
          webhook_sent_at: string | null
          without_b4_guard_decision_reason: string | null
          without_b4_guard_direction: string | null
          without_b4_guard_score: number | null
          without_b4_guard_would_trade: boolean | null
          would_trade: boolean
        }
        Insert: {
          a2_agrees?: boolean | null
          a2_confidence?: number | null
          a2_confidence_rank?: number | null
          a2_direction?: string | null
          a2_model_fit_id?: string | null
          a2_prediction_id?: string | null
          a2_probability_green?: number | null
          a2_production_model_version?: string | null
          a2_rank_history_count?: number | null
          a2_row_id?: string | null
          a2_source_variant?: string | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          actual_volume?: number | null
          aligned_candidate_before_b4?: boolean | null
          aligned_candidate_direction?: string | null
          b4_cell?: string | null
          b4_cell_losses?: number | null
          b4_cell_resolved_count?: number | null
          b4_cell_wins?: number | null
          b4_global_history_count?: number | null
          b4_global_quartile?: number | null
          b4_global_rank?: number | null
          b4_guard_attribution_class?: string | null
          b4_guard_incremental_value?: number | null
          b4_guard_version?: string | null
          b4_guard_veto_fired?: boolean | null
          b4_not_ready_reason?: string | null
          b4_p_correct?: number | null
          b4_quality_percentile?: number | null
          b4_ready?: boolean | null
          b4_reference_count?: number | null
          b4_reference_end_index?: number | null
          b4_reference_start_index?: number | null
          b4_same_side_history_count?: number | null
          b4_same_side_input_count?: number | null
          b4_same_side_quartile?: number | null
          b4_same_side_rank?: number | null
          b4_training_end_index?: number | null
          b4_training_start_index?: number | null
          balanced_activation_target_ts?: string | null
          balanced_active?: boolean | null
          balanced_agreement_tier?: string | null
          balanced_binance_loaded_at?: string | null
          balanced_config_hash?: string | null
          balanced_decision_at?: string | null
          balanced_decision_reason?: string | null
          balanced_es1_confidence?: number | null
          balanced_es1_parity_certified?: boolean | null
          balanced_es1_price_direction?: string | null
          balanced_es1_probability_green?: number | null
          balanced_es1_vote?: number | null
          balanced_feature_schema?: string | null
          balanced_final_prediction?: string | null
          balanced_green_vote_count?: number | null
          balanced_implementation_revision?: string | null
          balanced_incremental_value?: number | null
          balanced_legacy_decision_reason?: string | null
          balanced_legacy_direction?: string | null
          balanced_legacy_result?: string | null
          balanced_legacy_score?: number | null
          balanced_legacy_would_trade?: boolean | null
          balanced_model_version?: string | null
          balanced_perp_capture_status?: string | null
          balanced_perp_fade_vote?: number | null
          balanced_perp_feature_id?: string | null
          balanced_perp_final_imbalance_10bps?: number | null
          balanced_perp_gate_reason?: string | null
          balanced_perp_ready?: boolean | null
          balanced_perp_ready_reason?: string | null
          balanced_perp_resync_continuous?: boolean | null
          balanced_perp_values_hash?: string | null
          balanced_policy_version?: string | null
          balanced_price_fit_id?: string | null
          balanced_price_fit_source?: string | null
          balanced_prospective_test_id?: string | null
          balanced_red_vote_count?: number | null
          balanced_resolved_at?: string | null
          balanced_result?: string | null
          balanced_result_score?: number | null
          balanced_spot_capture_status?: string | null
          balanced_spot_depth_vote?: number | null
          balanced_spot_feature_id?: string | null
          balanced_spot_final_imbalance_10bps?: number | null
          balanced_spot_gate_reason?: string | null
          balanced_spot_normalized_ofi_60s?: number | null
          balanced_spot_ofi60_vote?: number | null
          balanced_spot_ready?: boolean | null
          balanced_spot_ready_reason?: string | null
          balanced_spot_resync_continuous?: boolean | null
          balanced_spot_values_hash?: string | null
          balanced_vote_margin?: number | null
          balanced_vote_pattern?: string | null
          balanced_vote_sum?: number | null
          balanced_webhook_eligible?: boolean | null
          balanced_webhook_sent_at?: string | null
          balanced_would_trade?: boolean | null
          binance_ob_abs_percentile_96?: number | null
          binance_ob_capture_status?: string | null
          binance_ob_config_hash?: string | null
          binance_ob_feature_schema_hash?: string | null
          binance_ob_final_imbalance_10bps?: number | null
          binance_ob_history_ready?: boolean | null
          binance_ob_history_valid_count?: number | null
          binance_ob_influenced_decision?: boolean
          binance_ob_mode?:
            | Database["public"]["Enums"]["binance_ob_mode"]
            | null
          binance_ob_perp_feature_id?: string | null
          binance_ob_perp_ready?: boolean | null
          binance_ob_ready?: boolean | null
          binance_ob_ready_reason?: string | null
          binance_ob_run_mode?: string | null
          binance_ob_selected_shadow_policy?:
            | Database["public"]["Enums"]["binance_ob_policy_name"]
            | null
          binance_ob_shadow_direction?: string | null
          binance_ob_shadow_reason?: string | null
          binance_ob_shadow_would_trade?: boolean | null
          binance_ob_sign_persistence_15s?: number | null
          binance_ob_spot_feature_id?: string | null
          binance_ob_spot_ready?: boolean | null
          binance_ob_version?: string | null
          build_commit_sha?: string | null
          build_identifier?: string | null
          canonical_candle_source?: string | null
          catchup_target_ts?: string | null
          certified_fitter_code_hash?: string | null
          combined_confidence_rank?: number | null
          combined_rank_qualified?: boolean | null
          config_hash?: string | null
          created_at?: string
          data_invalid_reason?: string | null
          data_valid?: boolean | null
          decision_reason?: string | null
          decision_state_certified?: boolean | null
          decision_state_checksum?: string | null
          deploy_environment?: string | null
          directional_version?: string | null
          dual_adaptive_activation_id?: string | null
          dual_adaptive_activation_target_ts?: string | null
          dual_adaptive_candidate_direction?: string | null
          dual_adaptive_config_hash?: string | null
          dual_adaptive_decision_reason?: string | null
          dual_adaptive_detailed_reason?: string | null
          dual_adaptive_feature_schema?: string | null
          dual_adaptive_implementation_revision?: string | null
          dual_adaptive_influenced_decision?: boolean | null
          dual_adaptive_input_hash?: string | null
          dual_adaptive_model_version?: string | null
          dual_adaptive_perp_capture_status?: string | null
          dual_adaptive_perp_direction?: string | null
          dual_adaptive_perp_feature_id?: string | null
          dual_adaptive_perp_final_imbalance_10bps?: number | null
          dual_adaptive_perp_final_sign?: number | null
          dual_adaptive_perp_history_ready?: boolean | null
          dual_adaptive_perp_mean_imbalance_10bps_60s?: number | null
          dual_adaptive_perp_mean60_sign?: number | null
          dual_adaptive_perp_mode?: string | null
          dual_adaptive_perp_mode_reason?: string | null
          dual_adaptive_perp_ready?: boolean | null
          dual_adaptive_perp_ready_reason?: string | null
          dual_adaptive_policy_version?: string | null
          dual_adaptive_ready?: boolean | null
          dual_adaptive_ready_reason?: string | null
          dual_adaptive_resolution_attempt_count?: number
          dual_adaptive_resolved_at?: string | null
          dual_adaptive_resolver_version?: string | null
          dual_adaptive_result?: string | null
          dual_adaptive_result_score?: number | null
          dual_adaptive_spot_capture_status?: string | null
          dual_adaptive_spot_direction?: string | null
          dual_adaptive_spot_feature_id?: string | null
          dual_adaptive_spot_final_imbalance_10bps?: number | null
          dual_adaptive_spot_final_sign?: number | null
          dual_adaptive_spot_history_ready?: boolean | null
          dual_adaptive_spot_mean_imbalance_10bps_60s?: number | null
          dual_adaptive_spot_mean60_sign?: number | null
          dual_adaptive_spot_mode?: string | null
          dual_adaptive_spot_mode_reason?: string | null
          dual_adaptive_spot_ready?: boolean | null
          dual_adaptive_spot_ready_reason?: string | null
          dual_adaptive_venue_agreement?: boolean | null
          dual_adaptive_webhook_eligible?: boolean | null
          dual_adaptive_webhook_sent_at?: string | null
          dual_adaptive_would_trade?: boolean | null
          feature_cutoff_ts?: string | null
          feature_invalid_reason?: string | null
          feature_schema_hash?: string | null
          feature_valid?: boolean | null
          feature_values_json?: Json | null
          feature_vector_hash?: string | null
          final_prediction?: string | null
          hybrid_direction?: string | null
          hybrid_evidence?: number | null
          hybrid_route?: string | null
          id?: string
          implementation_revision?: string | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          latest_source_candle_ts?: string | null
          legacy_es1_model_version?: string | null
          local_date?: string | null
          model_name: string
          model_version: string
          ob_abs_depth?: number | null
          ob_abs_percentile?: number | null
          ob_book_complete?: boolean | null
          ob_capture_status?: string | null
          ob_depth_imbalance_10bps?: number | null
          ob_history_cap?: number | null
          ob_history_count?: number | null
          ob_history_end_ts?: string | null
          ob_history_start_ts?: string | null
          ob_route_qualified?: boolean | null
          ob_route_reject_reason?: string | null
          ob_snapshot_ts?: string | null
          operational_gap_reason?: string | null
          operational_gap_status?: string | null
          parity_certified?: boolean | null
          precision_activated?: boolean | null
          precision_activation_id?: string | null
          precision_activation_target_ts?: string | null
          precision_activity_guard_passed?: boolean | null
          precision_balanced_direction?: string | null
          precision_balanced_result?: string | null
          precision_balanced_result_score?: number | null
          precision_balanced_route?: string | null
          precision_balanced_would_trade?: boolean | null
          precision_build_ms?: number | null
          precision_candidate_direction?: string | null
          precision_config_hash?: string | null
          precision_decision_reason?: string | null
          precision_implementation_revision?: string | null
          precision_input_hash?: string | null
          precision_opportunity_index?: number | null
          precision_perp_direction?: string | null
          precision_perp_final_imbalance_10bps?: number | null
          precision_perp_mean_imbalance_10bps_60s?: number | null
          precision_perp_mode?: string | null
          precision_perp_ready?: boolean | null
          precision_perp_sign_change_count_60s?: number | null
          precision_policy_id?: string | null
          precision_policy_version?: string | null
          precision_primary_direction?: string | null
          precision_primary_would_trade?: boolean | null
          precision_prior_trend_age_candles?: number | null
          precision_ready?: boolean | null
          precision_ready_reason?: string | null
          precision_rescue_direction?: string | null
          precision_rescue_would_trade?: boolean | null
          precision_resolution_attempt_count?: number | null
          precision_resolved_at?: string | null
          precision_resolver_version?: string | null
          precision_result?: string | null
          precision_result_score?: number | null
          precision_sleeve?: string | null
          precision_spot_direction?: string | null
          precision_spot_final_imbalance_10bps?: number | null
          precision_spot_mean_imbalance_10bps_60s?: number | null
          precision_spot_mode?: string | null
          precision_spot_normalized_ofi_5s?: number | null
          precision_spot_ready?: boolean | null
          precision_technical_confidence?: number | null
          precision_technical_direction?: string | null
          precision_technical_error?: string | null
          precision_technical_model_available?: boolean | null
          precision_technical_p_green?: number | null
          precision_technical_train_rows?: number | null
          precision_upper_wick_percentile_96?: number | null
          precision_venue_agreement?: boolean | null
          precision_webhook_eligible?: boolean | null
          precision_webhook_sent_at?: string | null
          precision_would_trade?: boolean | null
          price_confidence?: number | null
          price_confidence_rank?: number | null
          price_direction?: string | null
          price_fit_artifact_sha256?: string | null
          price_fit_certified?: boolean | null
          price_fit_id?: string | null
          price_fit_source?: string | null
          price_fit_window_fingerprint?: string | null
          price_probability_green?: number | null
          price_rank_history_count?: number | null
          price_shadow_fit_id?: string | null
          price_shadow_probability_green?: number | null
          price_training_end_ts?: string | null
          price_training_row_count?: number | null
          price_training_start_ts?: string | null
          prospective_test_id?: string | null
          raw_counterfactual_result?: string | null
          raw_counterfactual_score?: number | null
          resolution_attempt_count?: number
          resolved_at?: string | null
          resolver_version?: string | null
          result?: string | null
          result_score?: number | null
          run_finished_at?: string | null
          run_mode?: string
          run_started_at?: string | null
          scheduler_invocation_id?: string | null
          source_index_absolute?: number | null
          target_candle_ts: string
          timing_invalid_reason?: string | null
          timing_valid?: boolean | null
          updated_at?: string
          variant?: string | null
          webhook_eligible?: boolean
          webhook_sent_at?: string | null
          without_b4_guard_decision_reason?: string | null
          without_b4_guard_direction?: string | null
          without_b4_guard_score?: number | null
          without_b4_guard_would_trade?: boolean | null
          would_trade?: boolean
        }
        Update: {
          a2_agrees?: boolean | null
          a2_confidence?: number | null
          a2_confidence_rank?: number | null
          a2_direction?: string | null
          a2_model_fit_id?: string | null
          a2_prediction_id?: string | null
          a2_probability_green?: number | null
          a2_production_model_version?: string | null
          a2_rank_history_count?: number | null
          a2_row_id?: string | null
          a2_source_variant?: string | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          actual_volume?: number | null
          aligned_candidate_before_b4?: boolean | null
          aligned_candidate_direction?: string | null
          b4_cell?: string | null
          b4_cell_losses?: number | null
          b4_cell_resolved_count?: number | null
          b4_cell_wins?: number | null
          b4_global_history_count?: number | null
          b4_global_quartile?: number | null
          b4_global_rank?: number | null
          b4_guard_attribution_class?: string | null
          b4_guard_incremental_value?: number | null
          b4_guard_version?: string | null
          b4_guard_veto_fired?: boolean | null
          b4_not_ready_reason?: string | null
          b4_p_correct?: number | null
          b4_quality_percentile?: number | null
          b4_ready?: boolean | null
          b4_reference_count?: number | null
          b4_reference_end_index?: number | null
          b4_reference_start_index?: number | null
          b4_same_side_history_count?: number | null
          b4_same_side_input_count?: number | null
          b4_same_side_quartile?: number | null
          b4_same_side_rank?: number | null
          b4_training_end_index?: number | null
          b4_training_start_index?: number | null
          balanced_activation_target_ts?: string | null
          balanced_active?: boolean | null
          balanced_agreement_tier?: string | null
          balanced_binance_loaded_at?: string | null
          balanced_config_hash?: string | null
          balanced_decision_at?: string | null
          balanced_decision_reason?: string | null
          balanced_es1_confidence?: number | null
          balanced_es1_parity_certified?: boolean | null
          balanced_es1_price_direction?: string | null
          balanced_es1_probability_green?: number | null
          balanced_es1_vote?: number | null
          balanced_feature_schema?: string | null
          balanced_final_prediction?: string | null
          balanced_green_vote_count?: number | null
          balanced_implementation_revision?: string | null
          balanced_incremental_value?: number | null
          balanced_legacy_decision_reason?: string | null
          balanced_legacy_direction?: string | null
          balanced_legacy_result?: string | null
          balanced_legacy_score?: number | null
          balanced_legacy_would_trade?: boolean | null
          balanced_model_version?: string | null
          balanced_perp_capture_status?: string | null
          balanced_perp_fade_vote?: number | null
          balanced_perp_feature_id?: string | null
          balanced_perp_final_imbalance_10bps?: number | null
          balanced_perp_gate_reason?: string | null
          balanced_perp_ready?: boolean | null
          balanced_perp_ready_reason?: string | null
          balanced_perp_resync_continuous?: boolean | null
          balanced_perp_values_hash?: string | null
          balanced_policy_version?: string | null
          balanced_price_fit_id?: string | null
          balanced_price_fit_source?: string | null
          balanced_prospective_test_id?: string | null
          balanced_red_vote_count?: number | null
          balanced_resolved_at?: string | null
          balanced_result?: string | null
          balanced_result_score?: number | null
          balanced_spot_capture_status?: string | null
          balanced_spot_depth_vote?: number | null
          balanced_spot_feature_id?: string | null
          balanced_spot_final_imbalance_10bps?: number | null
          balanced_spot_gate_reason?: string | null
          balanced_spot_normalized_ofi_60s?: number | null
          balanced_spot_ofi60_vote?: number | null
          balanced_spot_ready?: boolean | null
          balanced_spot_ready_reason?: string | null
          balanced_spot_resync_continuous?: boolean | null
          balanced_spot_values_hash?: string | null
          balanced_vote_margin?: number | null
          balanced_vote_pattern?: string | null
          balanced_vote_sum?: number | null
          balanced_webhook_eligible?: boolean | null
          balanced_webhook_sent_at?: string | null
          balanced_would_trade?: boolean | null
          binance_ob_abs_percentile_96?: number | null
          binance_ob_capture_status?: string | null
          binance_ob_config_hash?: string | null
          binance_ob_feature_schema_hash?: string | null
          binance_ob_final_imbalance_10bps?: number | null
          binance_ob_history_ready?: boolean | null
          binance_ob_history_valid_count?: number | null
          binance_ob_influenced_decision?: boolean
          binance_ob_mode?:
            | Database["public"]["Enums"]["binance_ob_mode"]
            | null
          binance_ob_perp_feature_id?: string | null
          binance_ob_perp_ready?: boolean | null
          binance_ob_ready?: boolean | null
          binance_ob_ready_reason?: string | null
          binance_ob_run_mode?: string | null
          binance_ob_selected_shadow_policy?:
            | Database["public"]["Enums"]["binance_ob_policy_name"]
            | null
          binance_ob_shadow_direction?: string | null
          binance_ob_shadow_reason?: string | null
          binance_ob_shadow_would_trade?: boolean | null
          binance_ob_sign_persistence_15s?: number | null
          binance_ob_spot_feature_id?: string | null
          binance_ob_spot_ready?: boolean | null
          binance_ob_version?: string | null
          build_commit_sha?: string | null
          build_identifier?: string | null
          canonical_candle_source?: string | null
          catchup_target_ts?: string | null
          certified_fitter_code_hash?: string | null
          combined_confidence_rank?: number | null
          combined_rank_qualified?: boolean | null
          config_hash?: string | null
          created_at?: string
          data_invalid_reason?: string | null
          data_valid?: boolean | null
          decision_reason?: string | null
          decision_state_certified?: boolean | null
          decision_state_checksum?: string | null
          deploy_environment?: string | null
          directional_version?: string | null
          dual_adaptive_activation_id?: string | null
          dual_adaptive_activation_target_ts?: string | null
          dual_adaptive_candidate_direction?: string | null
          dual_adaptive_config_hash?: string | null
          dual_adaptive_decision_reason?: string | null
          dual_adaptive_detailed_reason?: string | null
          dual_adaptive_feature_schema?: string | null
          dual_adaptive_implementation_revision?: string | null
          dual_adaptive_influenced_decision?: boolean | null
          dual_adaptive_input_hash?: string | null
          dual_adaptive_model_version?: string | null
          dual_adaptive_perp_capture_status?: string | null
          dual_adaptive_perp_direction?: string | null
          dual_adaptive_perp_feature_id?: string | null
          dual_adaptive_perp_final_imbalance_10bps?: number | null
          dual_adaptive_perp_final_sign?: number | null
          dual_adaptive_perp_history_ready?: boolean | null
          dual_adaptive_perp_mean_imbalance_10bps_60s?: number | null
          dual_adaptive_perp_mean60_sign?: number | null
          dual_adaptive_perp_mode?: string | null
          dual_adaptive_perp_mode_reason?: string | null
          dual_adaptive_perp_ready?: boolean | null
          dual_adaptive_perp_ready_reason?: string | null
          dual_adaptive_policy_version?: string | null
          dual_adaptive_ready?: boolean | null
          dual_adaptive_ready_reason?: string | null
          dual_adaptive_resolution_attempt_count?: number
          dual_adaptive_resolved_at?: string | null
          dual_adaptive_resolver_version?: string | null
          dual_adaptive_result?: string | null
          dual_adaptive_result_score?: number | null
          dual_adaptive_spot_capture_status?: string | null
          dual_adaptive_spot_direction?: string | null
          dual_adaptive_spot_feature_id?: string | null
          dual_adaptive_spot_final_imbalance_10bps?: number | null
          dual_adaptive_spot_final_sign?: number | null
          dual_adaptive_spot_history_ready?: boolean | null
          dual_adaptive_spot_mean_imbalance_10bps_60s?: number | null
          dual_adaptive_spot_mean60_sign?: number | null
          dual_adaptive_spot_mode?: string | null
          dual_adaptive_spot_mode_reason?: string | null
          dual_adaptive_spot_ready?: boolean | null
          dual_adaptive_spot_ready_reason?: string | null
          dual_adaptive_venue_agreement?: boolean | null
          dual_adaptive_webhook_eligible?: boolean | null
          dual_adaptive_webhook_sent_at?: string | null
          dual_adaptive_would_trade?: boolean | null
          feature_cutoff_ts?: string | null
          feature_invalid_reason?: string | null
          feature_schema_hash?: string | null
          feature_valid?: boolean | null
          feature_values_json?: Json | null
          feature_vector_hash?: string | null
          final_prediction?: string | null
          hybrid_direction?: string | null
          hybrid_evidence?: number | null
          hybrid_route?: string | null
          id?: string
          implementation_revision?: string | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          latest_source_candle_ts?: string | null
          legacy_es1_model_version?: string | null
          local_date?: string | null
          model_name?: string
          model_version?: string
          ob_abs_depth?: number | null
          ob_abs_percentile?: number | null
          ob_book_complete?: boolean | null
          ob_capture_status?: string | null
          ob_depth_imbalance_10bps?: number | null
          ob_history_cap?: number | null
          ob_history_count?: number | null
          ob_history_end_ts?: string | null
          ob_history_start_ts?: string | null
          ob_route_qualified?: boolean | null
          ob_route_reject_reason?: string | null
          ob_snapshot_ts?: string | null
          operational_gap_reason?: string | null
          operational_gap_status?: string | null
          parity_certified?: boolean | null
          precision_activated?: boolean | null
          precision_activation_id?: string | null
          precision_activation_target_ts?: string | null
          precision_activity_guard_passed?: boolean | null
          precision_balanced_direction?: string | null
          precision_balanced_result?: string | null
          precision_balanced_result_score?: number | null
          precision_balanced_route?: string | null
          precision_balanced_would_trade?: boolean | null
          precision_build_ms?: number | null
          precision_candidate_direction?: string | null
          precision_config_hash?: string | null
          precision_decision_reason?: string | null
          precision_implementation_revision?: string | null
          precision_input_hash?: string | null
          precision_opportunity_index?: number | null
          precision_perp_direction?: string | null
          precision_perp_final_imbalance_10bps?: number | null
          precision_perp_mean_imbalance_10bps_60s?: number | null
          precision_perp_mode?: string | null
          precision_perp_ready?: boolean | null
          precision_perp_sign_change_count_60s?: number | null
          precision_policy_id?: string | null
          precision_policy_version?: string | null
          precision_primary_direction?: string | null
          precision_primary_would_trade?: boolean | null
          precision_prior_trend_age_candles?: number | null
          precision_ready?: boolean | null
          precision_ready_reason?: string | null
          precision_rescue_direction?: string | null
          precision_rescue_would_trade?: boolean | null
          precision_resolution_attempt_count?: number | null
          precision_resolved_at?: string | null
          precision_resolver_version?: string | null
          precision_result?: string | null
          precision_result_score?: number | null
          precision_sleeve?: string | null
          precision_spot_direction?: string | null
          precision_spot_final_imbalance_10bps?: number | null
          precision_spot_mean_imbalance_10bps_60s?: number | null
          precision_spot_mode?: string | null
          precision_spot_normalized_ofi_5s?: number | null
          precision_spot_ready?: boolean | null
          precision_technical_confidence?: number | null
          precision_technical_direction?: string | null
          precision_technical_error?: string | null
          precision_technical_model_available?: boolean | null
          precision_technical_p_green?: number | null
          precision_technical_train_rows?: number | null
          precision_upper_wick_percentile_96?: number | null
          precision_venue_agreement?: boolean | null
          precision_webhook_eligible?: boolean | null
          precision_webhook_sent_at?: string | null
          precision_would_trade?: boolean | null
          price_confidence?: number | null
          price_confidence_rank?: number | null
          price_direction?: string | null
          price_fit_artifact_sha256?: string | null
          price_fit_certified?: boolean | null
          price_fit_id?: string | null
          price_fit_source?: string | null
          price_fit_window_fingerprint?: string | null
          price_probability_green?: number | null
          price_rank_history_count?: number | null
          price_shadow_fit_id?: string | null
          price_shadow_probability_green?: number | null
          price_training_end_ts?: string | null
          price_training_row_count?: number | null
          price_training_start_ts?: string | null
          prospective_test_id?: string | null
          raw_counterfactual_result?: string | null
          raw_counterfactual_score?: number | null
          resolution_attempt_count?: number
          resolved_at?: string | null
          resolver_version?: string | null
          result?: string | null
          result_score?: number | null
          run_finished_at?: string | null
          run_mode?: string
          run_started_at?: string | null
          scheduler_invocation_id?: string | null
          source_index_absolute?: number | null
          target_candle_ts?: string
          timing_invalid_reason?: string | null
          timing_valid?: boolean | null
          updated_at?: string
          variant?: string | null
          webhook_eligible?: boolean
          webhook_sent_at?: string | null
          without_b4_guard_decision_reason?: string | null
          without_b4_guard_direction?: string | null
          without_b4_guard_score?: number | null
          without_b4_guard_would_trade?: boolean | null
          would_trade?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "b4x4_es1_predictions_binance_ob_perp_fk"
            columns: ["binance_ob_perp_feature_id"]
            isOneToOne: false
            referencedRelation: "b4x4_es1_binance_ob_boundary_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b4x4_es1_predictions_binance_ob_spot_fk"
            columns: ["binance_ob_spot_feature_id"]
            isOneToOne: false
            referencedRelation: "b4x4_es1_binance_ob_boundary_features"
            referencedColumns: ["id"]
          },
        ]
      }
      b4x4_ob_capture_auth: {
        Row: {
          created_at: string
          id: string
          name: string
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      b4x4_ob_snapshots: {
        Row: {
          book_complete: boolean | null
          book_json: Json | null
          capture_attempt_count: number | null
          capture_attempts_json: Json | null
          capture_error_list: Json | null
          captured_at: string
          chosen_attempt_id: string | null
          created_at: string
          cutoff_ts: string | null
          error_code: string | null
          error_message: string | null
          event_ts: string | null
          feature_cutoff_ts: string | null
          id: string
          instrument: string
          local_receipt_ts: string | null
          prev_seq_id: string | null
          provider: string
          seq_id: string | null
          sequence_gap: boolean | null
          sequence_gap_count: number | null
          shadow_version: string
          target_candle_ts: string
          trade_event_count: number | null
          trade_window_complete: boolean | null
          trade_window_start_ts: string | null
          trades_json: Json | null
          updated_at: string
        }
        Insert: {
          book_complete?: boolean | null
          book_json?: Json | null
          capture_attempt_count?: number | null
          capture_attempts_json?: Json | null
          capture_error_list?: Json | null
          captured_at?: string
          chosen_attempt_id?: string | null
          created_at?: string
          cutoff_ts?: string | null
          error_code?: string | null
          error_message?: string | null
          event_ts?: string | null
          feature_cutoff_ts?: string | null
          id?: string
          instrument?: string
          local_receipt_ts?: string | null
          prev_seq_id?: string | null
          provider?: string
          seq_id?: string | null
          sequence_gap?: boolean | null
          sequence_gap_count?: number | null
          shadow_version?: string
          target_candle_ts: string
          trade_event_count?: number | null
          trade_window_complete?: boolean | null
          trade_window_start_ts?: string | null
          trades_json?: Json | null
          updated_at?: string
        }
        Update: {
          book_complete?: boolean | null
          book_json?: Json | null
          capture_attempt_count?: number | null
          capture_attempts_json?: Json | null
          capture_error_list?: Json | null
          captured_at?: string
          chosen_attempt_id?: string | null
          created_at?: string
          cutoff_ts?: string | null
          error_code?: string | null
          error_message?: string | null
          event_ts?: string | null
          feature_cutoff_ts?: string | null
          id?: string
          instrument?: string
          local_receipt_ts?: string | null
          prev_seq_id?: string | null
          provider?: string
          seq_id?: string | null
          sequence_gap?: boolean | null
          sequence_gap_count?: number | null
          shadow_version?: string
          target_candle_ts?: string
          trade_event_count?: number | null
          trade_window_complete?: boolean | null
          trade_window_start_ts?: string | null
          trades_json?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      b4x4_policy_shadows: {
        Row: {
          actual_direction: string | null
          b4x4_prediction_id: string
          base_route: string | null
          brake_active: boolean
          brake_veto_fired: boolean
          config_hash: string
          created_at: string
          daily_net_before: number
          decision_reason: string | null
          final_prediction: string | null
          gate_fired: boolean
          gate_inputs_json: Json | null
          id: string
          implementation_revision: string | null
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          local_date: string | null
          prospective_test_id: string
          raw_direction: string | null
          resolution_attempt_count: number
          resolved_at: string | null
          result: string | null
          result_score: number | null
          run_mode: string
          shadow_variant: string
          target_candle_ts: string
          updated_at: string
          webhook_eligible: boolean
          would_trade: boolean
        }
        Insert: {
          actual_direction?: string | null
          b4x4_prediction_id: string
          base_route?: string | null
          brake_active?: boolean
          brake_veto_fired?: boolean
          config_hash: string
          created_at?: string
          daily_net_before?: number
          decision_reason?: string | null
          final_prediction?: string | null
          gate_fired?: boolean
          gate_inputs_json?: Json | null
          id?: string
          implementation_revision?: string | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          local_date?: string | null
          prospective_test_id: string
          raw_direction?: string | null
          resolution_attempt_count?: number
          resolved_at?: string | null
          result?: string | null
          result_score?: number | null
          run_mode?: string
          shadow_variant: string
          target_candle_ts: string
          updated_at?: string
          webhook_eligible?: boolean
          would_trade?: boolean
        }
        Update: {
          actual_direction?: string | null
          b4x4_prediction_id?: string
          base_route?: string | null
          brake_active?: boolean
          brake_veto_fired?: boolean
          config_hash?: string
          created_at?: string
          daily_net_before?: number
          decision_reason?: string | null
          final_prediction?: string | null
          gate_fired?: boolean
          gate_inputs_json?: Json | null
          id?: string
          implementation_revision?: string | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          local_date?: string | null
          prospective_test_id?: string
          raw_direction?: string | null
          resolution_attempt_count?: number
          resolved_at?: string | null
          result?: string | null
          result_score?: number | null
          run_mode?: string
          shadow_variant?: string
          target_candle_ts?: string
          updated_at?: string
          webhook_eligible?: boolean
          would_trade?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "b4x4_policy_shadows_b4x4_prediction_id_fkey"
            columns: ["b4x4_prediction_id"]
            isOneToOne: false
            referencedRelation: "b4x4_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      b4x4_predictions: {
        Row: {
          a2_model_fit_id: string | null
          a2_probability_green: number | null
          a2_production_model_version: string | null
          a2_source_variant: string | null
          actual_close: number | null
          actual_direction: string | null
          actual_high: number | null
          actual_low: number | null
          actual_open: number | null
          base_candidate: boolean | null
          base_no_brake_counterfactual_score: number | null
          base_no_brake_counterfactual_trade: boolean | null
          brake_attribution_class: string | null
          brake_incremental_value: number | null
          build_commit_sha: string | null
          build_identifier: string | null
          calibration_promotion_brake_vetoed: boolean | null
          calibration_promotion_candidate_before_brake: boolean | null
          calibration_promotion_condition_met: boolean | null
          calibration_promotion_eligibility_reason: string | null
          calibration_promotion_expected_win_rate: number | null
          calibration_promotion_expected_wins: number | null
          calibration_promotion_history_as_of_ts: string | null
          calibration_promotion_history_count: number | null
          calibration_promotion_history_end_ts: string | null
          calibration_promotion_history_ids_hash: string | null
          calibration_promotion_history_losses: number | null
          calibration_promotion_history_pool: string | null
          calibration_promotion_history_ready: boolean | null
          calibration_promotion_history_start_ts: string | null
          calibration_promotion_history_window: number | null
          calibration_promotion_history_wins: number | null
          calibration_promotion_min_p_correct: number | null
          calibration_promotion_min_z_score: number | null
          calibration_promotion_observed_win_rate: number | null
          calibration_promotion_published: boolean | null
          calibration_promotion_raw_direction: string | null
          calibration_promotion_residual_wins: number | null
          calibration_promotion_standard_deviation: number | null
          calibration_promotion_variance: number | null
          calibration_promotion_version: string | null
          calibration_promotion_z_score: number | null
          canonical_candle_source: string | null
          catchup_completed_at: string | null
          catchup_resolution_error: string | null
          catchup_resolution_status: string | null
          catchup_target_ts: string | null
          confidence: number | null
          config_hash: string | null
          core_eligible: boolean | null
          core_only_counterfactual_score: number | null
          core_only_counterfactual_trade: boolean | null
          created_at: string
          daily_net_before: number | null
          daily_resolved_trade_count_before: number | null
          data_invalid_reason: string | null
          data_valid: boolean
          decision_reason: string | null
          deploy_environment: string | null
          expansion_eligible: boolean | null
          expansion_only_counterfactual_score: number | null
          expansion_only_counterfactual_trade: boolean | null
          feature_cutoff_ts: string | null
          final_prediction: string | null
          global_history_count: number | null
          global_history_end_index: number | null
          global_history_end_ts: string | null
          global_history_start_index: number | null
          global_history_start_ts: string | null
          global_rank: number | null
          global_rank_quartile: number | null
          grid_cell: string | null
          grid_cell_losses: number | null
          grid_cell_resolved_count: number | null
          grid_cell_wins: number | null
          grid_prior_alpha: number | null
          grid_prior_beta: number | null
          grid_quality_percentile: number | null
          grid_reference_count: number | null
          grid_reference_end_index: number | null
          grid_reference_end_ts: string | null
          grid_reference_source_count: number | null
          grid_reference_start_index: number | null
          grid_reference_start_ts: string | null
          grid_snapshot_json: Json | null
          grid_training_end_index: number | null
          grid_training_end_ts: string | null
          grid_training_lookback: number | null
          grid_training_resolved_count: number | null
          grid_training_source_count: number | null
          grid_training_start_index: number | null
          grid_training_start_ts: string | null
          grid_window_integrity_passed: boolean | null
          grid_window_integrity_reason: string | null
          id: string
          implementation_revision: string | null
          intraday_brake_active: boolean | null
          intraday_brake_veto_fired: boolean | null
          last_resolution_attempt_at: string | null
          last_resolution_error: string | null
          latest_source_candle_ts: string | null
          leakage_check_passed: boolean | null
          legacy_resolution_counter_unreliable: boolean | null
          local_date: string | null
          model_name: string
          model_version: string
          operational_gap_reason: string | null
          operational_gap_status: string | null
          p_correct: number | null
          post_calibration_candidate: boolean | null
          prospective_test_id: string
          quality_mean: number | null
          raw_a2_counterfactual_result: string | null
          raw_direction: string | null
          resolution_attempt_count: number
          resolved_at: string | null
          resolver_version: string | null
          result: string | null
          result_score: number | null
          revision_activated_at: string | null
          revision_prospective_test_id: string | null
          run_finished_at: string | null
          run_mode: string
          run_started_at: string | null
          same_side_filtered_count: number | null
          same_side_history_count: number | null
          same_side_history_end_index: number | null
          same_side_history_end_ts: string | null
          same_side_history_start_index: number | null
          same_side_history_start_ts: string | null
          same_side_input_source_count: number | null
          same_side_rank: number | null
          same_side_rank_quartile: number | null
          same_side_raw_direction_filter: string | null
          saturation_attribution_class: string | null
          saturation_calibration_version: string | null
          saturation_candidate_after: boolean | null
          saturation_candidate_before: boolean | null
          saturation_candidate_source_before: string | null
          saturation_cap_slope: number | null
          saturation_condition_met: boolean | null
          saturation_current_aligned_confidence: number | null
          saturation_current_raw_direction: string | null
          saturation_dynamic_confidence_cap: number | null
          saturation_history_count: number | null
          saturation_history_end_ts: string | null
          saturation_history_start_ts: string | null
          saturation_incremental_change: boolean | null
          saturation_incremental_value: number | null
          saturation_index: number | null
          saturation_mean_aligned_confidence: number | null
          saturation_min_confidence_cap: number | null
          saturation_ready: boolean | null
          saturation_reason: string | null
          saturation_regime_active: boolean | null
          saturation_same_side_count: number | null
          saturation_same_side_share: number | null
          saturation_trigger_threshold: number | null
          saturation_veto_fired: boolean | null
          saturation_window: number | null
          scheduler_invocation_id: string | null
          selected_route: string | null
          source_a2_row_id: string | null
          source_epoch_ts: string | null
          source_index_absolute: number | null
          source_index_version: string | null
          source_prediction_id: string | null
          source_target_ts: string | null
          target_candle_ts: string
          timing_status: string | null
          updated_at: string
          variant: string
          watchdog_detected_at: string | null
          webhook_eligible: boolean
          webhook_sent_at: string | null
          without_saturation_decision: string | null
          without_saturation_direction: string | null
          without_saturation_score: number | null
          without_saturation_skip_reason: string | null
          would_trade: boolean
        }
        Insert: {
          a2_model_fit_id?: string | null
          a2_probability_green?: number | null
          a2_production_model_version?: string | null
          a2_source_variant?: string | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          base_candidate?: boolean | null
          base_no_brake_counterfactual_score?: number | null
          base_no_brake_counterfactual_trade?: boolean | null
          brake_attribution_class?: string | null
          brake_incremental_value?: number | null
          build_commit_sha?: string | null
          build_identifier?: string | null
          calibration_promotion_brake_vetoed?: boolean | null
          calibration_promotion_candidate_before_brake?: boolean | null
          calibration_promotion_condition_met?: boolean | null
          calibration_promotion_eligibility_reason?: string | null
          calibration_promotion_expected_win_rate?: number | null
          calibration_promotion_expected_wins?: number | null
          calibration_promotion_history_as_of_ts?: string | null
          calibration_promotion_history_count?: number | null
          calibration_promotion_history_end_ts?: string | null
          calibration_promotion_history_ids_hash?: string | null
          calibration_promotion_history_losses?: number | null
          calibration_promotion_history_pool?: string | null
          calibration_promotion_history_ready?: boolean | null
          calibration_promotion_history_start_ts?: string | null
          calibration_promotion_history_window?: number | null
          calibration_promotion_history_wins?: number | null
          calibration_promotion_min_p_correct?: number | null
          calibration_promotion_min_z_score?: number | null
          calibration_promotion_observed_win_rate?: number | null
          calibration_promotion_published?: boolean | null
          calibration_promotion_raw_direction?: string | null
          calibration_promotion_residual_wins?: number | null
          calibration_promotion_standard_deviation?: number | null
          calibration_promotion_variance?: number | null
          calibration_promotion_version?: string | null
          calibration_promotion_z_score?: number | null
          canonical_candle_source?: string | null
          catchup_completed_at?: string | null
          catchup_resolution_error?: string | null
          catchup_resolution_status?: string | null
          catchup_target_ts?: string | null
          confidence?: number | null
          config_hash?: string | null
          core_eligible?: boolean | null
          core_only_counterfactual_score?: number | null
          core_only_counterfactual_trade?: boolean | null
          created_at?: string
          daily_net_before?: number | null
          daily_resolved_trade_count_before?: number | null
          data_invalid_reason?: string | null
          data_valid?: boolean
          decision_reason?: string | null
          deploy_environment?: string | null
          expansion_eligible?: boolean | null
          expansion_only_counterfactual_score?: number | null
          expansion_only_counterfactual_trade?: boolean | null
          feature_cutoff_ts?: string | null
          final_prediction?: string | null
          global_history_count?: number | null
          global_history_end_index?: number | null
          global_history_end_ts?: string | null
          global_history_start_index?: number | null
          global_history_start_ts?: string | null
          global_rank?: number | null
          global_rank_quartile?: number | null
          grid_cell?: string | null
          grid_cell_losses?: number | null
          grid_cell_resolved_count?: number | null
          grid_cell_wins?: number | null
          grid_prior_alpha?: number | null
          grid_prior_beta?: number | null
          grid_quality_percentile?: number | null
          grid_reference_count?: number | null
          grid_reference_end_index?: number | null
          grid_reference_end_ts?: string | null
          grid_reference_source_count?: number | null
          grid_reference_start_index?: number | null
          grid_reference_start_ts?: string | null
          grid_snapshot_json?: Json | null
          grid_training_end_index?: number | null
          grid_training_end_ts?: string | null
          grid_training_lookback?: number | null
          grid_training_resolved_count?: number | null
          grid_training_source_count?: number | null
          grid_training_start_index?: number | null
          grid_training_start_ts?: string | null
          grid_window_integrity_passed?: boolean | null
          grid_window_integrity_reason?: string | null
          id?: string
          implementation_revision?: string | null
          intraday_brake_active?: boolean | null
          intraday_brake_veto_fired?: boolean | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          latest_source_candle_ts?: string | null
          leakage_check_passed?: boolean | null
          legacy_resolution_counter_unreliable?: boolean | null
          local_date?: string | null
          model_name?: string
          model_version?: string
          operational_gap_reason?: string | null
          operational_gap_status?: string | null
          p_correct?: number | null
          post_calibration_candidate?: boolean | null
          prospective_test_id?: string
          quality_mean?: number | null
          raw_a2_counterfactual_result?: string | null
          raw_direction?: string | null
          resolution_attempt_count?: number
          resolved_at?: string | null
          resolver_version?: string | null
          result?: string | null
          result_score?: number | null
          revision_activated_at?: string | null
          revision_prospective_test_id?: string | null
          run_finished_at?: string | null
          run_mode?: string
          run_started_at?: string | null
          same_side_filtered_count?: number | null
          same_side_history_count?: number | null
          same_side_history_end_index?: number | null
          same_side_history_end_ts?: string | null
          same_side_history_start_index?: number | null
          same_side_history_start_ts?: string | null
          same_side_input_source_count?: number | null
          same_side_rank?: number | null
          same_side_rank_quartile?: number | null
          same_side_raw_direction_filter?: string | null
          saturation_attribution_class?: string | null
          saturation_calibration_version?: string | null
          saturation_candidate_after?: boolean | null
          saturation_candidate_before?: boolean | null
          saturation_candidate_source_before?: string | null
          saturation_cap_slope?: number | null
          saturation_condition_met?: boolean | null
          saturation_current_aligned_confidence?: number | null
          saturation_current_raw_direction?: string | null
          saturation_dynamic_confidence_cap?: number | null
          saturation_history_count?: number | null
          saturation_history_end_ts?: string | null
          saturation_history_start_ts?: string | null
          saturation_incremental_change?: boolean | null
          saturation_incremental_value?: number | null
          saturation_index?: number | null
          saturation_mean_aligned_confidence?: number | null
          saturation_min_confidence_cap?: number | null
          saturation_ready?: boolean | null
          saturation_reason?: string | null
          saturation_regime_active?: boolean | null
          saturation_same_side_count?: number | null
          saturation_same_side_share?: number | null
          saturation_trigger_threshold?: number | null
          saturation_veto_fired?: boolean | null
          saturation_window?: number | null
          scheduler_invocation_id?: string | null
          selected_route?: string | null
          source_a2_row_id?: string | null
          source_epoch_ts?: string | null
          source_index_absolute?: number | null
          source_index_version?: string | null
          source_prediction_id?: string | null
          source_target_ts?: string | null
          target_candle_ts: string
          timing_status?: string | null
          updated_at?: string
          variant?: string
          watchdog_detected_at?: string | null
          webhook_eligible?: boolean
          webhook_sent_at?: string | null
          without_saturation_decision?: string | null
          without_saturation_direction?: string | null
          without_saturation_score?: number | null
          without_saturation_skip_reason?: string | null
          would_trade?: boolean
        }
        Update: {
          a2_model_fit_id?: string | null
          a2_probability_green?: number | null
          a2_production_model_version?: string | null
          a2_source_variant?: string | null
          actual_close?: number | null
          actual_direction?: string | null
          actual_high?: number | null
          actual_low?: number | null
          actual_open?: number | null
          base_candidate?: boolean | null
          base_no_brake_counterfactual_score?: number | null
          base_no_brake_counterfactual_trade?: boolean | null
          brake_attribution_class?: string | null
          brake_incremental_value?: number | null
          build_commit_sha?: string | null
          build_identifier?: string | null
          calibration_promotion_brake_vetoed?: boolean | null
          calibration_promotion_candidate_before_brake?: boolean | null
          calibration_promotion_condition_met?: boolean | null
          calibration_promotion_eligibility_reason?: string | null
          calibration_promotion_expected_win_rate?: number | null
          calibration_promotion_expected_wins?: number | null
          calibration_promotion_history_as_of_ts?: string | null
          calibration_promotion_history_count?: number | null
          calibration_promotion_history_end_ts?: string | null
          calibration_promotion_history_ids_hash?: string | null
          calibration_promotion_history_losses?: number | null
          calibration_promotion_history_pool?: string | null
          calibration_promotion_history_ready?: boolean | null
          calibration_promotion_history_start_ts?: string | null
          calibration_promotion_history_window?: number | null
          calibration_promotion_history_wins?: number | null
          calibration_promotion_min_p_correct?: number | null
          calibration_promotion_min_z_score?: number | null
          calibration_promotion_observed_win_rate?: number | null
          calibration_promotion_published?: boolean | null
          calibration_promotion_raw_direction?: string | null
          calibration_promotion_residual_wins?: number | null
          calibration_promotion_standard_deviation?: number | null
          calibration_promotion_variance?: number | null
          calibration_promotion_version?: string | null
          calibration_promotion_z_score?: number | null
          canonical_candle_source?: string | null
          catchup_completed_at?: string | null
          catchup_resolution_error?: string | null
          catchup_resolution_status?: string | null
          catchup_target_ts?: string | null
          confidence?: number | null
          config_hash?: string | null
          core_eligible?: boolean | null
          core_only_counterfactual_score?: number | null
          core_only_counterfactual_trade?: boolean | null
          created_at?: string
          daily_net_before?: number | null
          daily_resolved_trade_count_before?: number | null
          data_invalid_reason?: string | null
          data_valid?: boolean
          decision_reason?: string | null
          deploy_environment?: string | null
          expansion_eligible?: boolean | null
          expansion_only_counterfactual_score?: number | null
          expansion_only_counterfactual_trade?: boolean | null
          feature_cutoff_ts?: string | null
          final_prediction?: string | null
          global_history_count?: number | null
          global_history_end_index?: number | null
          global_history_end_ts?: string | null
          global_history_start_index?: number | null
          global_history_start_ts?: string | null
          global_rank?: number | null
          global_rank_quartile?: number | null
          grid_cell?: string | null
          grid_cell_losses?: number | null
          grid_cell_resolved_count?: number | null
          grid_cell_wins?: number | null
          grid_prior_alpha?: number | null
          grid_prior_beta?: number | null
          grid_quality_percentile?: number | null
          grid_reference_count?: number | null
          grid_reference_end_index?: number | null
          grid_reference_end_ts?: string | null
          grid_reference_source_count?: number | null
          grid_reference_start_index?: number | null
          grid_reference_start_ts?: string | null
          grid_snapshot_json?: Json | null
          grid_training_end_index?: number | null
          grid_training_end_ts?: string | null
          grid_training_lookback?: number | null
          grid_training_resolved_count?: number | null
          grid_training_source_count?: number | null
          grid_training_start_index?: number | null
          grid_training_start_ts?: string | null
          grid_window_integrity_passed?: boolean | null
          grid_window_integrity_reason?: string | null
          id?: string
          implementation_revision?: string | null
          intraday_brake_active?: boolean | null
          intraday_brake_veto_fired?: boolean | null
          last_resolution_attempt_at?: string | null
          last_resolution_error?: string | null
          latest_source_candle_ts?: string | null
          leakage_check_passed?: boolean | null
          legacy_resolution_counter_unreliable?: boolean | null
          local_date?: string | null
          model_name?: string
          model_version?: string
          operational_gap_reason?: string | null
          operational_gap_status?: string | null
          p_correct?: number | null
          post_calibration_candidate?: boolean | null
          prospective_test_id?: string
          quality_mean?: number | null
          raw_a2_counterfactual_result?: string | null
          raw_direction?: string | null
          resolution_attempt_count?: number
          resolved_at?: string | null
          resolver_version?: string | null
          result?: string | null
          result_score?: number | null
          revision_activated_at?: string | null
          revision_prospective_test_id?: string | null
          run_finished_at?: string | null
          run_mode?: string
          run_started_at?: string | null
          same_side_filtered_count?: number | null
          same_side_history_count?: number | null
          same_side_history_end_index?: number | null
          same_side_history_end_ts?: string | null
          same_side_history_start_index?: number | null
          same_side_history_start_ts?: string | null
          same_side_input_source_count?: number | null
          same_side_rank?: number | null
          same_side_rank_quartile?: number | null
          same_side_raw_direction_filter?: string | null
          saturation_attribution_class?: string | null
          saturation_calibration_version?: string | null
          saturation_candidate_after?: boolean | null
          saturation_candidate_before?: boolean | null
          saturation_candidate_source_before?: string | null
          saturation_cap_slope?: number | null
          saturation_condition_met?: boolean | null
          saturation_current_aligned_confidence?: number | null
          saturation_current_raw_direction?: string | null
          saturation_dynamic_confidence_cap?: number | null
          saturation_history_count?: number | null
          saturation_history_end_ts?: string | null
          saturation_history_start_ts?: string | null
          saturation_incremental_change?: boolean | null
          saturation_incremental_value?: number | null
          saturation_index?: number | null
          saturation_mean_aligned_confidence?: number | null
          saturation_min_confidence_cap?: number | null
          saturation_ready?: boolean | null
          saturation_reason?: string | null
          saturation_regime_active?: boolean | null
          saturation_same_side_count?: number | null
          saturation_same_side_share?: number | null
          saturation_trigger_threshold?: number | null
          saturation_veto_fired?: boolean | null
          saturation_window?: number | null
          scheduler_invocation_id?: string | null
          selected_route?: string | null
          source_a2_row_id?: string | null
          source_epoch_ts?: string | null
          source_index_absolute?: number | null
          source_index_version?: string | null
          source_prediction_id?: string | null
          source_target_ts?: string | null
          target_candle_ts?: string
          timing_status?: string | null
          updated_at?: string
          variant?: string
          watchdog_detected_at?: string | null
          webhook_eligible?: boolean
          webhook_sent_at?: string | null
          without_saturation_decision?: string | null
          without_saturation_direction?: string | null
          without_saturation_score?: number | null
          without_saturation_skip_reason?: string | null
          would_trade?: boolean
        }
        Relationships: []
      }
      b4x4_shadow_market_data: {
        Row: {
          actual_direction: string | null
          add_cancel_add_total: number | null
          add_cancel_cancel_total: number | null
          add_cancel_imbalance: number | null
          add_cancel_source_available: boolean | null
          attribution_json: Json | null
          b4x4_final_prediction: string | null
          b4x4_prediction_id: string | null
          b4x4_published: boolean | null
          b4x4_raw_direction: string | null
          b4x4_result: string | null
          b4x4_result_score: number | null
          best_ask_price: number | null
          best_ask_qty: number | null
          best_bid_price: number | null
          best_bid_qty: number | null
          book_complete: boolean | null
          capture_attempt_count: number | null
          capture_attempts_json: Json | null
          capture_error_list: Json | null
          capture_status: string | null
          chosen_attempt_id: string | null
          collected_at: string
          collector_error_code: string | null
          collector_error_message: string | null
          coverage_status: string | null
          created_at: string
          cvd_3m: number | null
          depth_imbalance_10bps: number | null
          depth_imbalance_1bps: number | null
          depth_imbalance_25bps: number | null
          depth_imbalance_5bps: number | null
          depth_json: Json | null
          derivatives_json: Json | null
          error_reason: string | null
          feature_cutoff_ts: string | null
          flow_3m_15m_coherent: boolean | null
          flow_agrees_a2: boolean | null
          flow_coherent: boolean | null
          flow_component_count: number | null
          flow_composite_score: number | null
          flow_conflicts_a2: boolean | null
          flow_direction: string | null
          flow_direction_15m: string | null
          flow_direction_3m: string | null
          flow_json: Json | null
          flow_strength: number | null
          flow_strength_percentile: number | null
          flow_strong_coherent: boolean | null
          id: string
          instrument: string | null
          microprice: number | null
          microprice_offset_bps: number | null
          mid_price: number | null
          missing_source_capabilities: string | null
          orderbook_json: Json | null
          path_efficiency_4: number | null
          path_efficiency_4_percentile: number | null
          prev_seq_id: string | null
          provider: string | null
          queue_imbalance_top1: number | null
          queue_imbalance_top20: number | null
          queue_imbalance_top5: number | null
          raw_direction_correct: boolean | null
          raw_direction_relationship: string | null
          regime_json: Json | null
          run_mode: string | null
          sequence_gap: boolean | null
          sequence_gap_count: number | null
          shadow_efficiency_not_mid: boolean | null
          shadow_only: boolean
          shadow_resolved_at: string | null
          shadow_version: string | null
          snapshot_age_ms: number | null
          snapshot_cutoff_ts: string | null
          snapshot_event_ts: string | null
          snapshot_local_receipt_ts: string | null
          snapshot_persisted_at: string | null
          snapshot_received_at: string | null
          source_seq_id: string | null
          spread_abs: number | null
          spread_bps: number | null
          taker_delta_15m: number | null
          taker_delta_2m: number | null
          taker_delta_30s: number | null
          taker_delta_3m: number | null
          taker_delta_5m: number | null
          target_candle_ts: string
          trade_event_count: number | null
          trade_flow_json: Json | null
          trade_window_complete: boolean | null
          trade_windows_complete: boolean | null
          updated_at: string
          used_in_decision: boolean
        }
        Insert: {
          actual_direction?: string | null
          add_cancel_add_total?: number | null
          add_cancel_cancel_total?: number | null
          add_cancel_imbalance?: number | null
          add_cancel_source_available?: boolean | null
          attribution_json?: Json | null
          b4x4_final_prediction?: string | null
          b4x4_prediction_id?: string | null
          b4x4_published?: boolean | null
          b4x4_raw_direction?: string | null
          b4x4_result?: string | null
          b4x4_result_score?: number | null
          best_ask_price?: number | null
          best_ask_qty?: number | null
          best_bid_price?: number | null
          best_bid_qty?: number | null
          book_complete?: boolean | null
          capture_attempt_count?: number | null
          capture_attempts_json?: Json | null
          capture_error_list?: Json | null
          capture_status?: string | null
          chosen_attempt_id?: string | null
          collected_at?: string
          collector_error_code?: string | null
          collector_error_message?: string | null
          coverage_status?: string | null
          created_at?: string
          cvd_3m?: number | null
          depth_imbalance_10bps?: number | null
          depth_imbalance_1bps?: number | null
          depth_imbalance_25bps?: number | null
          depth_imbalance_5bps?: number | null
          depth_json?: Json | null
          derivatives_json?: Json | null
          error_reason?: string | null
          feature_cutoff_ts?: string | null
          flow_3m_15m_coherent?: boolean | null
          flow_agrees_a2?: boolean | null
          flow_coherent?: boolean | null
          flow_component_count?: number | null
          flow_composite_score?: number | null
          flow_conflicts_a2?: boolean | null
          flow_direction?: string | null
          flow_direction_15m?: string | null
          flow_direction_3m?: string | null
          flow_json?: Json | null
          flow_strength?: number | null
          flow_strength_percentile?: number | null
          flow_strong_coherent?: boolean | null
          id?: string
          instrument?: string | null
          microprice?: number | null
          microprice_offset_bps?: number | null
          mid_price?: number | null
          missing_source_capabilities?: string | null
          orderbook_json?: Json | null
          path_efficiency_4?: number | null
          path_efficiency_4_percentile?: number | null
          prev_seq_id?: string | null
          provider?: string | null
          queue_imbalance_top1?: number | null
          queue_imbalance_top20?: number | null
          queue_imbalance_top5?: number | null
          raw_direction_correct?: boolean | null
          raw_direction_relationship?: string | null
          regime_json?: Json | null
          run_mode?: string | null
          sequence_gap?: boolean | null
          sequence_gap_count?: number | null
          shadow_efficiency_not_mid?: boolean | null
          shadow_only?: boolean
          shadow_resolved_at?: string | null
          shadow_version?: string | null
          snapshot_age_ms?: number | null
          snapshot_cutoff_ts?: string | null
          snapshot_event_ts?: string | null
          snapshot_local_receipt_ts?: string | null
          snapshot_persisted_at?: string | null
          snapshot_received_at?: string | null
          source_seq_id?: string | null
          spread_abs?: number | null
          spread_bps?: number | null
          taker_delta_15m?: number | null
          taker_delta_2m?: number | null
          taker_delta_30s?: number | null
          taker_delta_3m?: number | null
          taker_delta_5m?: number | null
          target_candle_ts: string
          trade_event_count?: number | null
          trade_flow_json?: Json | null
          trade_window_complete?: boolean | null
          trade_windows_complete?: boolean | null
          updated_at?: string
          used_in_decision?: boolean
        }
        Update: {
          actual_direction?: string | null
          add_cancel_add_total?: number | null
          add_cancel_cancel_total?: number | null
          add_cancel_imbalance?: number | null
          add_cancel_source_available?: boolean | null
          attribution_json?: Json | null
          b4x4_final_prediction?: string | null
          b4x4_prediction_id?: string | null
          b4x4_published?: boolean | null
          b4x4_raw_direction?: string | null
          b4x4_result?: string | null
          b4x4_result_score?: number | null
          best_ask_price?: number | null
          best_ask_qty?: number | null
          best_bid_price?: number | null
          best_bid_qty?: number | null
          book_complete?: boolean | null
          capture_attempt_count?: number | null
          capture_attempts_json?: Json | null
          capture_error_list?: Json | null
          capture_status?: string | null
          chosen_attempt_id?: string | null
          collected_at?: string
          collector_error_code?: string | null
          collector_error_message?: string | null
          coverage_status?: string | null
          created_at?: string
          cvd_3m?: number | null
          depth_imbalance_10bps?: number | null
          depth_imbalance_1bps?: number | null
          depth_imbalance_25bps?: number | null
          depth_imbalance_5bps?: number | null
          depth_json?: Json | null
          derivatives_json?: Json | null
          error_reason?: string | null
          feature_cutoff_ts?: string | null
          flow_3m_15m_coherent?: boolean | null
          flow_agrees_a2?: boolean | null
          flow_coherent?: boolean | null
          flow_component_count?: number | null
          flow_composite_score?: number | null
          flow_conflicts_a2?: boolean | null
          flow_direction?: string | null
          flow_direction_15m?: string | null
          flow_direction_3m?: string | null
          flow_json?: Json | null
          flow_strength?: number | null
          flow_strength_percentile?: number | null
          flow_strong_coherent?: boolean | null
          id?: string
          instrument?: string | null
          microprice?: number | null
          microprice_offset_bps?: number | null
          mid_price?: number | null
          missing_source_capabilities?: string | null
          orderbook_json?: Json | null
          path_efficiency_4?: number | null
          path_efficiency_4_percentile?: number | null
          prev_seq_id?: string | null
          provider?: string | null
          queue_imbalance_top1?: number | null
          queue_imbalance_top20?: number | null
          queue_imbalance_top5?: number | null
          raw_direction_correct?: boolean | null
          raw_direction_relationship?: string | null
          regime_json?: Json | null
          run_mode?: string | null
          sequence_gap?: boolean | null
          sequence_gap_count?: number | null
          shadow_efficiency_not_mid?: boolean | null
          shadow_only?: boolean
          shadow_resolved_at?: string | null
          shadow_version?: string | null
          snapshot_age_ms?: number | null
          snapshot_cutoff_ts?: string | null
          snapshot_event_ts?: string | null
          snapshot_local_receipt_ts?: string | null
          snapshot_persisted_at?: string | null
          snapshot_received_at?: string | null
          source_seq_id?: string | null
          spread_abs?: number | null
          spread_bps?: number | null
          taker_delta_15m?: number | null
          taker_delta_2m?: number | null
          taker_delta_30s?: number | null
          taker_delta_3m?: number | null
          taker_delta_5m?: number | null
          target_candle_ts?: string
          trade_event_count?: number | null
          trade_flow_json?: Json | null
          trade_window_complete?: boolean | null
          trade_windows_complete?: boolean | null
          updated_at?: string
          used_in_decision?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "b4x4_shadow_market_data_b4x4_prediction_id_fkey"
            columns: ["b4x4_prediction_id"]
            isOneToOne: false
            referencedRelation: "b4x4_predictions"
            referencedColumns: ["id"]
          },
        ]
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
          td2_policy_activation_ts: string | null
          td2_policy_version: string | null
          td2_prospective_test_id: string | null
          td2_r1_counterfactual_decision: string | null
          td2_r1_counterfactual_result: string | null
          td2_r1_counterfactual_score: number | null
          td2_r1_counterfactual_skip_reason: string | null
          td2_r1_counterfactual_would_trade: boolean | null
          td2_recovery_condition: boolean | null
          td2_recovery_direction: string | null
          td2_recovery_evaluable: boolean | null
          td2_recovery_feature_name: string | null
          td2_recovery_feature_value: number | null
          td2_recovery_fired: boolean | null
          td2_recovery_incremental_value: number | null
          td2_recovery_reason: string | null
          td2_recovery_result: string | null
          td2_recovery_score: number | null
          td2_recovery_source_feature_cutoff_ts: string | null
          td2_recovery_threshold: number | null
          td2_recovery_value_class: string | null
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
          td2_policy_activation_ts?: string | null
          td2_policy_version?: string | null
          td2_prospective_test_id?: string | null
          td2_r1_counterfactual_decision?: string | null
          td2_r1_counterfactual_result?: string | null
          td2_r1_counterfactual_score?: number | null
          td2_r1_counterfactual_skip_reason?: string | null
          td2_r1_counterfactual_would_trade?: boolean | null
          td2_recovery_condition?: boolean | null
          td2_recovery_direction?: string | null
          td2_recovery_evaluable?: boolean | null
          td2_recovery_feature_name?: string | null
          td2_recovery_feature_value?: number | null
          td2_recovery_fired?: boolean | null
          td2_recovery_incremental_value?: number | null
          td2_recovery_reason?: string | null
          td2_recovery_result?: string | null
          td2_recovery_score?: number | null
          td2_recovery_source_feature_cutoff_ts?: string | null
          td2_recovery_threshold?: number | null
          td2_recovery_value_class?: string | null
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
          td2_policy_activation_ts?: string | null
          td2_policy_version?: string | null
          td2_prospective_test_id?: string | null
          td2_r1_counterfactual_decision?: string | null
          td2_r1_counterfactual_result?: string | null
          td2_r1_counterfactual_score?: number | null
          td2_r1_counterfactual_skip_reason?: string | null
          td2_r1_counterfactual_would_trade?: boolean | null
          td2_recovery_condition?: boolean | null
          td2_recovery_direction?: string | null
          td2_recovery_evaluable?: boolean | null
          td2_recovery_feature_name?: string | null
          td2_recovery_feature_value?: number | null
          td2_recovery_fired?: boolean | null
          td2_recovery_incremental_value?: number | null
          td2_recovery_reason?: string | null
          td2_recovery_result?: string | null
          td2_recovery_score?: number | null
          td2_recovery_source_feature_cutoff_ts?: string | null
          td2_recovery_threshold?: number | null
          td2_recovery_value_class?: string | null
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
      t45_activation: {
        Row: {
          activation_target_ts: string | null
          approval_note: string | null
          approved_at: string | null
          freeze_sha256: string | null
          mode: string
          singleton_key: string
          updated_at: string
          webhooks_enabled: boolean
        }
        Insert: {
          activation_target_ts?: string | null
          approval_note?: string | null
          approved_at?: string | null
          freeze_sha256?: string | null
          mode?: string
          singleton_key?: string
          updated_at?: string
          webhooks_enabled?: boolean
        }
        Update: {
          activation_target_ts?: string | null
          approval_note?: string | null
          approved_at?: string | null
          freeze_sha256?: string | null
          mode?: string
          singleton_key?: string
          updated_at?: string
          webhooks_enabled?: boolean
        }
        Relationships: []
      }
      t45_collector_health: {
        Row: {
          build_identifier: string | null
          collector_version: string | null
          consecutive_errors: number
          deployment_id: string | null
          id: string
          last_bar_close_ts: string | null
          last_error_code: string | null
          last_error_message: string | null
          last_heartbeat_at: string | null
          last_received_at: string | null
          last_target_seconds: number | null
          last_target_ts: string | null
          reconnect_count: number
          status: string
          stream_key: string
          symbol: string
          updated_at: string
          venue: string
        }
        Insert: {
          build_identifier?: string | null
          collector_version?: string | null
          consecutive_errors?: number
          deployment_id?: string | null
          id?: string
          last_bar_close_ts?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_heartbeat_at?: string | null
          last_received_at?: string | null
          last_target_seconds?: number | null
          last_target_ts?: string | null
          reconnect_count?: number
          status?: string
          stream_key: string
          symbol?: string
          updated_at?: string
          venue?: string
        }
        Update: {
          build_identifier?: string | null
          collector_version?: string | null
          consecutive_errors?: number
          deployment_id?: string | null
          id?: string
          last_bar_close_ts?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_heartbeat_at?: string | null
          last_received_at?: string | null
          last_target_seconds?: number | null
          last_target_ts?: string | null
          reconnect_count?: number
          status?: string
          stream_key?: string
          symbol?: string
          updated_at?: string
          venue?: string
        }
        Relationships: []
      }
      t45_features: {
        Row: {
          config_hash: string | null
          created_at: string
          feature_complete: boolean
          feature_cutoff_ts: string | null
          feature_invalid_reason: string | null
          feature_values_json: Json | null
          feature_vector_hash: string | null
          feature_version: string
          id: string
          r2_prior_key: string | null
          r2_prior_source: string | null
          row_source: string
          seconds_present: number | null
          spot_complete: boolean
          t45_body_range_45s: number | null
          t45_book_age_at_cutoff_s: number | null
          t45_book_final_offset_s: number | null
          t45_book_first_offset_s: number | null
          t45_book_imb_100: number | null
          t45_book_imb_20: number | null
          t45_book_imb_200: number | null
          t45_book_imb_300: number | null
          t45_book_imb_400: number | null
          t45_book_imb_500: number | null
          t45_book_imb_delta_100: number | null
          t45_book_imb_delta_20: number | null
          t45_book_imb_delta_200: number | null
          t45_book_imb_delta_300: number | null
          t45_book_imb_delta_400: number | null
          t45_book_imb_delta_500: number | null
          t45_book_log_total_depth_100: number | null
          t45_book_log_total_depth_20: number | null
          t45_book_log_total_depth_200: number | null
          t45_book_log_total_depth_300: number | null
          t45_book_log_total_depth_400: number | null
          t45_book_log_total_depth_500: number | null
          t45_book_log_total_notional_100: number | null
          t45_book_log_total_notional_20: number | null
          t45_book_log_total_notional_200: number | null
          t45_book_log_total_notional_300: number | null
          t45_book_log_total_notional_400: number | null
          t45_book_log_total_notional_500: number | null
          t45_book_snapshot_count: number | null
          t45_close_15s: number | null
          t45_close_30s: number | null
          t45_close_45s: number | null
          t45_close_5s: number | null
          t45_close_location_45s: number | null
          t45_close_vwap_gap_bps: number | null
          t45_first_offset_s: number | null
          t45_last_offset_s: number | null
          t45_last15_ret_bps: number | null
          t45_last30_ret_bps: number | null
          t45_log_price_slope_bps_per_s: number | null
          t45_log_quote_volume_45s: number | null
          t45_log_trade_count_45s: number | null
          t45_partial_direction: number | null
          t45_path_direction_consistency: number | null
          t45_path_efficiency_45s: number | null
          t45_price_flow_alignment: number | null
          t45_quote_flow_15s: number | null
          t45_quote_flow_30s: number | null
          t45_quote_flow_45s: number | null
          t45_quote_flow_5s: number | null
          t45_quote_volume_15s: number | null
          t45_quote_volume_30s: number | null
          t45_quote_volume_45s: number | null
          t45_quote_volume_5s: number | null
          t45_quote_volume_last15_share: number | null
          t45_r2_partial_agreement: number | null
          t45_r2_prediction: number | null
          t45_r2_ret45_interaction: number | null
          t45_r2_would_trade: number | null
          t45_range_15s_bps: number | null
          t45_range_30s_bps: number | null
          t45_range_45s_bps: number | null
          t45_range_5s_bps: number | null
          t45_realized_vol_45s_bps: number | null
          t45_ret_15s_bps: number | null
          t45_ret_30s_bps: number | null
          t45_ret_45s_bps: number | null
          t45_ret_5s_bps: number | null
          t45_return_accel_15_45_bps: number | null
          t45_return_sign_changes: number | null
          t45_return_sign_persistence: number | null
          t45_seconds_count: number | null
          t45_spot_complete: number | null
          t45_spot_open: number | null
          t45_trade_count_15s: number | null
          t45_trade_count_30s: number | null
          t45_trade_count_45s: number | null
          t45_trade_count_5s: number | null
          t45_trade_count_last15_share: number | null
          target_ts: string
        }
        Insert: {
          config_hash?: string | null
          created_at?: string
          feature_complete?: boolean
          feature_cutoff_ts?: string | null
          feature_invalid_reason?: string | null
          feature_values_json?: Json | null
          feature_vector_hash?: string | null
          feature_version?: string
          id?: string
          r2_prior_key?: string | null
          r2_prior_source?: string | null
          row_source?: string
          seconds_present?: number | null
          spot_complete?: boolean
          t45_body_range_45s?: number | null
          t45_book_age_at_cutoff_s?: number | null
          t45_book_final_offset_s?: number | null
          t45_book_first_offset_s?: number | null
          t45_book_imb_100?: number | null
          t45_book_imb_20?: number | null
          t45_book_imb_200?: number | null
          t45_book_imb_300?: number | null
          t45_book_imb_400?: number | null
          t45_book_imb_500?: number | null
          t45_book_imb_delta_100?: number | null
          t45_book_imb_delta_20?: number | null
          t45_book_imb_delta_200?: number | null
          t45_book_imb_delta_300?: number | null
          t45_book_imb_delta_400?: number | null
          t45_book_imb_delta_500?: number | null
          t45_book_log_total_depth_100?: number | null
          t45_book_log_total_depth_20?: number | null
          t45_book_log_total_depth_200?: number | null
          t45_book_log_total_depth_300?: number | null
          t45_book_log_total_depth_400?: number | null
          t45_book_log_total_depth_500?: number | null
          t45_book_log_total_notional_100?: number | null
          t45_book_log_total_notional_20?: number | null
          t45_book_log_total_notional_200?: number | null
          t45_book_log_total_notional_300?: number | null
          t45_book_log_total_notional_400?: number | null
          t45_book_log_total_notional_500?: number | null
          t45_book_snapshot_count?: number | null
          t45_close_15s?: number | null
          t45_close_30s?: number | null
          t45_close_45s?: number | null
          t45_close_5s?: number | null
          t45_close_location_45s?: number | null
          t45_close_vwap_gap_bps?: number | null
          t45_first_offset_s?: number | null
          t45_last_offset_s?: number | null
          t45_last15_ret_bps?: number | null
          t45_last30_ret_bps?: number | null
          t45_log_price_slope_bps_per_s?: number | null
          t45_log_quote_volume_45s?: number | null
          t45_log_trade_count_45s?: number | null
          t45_partial_direction?: number | null
          t45_path_direction_consistency?: number | null
          t45_path_efficiency_45s?: number | null
          t45_price_flow_alignment?: number | null
          t45_quote_flow_15s?: number | null
          t45_quote_flow_30s?: number | null
          t45_quote_flow_45s?: number | null
          t45_quote_flow_5s?: number | null
          t45_quote_volume_15s?: number | null
          t45_quote_volume_30s?: number | null
          t45_quote_volume_45s?: number | null
          t45_quote_volume_5s?: number | null
          t45_quote_volume_last15_share?: number | null
          t45_r2_partial_agreement?: number | null
          t45_r2_prediction?: number | null
          t45_r2_ret45_interaction?: number | null
          t45_r2_would_trade?: number | null
          t45_range_15s_bps?: number | null
          t45_range_30s_bps?: number | null
          t45_range_45s_bps?: number | null
          t45_range_5s_bps?: number | null
          t45_realized_vol_45s_bps?: number | null
          t45_ret_15s_bps?: number | null
          t45_ret_30s_bps?: number | null
          t45_ret_45s_bps?: number | null
          t45_ret_5s_bps?: number | null
          t45_return_accel_15_45_bps?: number | null
          t45_return_sign_changes?: number | null
          t45_return_sign_persistence?: number | null
          t45_seconds_count?: number | null
          t45_spot_complete?: number | null
          t45_spot_open?: number | null
          t45_trade_count_15s?: number | null
          t45_trade_count_30s?: number | null
          t45_trade_count_45s?: number | null
          t45_trade_count_5s?: number | null
          t45_trade_count_last15_share?: number | null
          target_ts: string
        }
        Update: {
          config_hash?: string | null
          created_at?: string
          feature_complete?: boolean
          feature_cutoff_ts?: string | null
          feature_invalid_reason?: string | null
          feature_values_json?: Json | null
          feature_vector_hash?: string | null
          feature_version?: string
          id?: string
          r2_prior_key?: string | null
          r2_prior_source?: string | null
          row_source?: string
          seconds_present?: number | null
          spot_complete?: boolean
          t45_body_range_45s?: number | null
          t45_book_age_at_cutoff_s?: number | null
          t45_book_final_offset_s?: number | null
          t45_book_first_offset_s?: number | null
          t45_book_imb_100?: number | null
          t45_book_imb_20?: number | null
          t45_book_imb_200?: number | null
          t45_book_imb_300?: number | null
          t45_book_imb_400?: number | null
          t45_book_imb_500?: number | null
          t45_book_imb_delta_100?: number | null
          t45_book_imb_delta_20?: number | null
          t45_book_imb_delta_200?: number | null
          t45_book_imb_delta_300?: number | null
          t45_book_imb_delta_400?: number | null
          t45_book_imb_delta_500?: number | null
          t45_book_log_total_depth_100?: number | null
          t45_book_log_total_depth_20?: number | null
          t45_book_log_total_depth_200?: number | null
          t45_book_log_total_depth_300?: number | null
          t45_book_log_total_depth_400?: number | null
          t45_book_log_total_depth_500?: number | null
          t45_book_log_total_notional_100?: number | null
          t45_book_log_total_notional_20?: number | null
          t45_book_log_total_notional_200?: number | null
          t45_book_log_total_notional_300?: number | null
          t45_book_log_total_notional_400?: number | null
          t45_book_log_total_notional_500?: number | null
          t45_book_snapshot_count?: number | null
          t45_close_15s?: number | null
          t45_close_30s?: number | null
          t45_close_45s?: number | null
          t45_close_5s?: number | null
          t45_close_location_45s?: number | null
          t45_close_vwap_gap_bps?: number | null
          t45_first_offset_s?: number | null
          t45_last_offset_s?: number | null
          t45_last15_ret_bps?: number | null
          t45_last30_ret_bps?: number | null
          t45_log_price_slope_bps_per_s?: number | null
          t45_log_quote_volume_45s?: number | null
          t45_log_trade_count_45s?: number | null
          t45_partial_direction?: number | null
          t45_path_direction_consistency?: number | null
          t45_path_efficiency_45s?: number | null
          t45_price_flow_alignment?: number | null
          t45_quote_flow_15s?: number | null
          t45_quote_flow_30s?: number | null
          t45_quote_flow_45s?: number | null
          t45_quote_flow_5s?: number | null
          t45_quote_volume_15s?: number | null
          t45_quote_volume_30s?: number | null
          t45_quote_volume_45s?: number | null
          t45_quote_volume_5s?: number | null
          t45_quote_volume_last15_share?: number | null
          t45_r2_partial_agreement?: number | null
          t45_r2_prediction?: number | null
          t45_r2_ret45_interaction?: number | null
          t45_r2_would_trade?: number | null
          t45_range_15s_bps?: number | null
          t45_range_30s_bps?: number | null
          t45_range_45s_bps?: number | null
          t45_range_5s_bps?: number | null
          t45_realized_vol_45s_bps?: number | null
          t45_ret_15s_bps?: number | null
          t45_ret_30s_bps?: number | null
          t45_ret_45s_bps?: number | null
          t45_ret_5s_bps?: number | null
          t45_return_accel_15_45_bps?: number | null
          t45_return_sign_changes?: number | null
          t45_return_sign_persistence?: number | null
          t45_seconds_count?: number | null
          t45_spot_complete?: number | null
          t45_spot_open?: number | null
          t45_trade_count_15s?: number | null
          t45_trade_count_30s?: number | null
          t45_trade_count_45s?: number | null
          t45_trade_count_5s?: number | null
          t45_trade_count_last15_share?: number | null
          target_ts?: string
        }
        Relationships: []
      }
      t45_fits: {
        Row: {
          artifact_sha256: string | null
          block_index: number
          block_start_index: number
          coefficients: number[]
          converged: boolean
          created_at: string
          feature_order: string[]
          fit_id: string
          fitter_code_hash: string | null
          gradient_norm: number | null
          id: string
          intercept: number
          iterations: number | null
          logistic_c: number
          model_version: string
          scaler_center: number[]
          scaler_scale: number[]
          solver: string
          training_end_ts: string | null
          training_row_count: number
          training_start_ts: string | null
        }
        Insert: {
          artifact_sha256?: string | null
          block_index: number
          block_start_index: number
          coefficients: number[]
          converged: boolean
          created_at?: string
          feature_order: string[]
          fit_id: string
          fitter_code_hash?: string | null
          gradient_norm?: number | null
          id?: string
          intercept: number
          iterations?: number | null
          logistic_c: number
          model_version: string
          scaler_center: number[]
          scaler_scale: number[]
          solver: string
          training_end_ts?: string | null
          training_row_count: number
          training_start_ts?: string | null
        }
        Update: {
          artifact_sha256?: string | null
          block_index?: number
          block_start_index?: number
          coefficients?: number[]
          converged?: boolean
          created_at?: string
          feature_order?: string[]
          fit_id?: string
          fitter_code_hash?: string | null
          gradient_norm?: number | null
          id?: string
          intercept?: number
          iterations?: number | null
          logistic_c?: number
          model_version?: string
          scaler_center?: number[]
          scaler_scale?: number[]
          solver?: string
          training_end_ts?: string | null
          training_row_count?: number
          training_start_ts?: string | null
        }
        Relationships: []
      }
      t45_pf_activation: {
        Row: {
          activation_target_ts: string | null
          approval_note: string | null
          approved_at: string | null
          config_hash: string
          mode: string
          model_version: string
          singleton_key: string
          updated_at: string
          webhooks_enabled: boolean
        }
        Insert: {
          activation_target_ts?: string | null
          approval_note?: string | null
          approved_at?: string | null
          config_hash: string
          mode?: string
          model_version: string
          singleton_key: string
          updated_at?: string
          webhooks_enabled?: boolean
        }
        Update: {
          activation_target_ts?: string | null
          approval_note?: string | null
          approved_at?: string | null
          config_hash?: string
          mode?: string
          model_version?: string
          singleton_key?: string
          updated_at?: string
          webhooks_enabled?: boolean
        }
        Relationships: []
      }
      t45_pf_fits: {
        Row: {
          artifact_hash: string | null
          block_index: number
          block_start_index: number
          certified: boolean
          coefficients: number[] | null
          config_hash: string
          converged: boolean | null
          created_at: string
          feature_order: string[]
          feature_order_hash: string
          feature_schema: string
          fit_id: string
          gradient_norm: number | null
          id: string
          impl_revision: string | null
          intercept: number | null
          iterations: number | null
          logistic_c: number | null
          model_version: string
          scaler: string | null
          scaler_center: number[] | null
          scaler_scale: number[] | null
          solver: string | null
          training_end_ts: string | null
          training_fingerprint: string | null
          training_row_count: number
          training_start_ts: string | null
        }
        Insert: {
          artifact_hash?: string | null
          block_index: number
          block_start_index: number
          certified?: boolean
          coefficients?: number[] | null
          config_hash: string
          converged?: boolean | null
          created_at?: string
          feature_order: string[]
          feature_order_hash: string
          feature_schema: string
          fit_id: string
          gradient_norm?: number | null
          id?: string
          impl_revision?: string | null
          intercept?: number | null
          iterations?: number | null
          logistic_c?: number | null
          model_version: string
          scaler?: string | null
          scaler_center?: number[] | null
          scaler_scale?: number[] | null
          solver?: string | null
          training_end_ts?: string | null
          training_fingerprint?: string | null
          training_row_count: number
          training_start_ts?: string | null
        }
        Update: {
          artifact_hash?: string | null
          block_index?: number
          block_start_index?: number
          certified?: boolean
          coefficients?: number[] | null
          config_hash?: string
          converged?: boolean | null
          created_at?: string
          feature_order?: string[]
          feature_order_hash?: string
          feature_schema?: string
          fit_id?: string
          gradient_norm?: number | null
          id?: string
          impl_revision?: string | null
          intercept?: number | null
          iterations?: number | null
          logistic_c?: number | null
          model_version?: string
          scaler?: string | null
          scaler_center?: number[] | null
          scaler_scale?: number[] | null
          solver?: string | null
          training_end_ts?: string | null
          training_fingerprint?: string | null
          training_row_count?: number
          training_start_ts?: string | null
        }
        Relationships: []
      }
      t45_pf_predictions: {
        Row: {
          activation_mode: string
          active_prediction: number | null
          active_result: string | null
          active_score: number | null
          active_sleeve: string | null
          active_would_trade: boolean
          actual_close: number | null
          actual_direction: number | null
          actual_high: number | null
          actual_low: number | null
          actual_observations: number | null
          actual_open: number | null
          base_direction: number | null
          base_head: string | null
          confidence: number | null
          confidence_rank: number | null
          config_hash: string
          created_at: string
          decided_at: string | null
          decision_cutoff_ts: string | null
          decision_reason: string | null
          decision_valid: boolean
          duplicate_offsets: number[] | null
          execution_path: string | null
          expected_observations: number | null
          feature_complete: boolean | null
          feature_order_hash: string
          feature_schema: string
          feature_values_json: Json | null
          fit_artifact_hash: string | null
          fit_block_index: number | null
          fit_block_start_index: number | null
          fit_certified: boolean | null
          fit_id: string | null
          fit_training_fingerprint: string | null
          fit_training_row_count: number | null
          id: string
          impl_revision: string | null
          last_resolution_error: string | null
          local_date: string | null
          max_offset_seconds: number | null
          min_offset_seconds: number | null
          missing_offsets: number[] | null
          model_name: string
          model_variant: string
          model_version: string
          outcome_source: string | null
          packet_ready: boolean | null
          probability_green: number | null
          rank_history_count: number | null
          repair_base_direction: number | null
          repair_confidence: number | null
          repair_confidence_rank: number | null
          repair_fit_id: string | null
          repair_prediction: number | null
          repair_probability_green: number | null
          repair_state_checksum: string | null
          repair_would_trade: boolean | null
          repaired_at: string | null
          resolution_attempts: number
          resolved_at: string | null
          run_mode: string
          scaler: string | null
          solver: string | null
          source_last_bar_ts: string | null
          target_ts: string
          timing_valid: boolean | null
          unique_observations: number | null
          updated_at: string
          utc_date: string | null
          webhook_eligible: boolean
          webhook_idempotency_key: string | null
          webhook_sent: boolean
        }
        Insert: {
          activation_mode?: string
          active_prediction?: number | null
          active_result?: string | null
          active_score?: number | null
          active_sleeve?: string | null
          active_would_trade?: boolean
          actual_close?: number | null
          actual_direction?: number | null
          actual_high?: number | null
          actual_low?: number | null
          actual_observations?: number | null
          actual_open?: number | null
          base_direction?: number | null
          base_head?: string | null
          confidence?: number | null
          confidence_rank?: number | null
          config_hash: string
          created_at?: string
          decided_at?: string | null
          decision_cutoff_ts?: string | null
          decision_reason?: string | null
          decision_valid?: boolean
          duplicate_offsets?: number[] | null
          execution_path?: string | null
          expected_observations?: number | null
          feature_complete?: boolean | null
          feature_order_hash: string
          feature_schema: string
          feature_values_json?: Json | null
          fit_artifact_hash?: string | null
          fit_block_index?: number | null
          fit_block_start_index?: number | null
          fit_certified?: boolean | null
          fit_id?: string | null
          fit_training_fingerprint?: string | null
          fit_training_row_count?: number | null
          id?: string
          impl_revision?: string | null
          last_resolution_error?: string | null
          local_date?: string | null
          max_offset_seconds?: number | null
          min_offset_seconds?: number | null
          missing_offsets?: number[] | null
          model_name: string
          model_variant: string
          model_version: string
          outcome_source?: string | null
          packet_ready?: boolean | null
          probability_green?: number | null
          rank_history_count?: number | null
          repair_base_direction?: number | null
          repair_confidence?: number | null
          repair_confidence_rank?: number | null
          repair_fit_id?: string | null
          repair_prediction?: number | null
          repair_probability_green?: number | null
          repair_state_checksum?: string | null
          repair_would_trade?: boolean | null
          repaired_at?: string | null
          resolution_attempts?: number
          resolved_at?: string | null
          run_mode: string
          scaler?: string | null
          solver?: string | null
          source_last_bar_ts?: string | null
          target_ts: string
          timing_valid?: boolean | null
          unique_observations?: number | null
          updated_at?: string
          utc_date?: string | null
          webhook_eligible?: boolean
          webhook_idempotency_key?: string | null
          webhook_sent?: boolean
        }
        Update: {
          activation_mode?: string
          active_prediction?: number | null
          active_result?: string | null
          active_score?: number | null
          active_sleeve?: string | null
          active_would_trade?: boolean
          actual_close?: number | null
          actual_direction?: number | null
          actual_high?: number | null
          actual_low?: number | null
          actual_observations?: number | null
          actual_open?: number | null
          base_direction?: number | null
          base_head?: string | null
          confidence?: number | null
          confidence_rank?: number | null
          config_hash?: string
          created_at?: string
          decided_at?: string | null
          decision_cutoff_ts?: string | null
          decision_reason?: string | null
          decision_valid?: boolean
          duplicate_offsets?: number[] | null
          execution_path?: string | null
          expected_observations?: number | null
          feature_complete?: boolean | null
          feature_order_hash?: string
          feature_schema?: string
          feature_values_json?: Json | null
          fit_artifact_hash?: string | null
          fit_block_index?: number | null
          fit_block_start_index?: number | null
          fit_certified?: boolean | null
          fit_id?: string | null
          fit_training_fingerprint?: string | null
          fit_training_row_count?: number | null
          id?: string
          impl_revision?: string | null
          last_resolution_error?: string | null
          local_date?: string | null
          max_offset_seconds?: number | null
          min_offset_seconds?: number | null
          missing_offsets?: number[] | null
          model_name?: string
          model_variant?: string
          model_version?: string
          outcome_source?: string | null
          packet_ready?: boolean | null
          probability_green?: number | null
          rank_history_count?: number | null
          repair_base_direction?: number | null
          repair_confidence?: number | null
          repair_confidence_rank?: number | null
          repair_fit_id?: string | null
          repair_prediction?: number | null
          repair_probability_green?: number | null
          repair_state_checksum?: string | null
          repair_would_trade?: boolean | null
          repaired_at?: string | null
          resolution_attempts?: number
          resolved_at?: string | null
          run_mode?: string
          scaler?: string | null
          solver?: string | null
          source_last_bar_ts?: string | null
          target_ts?: string
          timing_valid?: boolean | null
          unique_observations?: number | null
          updated_at?: string
          utc_date?: string | null
          webhook_eligible?: boolean
          webhook_idempotency_key?: string | null
          webhook_sent?: boolean
        }
        Relationships: []
      }
      t45_predictions: {
        Row: {
          active_prediction: number | null
          active_result: string | null
          active_score: number | null
          active_sleeve: string | null
          active_would_trade: boolean | null
          actual_close: number | null
          actual_direction: number | null
          actual_open: number | null
          base_direction: number | null
          base_head: string
          build_identifier: string | null
          confidence: number | null
          confidence_rank: number | null
          config_hash: string | null
          created_at: string
          decided_at: string | null
          decision_cutoff_ts: string | null
          decision_invalid_reason: string | null
          decision_valid: boolean
          feature_complete: boolean | null
          fit_block_index: number | null
          fit_id: string | null
          fit_training_row_count: number | null
          id: string
          local_date: string | null
          model_name: string
          model_variant: string
          model_version: string
          outcome_source: string | null
          precision_core: boolean | null
          probability_green: number | null
          r2_prior_available: boolean
          r2_prior_key: string | null
          r2_prior_prediction: number | null
          r2_prior_source: string | null
          rank_history_count: number | null
          resolved_at: string | null
          run_mode: string
          target_ts: string
          webhook_eligible: boolean
          webhook_sent: boolean
        }
        Insert: {
          active_prediction?: number | null
          active_result?: string | null
          active_score?: number | null
          active_sleeve?: string | null
          active_would_trade?: boolean | null
          actual_close?: number | null
          actual_direction?: number | null
          actual_open?: number | null
          base_direction?: number | null
          base_head?: string
          build_identifier?: string | null
          confidence?: number | null
          confidence_rank?: number | null
          config_hash?: string | null
          created_at?: string
          decided_at?: string | null
          decision_cutoff_ts?: string | null
          decision_invalid_reason?: string | null
          decision_valid?: boolean
          feature_complete?: boolean | null
          fit_block_index?: number | null
          fit_id?: string | null
          fit_training_row_count?: number | null
          id?: string
          local_date?: string | null
          model_name?: string
          model_variant?: string
          model_version?: string
          outcome_source?: string | null
          precision_core?: boolean | null
          probability_green?: number | null
          r2_prior_available?: boolean
          r2_prior_key?: string | null
          r2_prior_prediction?: number | null
          r2_prior_source?: string | null
          rank_history_count?: number | null
          resolved_at?: string | null
          run_mode?: string
          target_ts: string
          webhook_eligible?: boolean
          webhook_sent?: boolean
        }
        Update: {
          active_prediction?: number | null
          active_result?: string | null
          active_score?: number | null
          active_sleeve?: string | null
          active_would_trade?: boolean | null
          actual_close?: number | null
          actual_direction?: number | null
          actual_open?: number | null
          base_direction?: number | null
          base_head?: string
          build_identifier?: string | null
          confidence?: number | null
          confidence_rank?: number | null
          config_hash?: string | null
          created_at?: string
          decided_at?: string | null
          decision_cutoff_ts?: string | null
          decision_invalid_reason?: string | null
          decision_valid?: boolean
          feature_complete?: boolean | null
          fit_block_index?: number | null
          fit_id?: string | null
          fit_training_row_count?: number | null
          id?: string
          local_date?: string | null
          model_name?: string
          model_variant?: string
          model_version?: string
          outcome_source?: string | null
          precision_core?: boolean | null
          probability_green?: number | null
          r2_prior_available?: boolean
          r2_prior_key?: string | null
          r2_prior_prediction?: number | null
          r2_prior_source?: string | null
          rank_history_count?: number | null
          resolved_at?: string | null
          run_mode?: string
          target_ts?: string
          webhook_eligible?: boolean
          webhook_sent?: boolean
        }
        Relationships: []
      }
      t45_second_samples: {
        Row: {
          bar_close_ts: string | null
          bar_open_ts: string | null
          build_identifier: string | null
          capture_reason: string | null
          capture_status: string
          close: number | null
          collector_version: string
          created_at: string
          high: number | null
          id: string
          is_final: boolean
          low: number | null
          offset_seconds: number
          open: number | null
          quote_volume: number | null
          received_at: string | null
          source_stream_id: string
          symbol: string
          taker_buy_quote_volume: number | null
          taker_buy_volume: number | null
          target_ts: string
          trade_count: number | null
          venue: string
          volume: number | null
        }
        Insert: {
          bar_close_ts?: string | null
          bar_open_ts?: string | null
          build_identifier?: string | null
          capture_reason?: string | null
          capture_status?: string
          close?: number | null
          collector_version: string
          created_at?: string
          high?: number | null
          id?: string
          is_final?: boolean
          low?: number | null
          offset_seconds: number
          open?: number | null
          quote_volume?: number | null
          received_at?: string | null
          source_stream_id: string
          symbol?: string
          taker_buy_quote_volume?: number | null
          taker_buy_volume?: number | null
          target_ts: string
          trade_count?: number | null
          venue?: string
          volume?: number | null
        }
        Update: {
          bar_close_ts?: string | null
          bar_open_ts?: string | null
          build_identifier?: string | null
          capture_reason?: string | null
          capture_status?: string
          close?: number | null
          collector_version?: string
          created_at?: string
          high?: number | null
          id?: string
          is_final?: boolean
          low?: number | null
          offset_seconds?: number
          open?: number | null
          quote_volume?: number | null
          received_at?: string | null
          source_stream_id?: string
          symbol?: string
          taker_buy_quote_volume?: number | null
          taker_buy_volume?: number | null
          target_ts?: string
          trade_count?: number | null
          venue?: string
          volume?: number | null
        }
        Relationships: []
      }
      t45_training_labels: {
        Row: {
          evaluation_label_strict: number | null
          label_source: string | null
          target_ts: string
          training_label_feedback: number | null
          updated_at: string
        }
        Insert: {
          evaluation_label_strict?: number | null
          label_source?: string | null
          target_ts: string
          training_label_feedback?: number | null
          updated_at?: string
        }
        Update: {
          evaluation_label_strict?: number | null
          label_source?: string | null
          target_ts?: string
          training_label_feedback?: number | null
          updated_at?: string
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
      v6_broad_red_state: {
        Row: {
          broad_red_history_count: number
          broad_red_history_json: Json
          broad_red_last_resolved_target_ts: string | null
          broad_red_last12_adjusted_net: number
          broad_red_last12_losses: number
          broad_red_last12_wins: number
          broad_red_reliability_ready: boolean
          broad_red_reliability_threshold: number
          broad_red_reliability_veto_active: boolean
          broad_red_state_updated_at: string
          feature_schema_version: string | null
          fit_id: string | null
          model_artifact_sha256: string | null
          model_revision: string
          model_version: string
        }
        Insert: {
          broad_red_history_count?: number
          broad_red_history_json?: Json
          broad_red_last_resolved_target_ts?: string | null
          broad_red_last12_adjusted_net?: number
          broad_red_last12_losses?: number
          broad_red_last12_wins?: number
          broad_red_reliability_ready?: boolean
          broad_red_reliability_threshold?: number
          broad_red_reliability_veto_active?: boolean
          broad_red_state_updated_at?: string
          feature_schema_version?: string | null
          fit_id?: string | null
          model_artifact_sha256?: string | null
          model_revision: string
          model_version: string
        }
        Update: {
          broad_red_history_count?: number
          broad_red_history_json?: Json
          broad_red_last_resolved_target_ts?: string | null
          broad_red_last12_adjusted_net?: number
          broad_red_last12_losses?: number
          broad_red_last12_wins?: number
          broad_red_reliability_ready?: boolean
          broad_red_reliability_threshold?: number
          broad_red_reliability_veto_active?: boolean
          broad_red_state_updated_at?: string
          feature_schema_version?: string | null
          fit_id?: string | null
          model_artifact_sha256?: string | null
          model_revision?: string
          model_version?: string
        }
        Relationships: []
      }
      v6_predictions: {
        Row: {
          abstain_reason: string | null
          abstain_status: string | null
          aligned_wick_pressure_4: number | null
          anchor_distance_from_neutral: number | null
          anchor_percentile: number | null
          anchor_score: number | null
          b4x4_direction_at_send: string | null
          base_green_count_last8: number | null
          base_predictions_last8_json: Json | null
          base_v6_adjusted_score: number | null
          base_v6_prediction: string | null
          base_v6_raw_score: number | null
          broad_conflict_anchor_direction: string | null
          broad_conflict_anchor_distance: number | null
          broad_conflict_anchor_percentile: number | null
          broad_conflict_max_distance: number | null
          broad_conflict_min_distance: number | null
          broad_conflict_original_prediction: string | null
          broad_conflict_original_source: string | null
          broad_conflict_publication_enabled: boolean | null
          broad_conflict_underlying_adjusted_score: number | null
          broad_conflict_underlying_prediction: string | null
          broad_conflict_underlying_raw_score: number | null
          broad_conflict_veto_adjusted_contribution: number | null
          broad_conflict_veto_evaluable: boolean | null
          broad_conflict_veto_raw_contribution: number | null
          broad_conflict_veto_reason: string | null
          broad_conflict_veto_triggered: boolean | null
          broad_distance_from_neutral: number | null
          broad_percentile: number | null
          broad_red_history_count: number | null
          broad_red_history_json: Json | null
          broad_red_last12_adjusted_net: number | null
          broad_red_last12_losses: number | null
          broad_red_last12_wins: number | null
          broad_red_reliability_adjusted_contribution: number | null
          broad_red_reliability_evaluable: boolean | null
          broad_red_reliability_publication_enabled: boolean | null
          broad_red_reliability_raw_contribution: number | null
          broad_red_reliability_ready: boolean | null
          broad_red_reliability_reason: string | null
          broad_red_reliability_threshold: number | null
          broad_red_reliability_veto_active: boolean | null
          broad_red_reliability_veto_triggered: boolean | null
          broad_red_shadow_adjusted_score: number | null
          broad_red_shadow_prediction: string | null
          broad_red_underlying_adjusted_score: number | null
          broad_red_underlying_prediction: string | null
          broad_red_underlying_raw_score: number | null
          broad_score: number | null
          canonical_actual_direction: string | null
          canonical_candle_row_id: string | null
          canonical_close: number | null
          canonical_ground_truth_valid: boolean | null
          canonical_high: number | null
          canonical_low: number | null
          canonical_open: number | null
          canonical_volume: number | null
          consensus_red_shadow_adjusted_score: number | null
          consensus_red_shadow_prediction: string | null
          consensus_red_shadow_raw_score: number | null
          consensus_red_shadow_result: string | null
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
          final_reason: string | null
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
          legacy_pickup_publication_enabled: boolean | null
          legacy_r4_shadow_adjusted_score: number | null
          legacy_r4_shadow_prediction: string | null
          legacy_r4_shadow_raw_score: number | null
          legacy_r4_shadow_reason: string | null
          legacy_r4_shadow_result: string | null
          legacy_r4_shadow_source: string | null
          lower_wick_pct: number | null
          model_artifact_sha256: string | null
          model_revision: string | null
          model_revision_activated_at: string | null
          model_version: string
          momentum_green_shadow_adjusted_score: number | null
          momentum_green_shadow_prediction: string | null
          momentum_green_shadow_raw_score: number | null
          momentum_green_shadow_result: string | null
          operational_error: string | null
          operational_status: string
          original_v6_base_prediction: string | null
          original_v6_base_source: string | null
          original_v6_shadow_adjusted_score: number | null
          original_v6_shadow_raw_score: number | null
          path_efficiency_4: number | null
          pickup_conflict: boolean
          pre_inverter_adjusted_score: number | null
          pre_inverter_prediction: string | null
          pre_inverter_prediction_source: string | null
          pre_inverter_raw_score: number | null
          pre_structure_prediction: string | null
          pre_structure_source: string | null
          pre_weak_red_veto_adjusted_score: number | null
          pre_weak_red_veto_prediction: string | null
          pre_weak_red_veto_raw_score: number | null
          prediction_after_broad_conflict_veto: string | null
          prediction_after_broad_red_reliability: string | null
          prediction_after_structure_confirmation: string | null
          prediction_after_weak_red_recovery: string | null
          prediction_created_at: string
          prediction_created_before_target: boolean
          prediction_id: string
          prediction_source: string | null
          prediction_source_after_broad_conflict_veto: string | null
          prediction_source_after_broad_red_reliability: string | null
          prediction_source_after_structure_confirmation: string | null
          prediction_source_after_weak_red_recovery: string | null
          prior_candle_ids_json: Json | null
          provider: string
          r5_aligned_wick_red_shadow_adjusted_score: number | null
          r5_aligned_wick_red_shadow_candidate: boolean | null
          r5_aligned_wick_red_shadow_evaluable: boolean | null
          r5_aligned_wick_red_shadow_raw_score: number | null
          r5_aligned_wick_red_shadow_result: string | null
          r5_aligned_wick_red_shadow_threshold: number | null
          r5_aligned_wick_red_shadow_value: number | null
          r5_anchor_red_route_brake_evaluable: boolean | null
          r5_anchor_red_route_brake_reason: string | null
          r5_anchor_red_route_brake_triggered: boolean | null
          r5_anchor_red_route_consecutive_shadow_losses: number | null
          r5_anchor_red_route_pause_active: boolean | null
          r5_anchor_red_route_pause_after_resolution: boolean | null
          r5_anchor_red_route_pause_before_resolution: boolean | null
          r5_anchor_red_route_shadow_eligible: boolean | null
          r5_anchor_red_route_shadow_result: string | null
          r5_anchor_red_route_shadow_streak_after: number | null
          r5_anchor_red_route_shadow_streak_before: number | null
          r5_conflict: boolean | null
          r5_conflict_green_result: string | null
          r5_conflict_red_result: string | null
          r5_final_adjusted_score: number | null
          r5_final_raw_score: number | null
          r5_final_result: string | null
          r5_green_body_condition: boolean | null
          r5_green_candidate: boolean | null
          r5_green_d1_mean_body_to_range_2: number | null
          r5_green_d1_mean_body_to_range_2_threshold: number | null
          r5_green_evaluable: boolean | null
          r5_green_route_brake_evaluable: boolean | null
          r5_green_route_brake_reason: string | null
          r5_green_route_brake_triggered: boolean | null
          r5_green_route_consecutive_shadow_losses: number | null
          r5_green_route_pause_active: boolean | null
          r5_green_route_pause_after_resolution: boolean | null
          r5_green_route_pause_before_resolution: boolean | null
          r5_green_route_shadow_eligible: boolean | null
          r5_green_route_shadow_result: string | null
          r5_green_route_shadow_streak_after: number | null
          r5_green_route_shadow_streak_before: number | null
          r5_green_shadow_adjusted_score: number | null
          r5_green_shadow_prediction: string | null
          r5_green_shadow_raw_score: number | null
          r5_green_shadow_result: string | null
          r5_green_stoch_condition: boolean | null
          r5_green_stoch_spread: number | null
          r5_green_stoch_spread_threshold: number | null
          r5_pre_brake_prediction: string | null
          r5_pre_brake_reason: string | null
          r5_pre_brake_source: string | null
          r5_red_anchor_candidate: boolean | null
          r5_red_anchor_condition: boolean | null
          r5_red_anchor_d1_close_position: number | null
          r5_red_anchor_d1_close_position_threshold: number | null
          r5_red_anchor_evaluable: boolean | null
          r5_red_anchor_shadow_adjusted_score: number | null
          r5_red_anchor_shadow_prediction: string | null
          r5_red_anchor_shadow_raw_score: number | null
          r5_red_anchor_shadow_result: string | null
          r5_red_broad_bb_condition: boolean | null
          r5_red_broad_bb_width_pct: number | null
          r5_red_broad_bb_width_threshold: number | null
          r5_red_broad_candidate: boolean | null
          r5_red_broad_close_slope_8: number | null
          r5_red_broad_close_slope_threshold: number | null
          r5_red_broad_evaluable: boolean | null
          r5_red_broad_shadow_adjusted_score: number | null
          r5_red_broad_shadow_prediction: string | null
          r5_red_broad_shadow_raw_score: number | null
          r5_red_broad_shadow_result: string | null
          r5_red_broad_slope_condition: boolean | null
          r5_red_candidate: boolean | null
          r5_red_feeder_evaluable: boolean | null
          r5_red_feeder_pass: boolean | null
          r5_red_feeder_prediction: string | null
          r5_red_feeder_source: string | null
          r5_route_brake_activated_at: string | null
          r5_route_brake_adjusted_contribution: number | null
          r5_route_brake_pause_loss_threshold: number | null
          r5_route_brake_publication_enabled: boolean | null
          r5_route_brake_raw_contribution: number | null
          r5_route_brake_reason: string | null
          r5_route_brake_resume_win_threshold: number | null
          r5_route_brake_revision: string | null
          r5_route_brake_route_key: string | null
          r5_route_brake_shadow_adjusted_score: number | null
          r5_route_brake_shadow_only: boolean | null
          r5_route_brake_shadow_prediction: string | null
          r5_route_brake_shadow_raw_score: number | null
          r5_route_brake_shadow_reason: string | null
          r5_route_brake_shadow_result: string | null
          r5_route_brake_state_rebuilt: boolean | null
          r5_route_brake_triggered: boolean | null
          r5_route_brake_underlying_actual: string | null
          r5_route_brake_underlying_adjusted_score: number | null
          r5_route_brake_underlying_prediction: string | null
          r5_route_brake_underlying_raw_score: number | null
          r5_route_brake_underlying_result: string | null
          r5_router_decision: string | null
          r5_router_reason: string | null
          r5_router_source: string | null
          r5_router_version: string | null
          r6_base_prediction: string | null
          r6_base_r5_adjusted_score: number | null
          r6_base_r5_raw_score: number | null
          r6_base_r5_result: string | null
          r6_base_reason: string | null
          r6_base_source: string | null
          r6_conflict_green_result: string | null
          r6_conflict_red_result: string | null
          r6_final_adjusted_score: number | null
          r6_final_prediction: string | null
          r6_final_raw_score: number | null
          r6_final_reason: string | null
          r6_final_result: string | null
          r6_final_source: string | null
          r6_green_promotion_candidate: boolean | null
          r6_green_promotion_rule_count: number | null
          r6_green_promotion_rules_triggered: Json | null
          r6_green_promotion_shadow_adjusted_score: number | null
          r6_green_promotion_shadow_raw_score: number | null
          r6_green_promotion_shadow_result: string | null
          r6_p1_condition_a: boolean | null
          r6_p1_condition_b: boolean | null
          r6_p1_evaluable: boolean | null
          r6_p1_green_candidate: boolean | null
          r6_p1_momentum_8_over_atr: number | null
          r6_p1_momentum_threshold: number | null
          r6_p1_path_efficiency_4: number | null
          r6_p1_path_efficiency_threshold: number | null
          r6_p1_shadow_adjusted_score: number | null
          r6_p1_shadow_raw_score: number | null
          r6_p1_shadow_result: string | null
          r6_p2_condition_a: boolean | null
          r6_p2_condition_b: boolean | null
          r6_p2_evaluable: boolean | null
          r6_p2_red_candidate: boolean | null
          r6_p2_roc_8: number | null
          r6_p2_roc_threshold: number | null
          r6_p2_shadow_adjusted_score: number | null
          r6_p2_shadow_raw_score: number | null
          r6_p2_shadow_result: string | null
          r6_p2_volume_expansion: number | null
          r6_p2_volume_expansion_threshold: number | null
          r6_p3_change_pct: number | null
          r6_p3_change_pct_threshold: number | null
          r6_p3_channel_position_0_1: number | null
          r6_p3_channel_position_threshold: number | null
          r6_p3_condition_a: boolean | null
          r6_p3_condition_b: boolean | null
          r6_p3_evaluable: boolean | null
          r6_p3_green_candidate: boolean | null
          r6_p3_shadow_adjusted_score: number | null
          r6_p3_shadow_raw_score: number | null
          r6_p3_shadow_result: string | null
          r6_p4_condition_a: boolean | null
          r6_p4_condition_b: boolean | null
          r6_p4_evaluable: boolean | null
          r6_p4_macd_hist_over_atr14: number | null
          r6_p4_macd_threshold: number | null
          r6_p4_mean_body_threshold: number | null
          r6_p4_mean_body_to_range_2: number | null
          r6_p4_red_candidate: boolean | null
          r6_p4_shadow_adjusted_score: number | null
          r6_p4_shadow_raw_score: number | null
          r6_p4_shadow_result: string | null
          r6_p5_change_pct: number | null
          r6_p5_change_pct_threshold: number | null
          r6_p5_condition_a: boolean | null
          r6_p5_condition_b: boolean | null
          r6_p5_dist_low20_threshold: number | null
          r6_p5_dist_to_low20_pct: number | null
          r6_p5_evaluable: boolean | null
          r6_p5_green_candidate: boolean | null
          r6_p5_shadow_adjusted_score: number | null
          r6_p5_shadow_raw_score: number | null
          r6_p5_shadow_result: string | null
          r6_p6_condition_a: boolean | null
          r6_p6_condition_b: boolean | null
          r6_p6_evaluable: boolean | null
          r6_p6_green_candidate: boolean | null
          r6_p6_mean_body_threshold: number | null
          r6_p6_mean_body_to_range_2: number | null
          r6_p6_path_efficiency_4: number | null
          r6_p6_path_efficiency_threshold: number | null
          r6_p6_shadow_adjusted_score: number | null
          r6_p6_shadow_raw_score: number | null
          r6_p6_shadow_result: string | null
          r6_promotion_adjusted_contribution: number | null
          r6_promotion_all_rules: Json | null
          r6_promotion_conflict: boolean | null
          r6_promotion_final_prediction: string | null
          r6_promotion_primary_rule: string | null
          r6_promotion_raw_contribution: number | null
          r6_promotion_result: string | null
          r6_promotion_underlying_r5_prediction: string | null
          r6_red_promotion_candidate: boolean | null
          r6_red_promotion_rule_count: number | null
          r6_red_promotion_rules_triggered: Json | null
          r6_red_promotion_shadow_adjusted_score: number | null
          r6_red_promotion_shadow_raw_score: number | null
          r6_red_promotion_shadow_result: string | null
          r6_router_version: string | null
          r7_action_vs_r6: string | null
          r7_activated_at: string | null
          r7_anchor_bin: number | null
          r7_best_green_edge_rate: number | null
          r7_best_green_expert: string | null
          r7_best_green_samples: number | null
          r7_best_red_edge_rate: number | null
          r7_best_red_expert: string | null
          r7_best_red_samples: number | null
          r7_broad_bin: number | null
          r7_e1_candidate: string | null
          r7_e1_qualified: boolean | null
          r7_e1_shadow_raw_score: number | null
          r7_e1_shadow_result: string | null
          r7_e1_state_edge_rate: number | null
          r7_e1_state_losses: number | null
          r7_e1_state_raw_net: number | null
          r7_e1_state_samples: number | null
          r7_e1_state_win_rate: number | null
          r7_e1_state_wins: number | null
          r7_e2_candidate: string | null
          r7_e2_qualified: boolean | null
          r7_e2_shadow_raw_score: number | null
          r7_e2_shadow_result: string | null
          r7_e2_state_edge_rate: number | null
          r7_e2_state_losses: number | null
          r7_e2_state_raw_net: number | null
          r7_e2_state_samples: number | null
          r7_e2_state_win_rate: number | null
          r7_e2_state_wins: number | null
          r7_e3_candidate: string | null
          r7_e3_qualified: boolean | null
          r7_e3_shadow_raw_score: number | null
          r7_e3_shadow_result: string | null
          r7_e3_state_edge_rate: number | null
          r7_e3_state_losses: number | null
          r7_e3_state_raw_net: number | null
          r7_e3_state_samples: number | null
          r7_e3_state_win_rate: number | null
          r7_e3_state_wins: number | null
          r7_e4_candidate: string | null
          r7_e4_qualified: boolean | null
          r7_e4_shadow_raw_score: number | null
          r7_e4_shadow_result: string | null
          r7_e4_state_edge_rate: number | null
          r7_e4_state_losses: number | null
          r7_e4_state_raw_net: number | null
          r7_e4_state_samples: number | null
          r7_e4_state_win_rate: number | null
          r7_e4_state_wins: number | null
          r7_history_error: string | null
          r7_history_ready: boolean | null
          r7_history_window: number | null
          r7_model_revision: string | null
          r7_prior_valid_opportunity_count: number | null
          r7_publication_enabled: boolean | null
          r7_r6_reference_prediction: string | null
          r7_raw_contribution_vs_r6: number | null
          r7_selected_expert: string | null
          r7_shadow_enabled: boolean | null
          r7_shadow_prediction: string | null
          r7_shadow_raw_score: number | null
          r7_shadow_reason: string | null
          r7_shadow_result: string | null
          r7_state_evaluable: boolean | null
          r7_state_green_count: number | null
          r7_state_green_win_rate: number | null
          r7_state_id: string | null
          r7_state_red_count: number | null
          r7_state_red_win_rate: number | null
          r7_state_sample_count: number | null
          r7_version: string | null
          range_expansion_vs_avg20: number | null
          red_pickup_adjusted_contribution: number | null
          red_pickup_evaluable: boolean
          red_pickup_raw_contribution: number | null
          red_pickup_triggered: boolean
          red_threshold: number | null
          regime_inverter_activation_threshold: number | null
          regime_inverter_active: boolean | null
          regime_inverter_adjusted_contribution: number | null
          regime_inverter_counterfactual_adjusted_contribution: number | null
          regime_inverter_counterfactual_raw_contribution: number | null
          regime_inverter_evaluable: boolean | null
          regime_inverter_history_count: number | null
          regime_inverter_history_json: Json | null
          regime_inverter_last20_adjusted_net: number | null
          regime_inverter_last20_losses: number | null
          regime_inverter_last20_wins: number | null
          regime_inverter_original_prediction: string | null
          regime_inverter_publication_enabled: boolean | null
          regime_inverter_raw_contribution: number | null
          regime_inverter_ready: boolean | null
          regime_inverter_reason: string | null
          regime_inverter_replacement_prediction: string | null
          regime_inverter_shadow_adjusted_score: number | null
          regime_inverter_shadow_only: boolean | null
          regime_inverter_shadow_raw_score: number | null
          regime_inverter_triggered: boolean | null
          regime_inverter_would_publish: string | null
          regime_inverter_would_trigger: boolean | null
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
          selected_component: string | null
          structure_confirmation_adjusted_contribution: number | null
          structure_confirmation_evaluable: boolean | null
          structure_confirmation_pass: boolean | null
          structure_confirmation_publication_enabled: boolean | null
          structure_confirmation_raw_contribution: number | null
          structure_confirmation_reason: string | null
          structure_confirmation_shadow_only: boolean | null
          structure_confirmation_triggered: boolean | null
          structure_expansion_efficiency_threshold: number | null
          structure_expansion_efficiency_value: number | null
          structure_expansion_evaluable: boolean | null
          structure_expansion_pass: boolean | null
          structure_expansion_range_threshold: number | null
          structure_expansion_range_value: number | null
          structure_rejection_aligned_wick_threshold: number | null
          structure_rejection_aligned_wick_value: number | null
          structure_rejection_evaluable: boolean | null
          structure_rejection_lower_wick_threshold: number | null
          structure_rejection_lower_wick_value: number | null
          structure_rejection_pass: boolean | null
          structure_underlying_actual_direction: string | null
          structure_underlying_adjusted_score: number | null
          structure_underlying_prediction: string | null
          structure_underlying_raw_score: number | null
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
          webhook_conflict_with_b4x4: boolean | null
          webhook_eligible: boolean | null
          webhook_sent_at: string | null
          webhook_suppressed_reason: string | null
        }
        Insert: {
          abstain_reason?: string | null
          abstain_status?: string | null
          aligned_wick_pressure_4?: number | null
          anchor_distance_from_neutral?: number | null
          anchor_percentile?: number | null
          anchor_score?: number | null
          b4x4_direction_at_send?: string | null
          base_green_count_last8?: number | null
          base_predictions_last8_json?: Json | null
          base_v6_adjusted_score?: number | null
          base_v6_prediction?: string | null
          base_v6_raw_score?: number | null
          broad_conflict_anchor_direction?: string | null
          broad_conflict_anchor_distance?: number | null
          broad_conflict_anchor_percentile?: number | null
          broad_conflict_max_distance?: number | null
          broad_conflict_min_distance?: number | null
          broad_conflict_original_prediction?: string | null
          broad_conflict_original_source?: string | null
          broad_conflict_publication_enabled?: boolean | null
          broad_conflict_underlying_adjusted_score?: number | null
          broad_conflict_underlying_prediction?: string | null
          broad_conflict_underlying_raw_score?: number | null
          broad_conflict_veto_adjusted_contribution?: number | null
          broad_conflict_veto_evaluable?: boolean | null
          broad_conflict_veto_raw_contribution?: number | null
          broad_conflict_veto_reason?: string | null
          broad_conflict_veto_triggered?: boolean | null
          broad_distance_from_neutral?: number | null
          broad_percentile?: number | null
          broad_red_history_count?: number | null
          broad_red_history_json?: Json | null
          broad_red_last12_adjusted_net?: number | null
          broad_red_last12_losses?: number | null
          broad_red_last12_wins?: number | null
          broad_red_reliability_adjusted_contribution?: number | null
          broad_red_reliability_evaluable?: boolean | null
          broad_red_reliability_publication_enabled?: boolean | null
          broad_red_reliability_raw_contribution?: number | null
          broad_red_reliability_ready?: boolean | null
          broad_red_reliability_reason?: string | null
          broad_red_reliability_threshold?: number | null
          broad_red_reliability_veto_active?: boolean | null
          broad_red_reliability_veto_triggered?: boolean | null
          broad_red_shadow_adjusted_score?: number | null
          broad_red_shadow_prediction?: string | null
          broad_red_underlying_adjusted_score?: number | null
          broad_red_underlying_prediction?: string | null
          broad_red_underlying_raw_score?: number | null
          broad_score?: number | null
          canonical_actual_direction?: string | null
          canonical_candle_row_id?: string | null
          canonical_close?: number | null
          canonical_ground_truth_valid?: boolean | null
          canonical_high?: number | null
          canonical_low?: number | null
          canonical_open?: number | null
          canonical_volume?: number | null
          consensus_red_shadow_adjusted_score?: number | null
          consensus_red_shadow_prediction?: string | null
          consensus_red_shadow_raw_score?: number | null
          consensus_red_shadow_result?: string | null
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
          final_reason?: string | null
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
          legacy_pickup_publication_enabled?: boolean | null
          legacy_r4_shadow_adjusted_score?: number | null
          legacy_r4_shadow_prediction?: string | null
          legacy_r4_shadow_raw_score?: number | null
          legacy_r4_shadow_reason?: string | null
          legacy_r4_shadow_result?: string | null
          legacy_r4_shadow_source?: string | null
          lower_wick_pct?: number | null
          model_artifact_sha256?: string | null
          model_revision?: string | null
          model_revision_activated_at?: string | null
          model_version?: string
          momentum_green_shadow_adjusted_score?: number | null
          momentum_green_shadow_prediction?: string | null
          momentum_green_shadow_raw_score?: number | null
          momentum_green_shadow_result?: string | null
          operational_error?: string | null
          operational_status?: string
          original_v6_base_prediction?: string | null
          original_v6_base_source?: string | null
          original_v6_shadow_adjusted_score?: number | null
          original_v6_shadow_raw_score?: number | null
          path_efficiency_4?: number | null
          pickup_conflict?: boolean
          pre_inverter_adjusted_score?: number | null
          pre_inverter_prediction?: string | null
          pre_inverter_prediction_source?: string | null
          pre_inverter_raw_score?: number | null
          pre_structure_prediction?: string | null
          pre_structure_source?: string | null
          pre_weak_red_veto_adjusted_score?: number | null
          pre_weak_red_veto_prediction?: string | null
          pre_weak_red_veto_raw_score?: number | null
          prediction_after_broad_conflict_veto?: string | null
          prediction_after_broad_red_reliability?: string | null
          prediction_after_structure_confirmation?: string | null
          prediction_after_weak_red_recovery?: string | null
          prediction_created_at?: string
          prediction_created_before_target?: boolean
          prediction_id?: string
          prediction_source?: string | null
          prediction_source_after_broad_conflict_veto?: string | null
          prediction_source_after_broad_red_reliability?: string | null
          prediction_source_after_structure_confirmation?: string | null
          prediction_source_after_weak_red_recovery?: string | null
          prior_candle_ids_json?: Json | null
          provider?: string
          r5_aligned_wick_red_shadow_adjusted_score?: number | null
          r5_aligned_wick_red_shadow_candidate?: boolean | null
          r5_aligned_wick_red_shadow_evaluable?: boolean | null
          r5_aligned_wick_red_shadow_raw_score?: number | null
          r5_aligned_wick_red_shadow_result?: string | null
          r5_aligned_wick_red_shadow_threshold?: number | null
          r5_aligned_wick_red_shadow_value?: number | null
          r5_anchor_red_route_brake_evaluable?: boolean | null
          r5_anchor_red_route_brake_reason?: string | null
          r5_anchor_red_route_brake_triggered?: boolean | null
          r5_anchor_red_route_consecutive_shadow_losses?: number | null
          r5_anchor_red_route_pause_active?: boolean | null
          r5_anchor_red_route_pause_after_resolution?: boolean | null
          r5_anchor_red_route_pause_before_resolution?: boolean | null
          r5_anchor_red_route_shadow_eligible?: boolean | null
          r5_anchor_red_route_shadow_result?: string | null
          r5_anchor_red_route_shadow_streak_after?: number | null
          r5_anchor_red_route_shadow_streak_before?: number | null
          r5_conflict?: boolean | null
          r5_conflict_green_result?: string | null
          r5_conflict_red_result?: string | null
          r5_final_adjusted_score?: number | null
          r5_final_raw_score?: number | null
          r5_final_result?: string | null
          r5_green_body_condition?: boolean | null
          r5_green_candidate?: boolean | null
          r5_green_d1_mean_body_to_range_2?: number | null
          r5_green_d1_mean_body_to_range_2_threshold?: number | null
          r5_green_evaluable?: boolean | null
          r5_green_route_brake_evaluable?: boolean | null
          r5_green_route_brake_reason?: string | null
          r5_green_route_brake_triggered?: boolean | null
          r5_green_route_consecutive_shadow_losses?: number | null
          r5_green_route_pause_active?: boolean | null
          r5_green_route_pause_after_resolution?: boolean | null
          r5_green_route_pause_before_resolution?: boolean | null
          r5_green_route_shadow_eligible?: boolean | null
          r5_green_route_shadow_result?: string | null
          r5_green_route_shadow_streak_after?: number | null
          r5_green_route_shadow_streak_before?: number | null
          r5_green_shadow_adjusted_score?: number | null
          r5_green_shadow_prediction?: string | null
          r5_green_shadow_raw_score?: number | null
          r5_green_shadow_result?: string | null
          r5_green_stoch_condition?: boolean | null
          r5_green_stoch_spread?: number | null
          r5_green_stoch_spread_threshold?: number | null
          r5_pre_brake_prediction?: string | null
          r5_pre_brake_reason?: string | null
          r5_pre_brake_source?: string | null
          r5_red_anchor_candidate?: boolean | null
          r5_red_anchor_condition?: boolean | null
          r5_red_anchor_d1_close_position?: number | null
          r5_red_anchor_d1_close_position_threshold?: number | null
          r5_red_anchor_evaluable?: boolean | null
          r5_red_anchor_shadow_adjusted_score?: number | null
          r5_red_anchor_shadow_prediction?: string | null
          r5_red_anchor_shadow_raw_score?: number | null
          r5_red_anchor_shadow_result?: string | null
          r5_red_broad_bb_condition?: boolean | null
          r5_red_broad_bb_width_pct?: number | null
          r5_red_broad_bb_width_threshold?: number | null
          r5_red_broad_candidate?: boolean | null
          r5_red_broad_close_slope_8?: number | null
          r5_red_broad_close_slope_threshold?: number | null
          r5_red_broad_evaluable?: boolean | null
          r5_red_broad_shadow_adjusted_score?: number | null
          r5_red_broad_shadow_prediction?: string | null
          r5_red_broad_shadow_raw_score?: number | null
          r5_red_broad_shadow_result?: string | null
          r5_red_broad_slope_condition?: boolean | null
          r5_red_candidate?: boolean | null
          r5_red_feeder_evaluable?: boolean | null
          r5_red_feeder_pass?: boolean | null
          r5_red_feeder_prediction?: string | null
          r5_red_feeder_source?: string | null
          r5_route_brake_activated_at?: string | null
          r5_route_brake_adjusted_contribution?: number | null
          r5_route_brake_pause_loss_threshold?: number | null
          r5_route_brake_publication_enabled?: boolean | null
          r5_route_brake_raw_contribution?: number | null
          r5_route_brake_reason?: string | null
          r5_route_brake_resume_win_threshold?: number | null
          r5_route_brake_revision?: string | null
          r5_route_brake_route_key?: string | null
          r5_route_brake_shadow_adjusted_score?: number | null
          r5_route_brake_shadow_only?: boolean | null
          r5_route_brake_shadow_prediction?: string | null
          r5_route_brake_shadow_raw_score?: number | null
          r5_route_brake_shadow_reason?: string | null
          r5_route_brake_shadow_result?: string | null
          r5_route_brake_state_rebuilt?: boolean | null
          r5_route_brake_triggered?: boolean | null
          r5_route_brake_underlying_actual?: string | null
          r5_route_brake_underlying_adjusted_score?: number | null
          r5_route_brake_underlying_prediction?: string | null
          r5_route_brake_underlying_raw_score?: number | null
          r5_route_brake_underlying_result?: string | null
          r5_router_decision?: string | null
          r5_router_reason?: string | null
          r5_router_source?: string | null
          r5_router_version?: string | null
          r6_base_prediction?: string | null
          r6_base_r5_adjusted_score?: number | null
          r6_base_r5_raw_score?: number | null
          r6_base_r5_result?: string | null
          r6_base_reason?: string | null
          r6_base_source?: string | null
          r6_conflict_green_result?: string | null
          r6_conflict_red_result?: string | null
          r6_final_adjusted_score?: number | null
          r6_final_prediction?: string | null
          r6_final_raw_score?: number | null
          r6_final_reason?: string | null
          r6_final_result?: string | null
          r6_final_source?: string | null
          r6_green_promotion_candidate?: boolean | null
          r6_green_promotion_rule_count?: number | null
          r6_green_promotion_rules_triggered?: Json | null
          r6_green_promotion_shadow_adjusted_score?: number | null
          r6_green_promotion_shadow_raw_score?: number | null
          r6_green_promotion_shadow_result?: string | null
          r6_p1_condition_a?: boolean | null
          r6_p1_condition_b?: boolean | null
          r6_p1_evaluable?: boolean | null
          r6_p1_green_candidate?: boolean | null
          r6_p1_momentum_8_over_atr?: number | null
          r6_p1_momentum_threshold?: number | null
          r6_p1_path_efficiency_4?: number | null
          r6_p1_path_efficiency_threshold?: number | null
          r6_p1_shadow_adjusted_score?: number | null
          r6_p1_shadow_raw_score?: number | null
          r6_p1_shadow_result?: string | null
          r6_p2_condition_a?: boolean | null
          r6_p2_condition_b?: boolean | null
          r6_p2_evaluable?: boolean | null
          r6_p2_red_candidate?: boolean | null
          r6_p2_roc_8?: number | null
          r6_p2_roc_threshold?: number | null
          r6_p2_shadow_adjusted_score?: number | null
          r6_p2_shadow_raw_score?: number | null
          r6_p2_shadow_result?: string | null
          r6_p2_volume_expansion?: number | null
          r6_p2_volume_expansion_threshold?: number | null
          r6_p3_change_pct?: number | null
          r6_p3_change_pct_threshold?: number | null
          r6_p3_channel_position_0_1?: number | null
          r6_p3_channel_position_threshold?: number | null
          r6_p3_condition_a?: boolean | null
          r6_p3_condition_b?: boolean | null
          r6_p3_evaluable?: boolean | null
          r6_p3_green_candidate?: boolean | null
          r6_p3_shadow_adjusted_score?: number | null
          r6_p3_shadow_raw_score?: number | null
          r6_p3_shadow_result?: string | null
          r6_p4_condition_a?: boolean | null
          r6_p4_condition_b?: boolean | null
          r6_p4_evaluable?: boolean | null
          r6_p4_macd_hist_over_atr14?: number | null
          r6_p4_macd_threshold?: number | null
          r6_p4_mean_body_threshold?: number | null
          r6_p4_mean_body_to_range_2?: number | null
          r6_p4_red_candidate?: boolean | null
          r6_p4_shadow_adjusted_score?: number | null
          r6_p4_shadow_raw_score?: number | null
          r6_p4_shadow_result?: string | null
          r6_p5_change_pct?: number | null
          r6_p5_change_pct_threshold?: number | null
          r6_p5_condition_a?: boolean | null
          r6_p5_condition_b?: boolean | null
          r6_p5_dist_low20_threshold?: number | null
          r6_p5_dist_to_low20_pct?: number | null
          r6_p5_evaluable?: boolean | null
          r6_p5_green_candidate?: boolean | null
          r6_p5_shadow_adjusted_score?: number | null
          r6_p5_shadow_raw_score?: number | null
          r6_p5_shadow_result?: string | null
          r6_p6_condition_a?: boolean | null
          r6_p6_condition_b?: boolean | null
          r6_p6_evaluable?: boolean | null
          r6_p6_green_candidate?: boolean | null
          r6_p6_mean_body_threshold?: number | null
          r6_p6_mean_body_to_range_2?: number | null
          r6_p6_path_efficiency_4?: number | null
          r6_p6_path_efficiency_threshold?: number | null
          r6_p6_shadow_adjusted_score?: number | null
          r6_p6_shadow_raw_score?: number | null
          r6_p6_shadow_result?: string | null
          r6_promotion_adjusted_contribution?: number | null
          r6_promotion_all_rules?: Json | null
          r6_promotion_conflict?: boolean | null
          r6_promotion_final_prediction?: string | null
          r6_promotion_primary_rule?: string | null
          r6_promotion_raw_contribution?: number | null
          r6_promotion_result?: string | null
          r6_promotion_underlying_r5_prediction?: string | null
          r6_red_promotion_candidate?: boolean | null
          r6_red_promotion_rule_count?: number | null
          r6_red_promotion_rules_triggered?: Json | null
          r6_red_promotion_shadow_adjusted_score?: number | null
          r6_red_promotion_shadow_raw_score?: number | null
          r6_red_promotion_shadow_result?: string | null
          r6_router_version?: string | null
          r7_action_vs_r6?: string | null
          r7_activated_at?: string | null
          r7_anchor_bin?: number | null
          r7_best_green_edge_rate?: number | null
          r7_best_green_expert?: string | null
          r7_best_green_samples?: number | null
          r7_best_red_edge_rate?: number | null
          r7_best_red_expert?: string | null
          r7_best_red_samples?: number | null
          r7_broad_bin?: number | null
          r7_e1_candidate?: string | null
          r7_e1_qualified?: boolean | null
          r7_e1_shadow_raw_score?: number | null
          r7_e1_shadow_result?: string | null
          r7_e1_state_edge_rate?: number | null
          r7_e1_state_losses?: number | null
          r7_e1_state_raw_net?: number | null
          r7_e1_state_samples?: number | null
          r7_e1_state_win_rate?: number | null
          r7_e1_state_wins?: number | null
          r7_e2_candidate?: string | null
          r7_e2_qualified?: boolean | null
          r7_e2_shadow_raw_score?: number | null
          r7_e2_shadow_result?: string | null
          r7_e2_state_edge_rate?: number | null
          r7_e2_state_losses?: number | null
          r7_e2_state_raw_net?: number | null
          r7_e2_state_samples?: number | null
          r7_e2_state_win_rate?: number | null
          r7_e2_state_wins?: number | null
          r7_e3_candidate?: string | null
          r7_e3_qualified?: boolean | null
          r7_e3_shadow_raw_score?: number | null
          r7_e3_shadow_result?: string | null
          r7_e3_state_edge_rate?: number | null
          r7_e3_state_losses?: number | null
          r7_e3_state_raw_net?: number | null
          r7_e3_state_samples?: number | null
          r7_e3_state_win_rate?: number | null
          r7_e3_state_wins?: number | null
          r7_e4_candidate?: string | null
          r7_e4_qualified?: boolean | null
          r7_e4_shadow_raw_score?: number | null
          r7_e4_shadow_result?: string | null
          r7_e4_state_edge_rate?: number | null
          r7_e4_state_losses?: number | null
          r7_e4_state_raw_net?: number | null
          r7_e4_state_samples?: number | null
          r7_e4_state_win_rate?: number | null
          r7_e4_state_wins?: number | null
          r7_history_error?: string | null
          r7_history_ready?: boolean | null
          r7_history_window?: number | null
          r7_model_revision?: string | null
          r7_prior_valid_opportunity_count?: number | null
          r7_publication_enabled?: boolean | null
          r7_r6_reference_prediction?: string | null
          r7_raw_contribution_vs_r6?: number | null
          r7_selected_expert?: string | null
          r7_shadow_enabled?: boolean | null
          r7_shadow_prediction?: string | null
          r7_shadow_raw_score?: number | null
          r7_shadow_reason?: string | null
          r7_shadow_result?: string | null
          r7_state_evaluable?: boolean | null
          r7_state_green_count?: number | null
          r7_state_green_win_rate?: number | null
          r7_state_id?: string | null
          r7_state_red_count?: number | null
          r7_state_red_win_rate?: number | null
          r7_state_sample_count?: number | null
          r7_version?: string | null
          range_expansion_vs_avg20?: number | null
          red_pickup_adjusted_contribution?: number | null
          red_pickup_evaluable?: boolean
          red_pickup_raw_contribution?: number | null
          red_pickup_triggered?: boolean
          red_threshold?: number | null
          regime_inverter_activation_threshold?: number | null
          regime_inverter_active?: boolean | null
          regime_inverter_adjusted_contribution?: number | null
          regime_inverter_counterfactual_adjusted_contribution?: number | null
          regime_inverter_counterfactual_raw_contribution?: number | null
          regime_inverter_evaluable?: boolean | null
          regime_inverter_history_count?: number | null
          regime_inverter_history_json?: Json | null
          regime_inverter_last20_adjusted_net?: number | null
          regime_inverter_last20_losses?: number | null
          regime_inverter_last20_wins?: number | null
          regime_inverter_original_prediction?: string | null
          regime_inverter_publication_enabled?: boolean | null
          regime_inverter_raw_contribution?: number | null
          regime_inverter_ready?: boolean | null
          regime_inverter_reason?: string | null
          regime_inverter_replacement_prediction?: string | null
          regime_inverter_shadow_adjusted_score?: number | null
          regime_inverter_shadow_only?: boolean | null
          regime_inverter_shadow_raw_score?: number | null
          regime_inverter_triggered?: boolean | null
          regime_inverter_would_publish?: string | null
          regime_inverter_would_trigger?: boolean | null
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
          selected_component?: string | null
          structure_confirmation_adjusted_contribution?: number | null
          structure_confirmation_evaluable?: boolean | null
          structure_confirmation_pass?: boolean | null
          structure_confirmation_publication_enabled?: boolean | null
          structure_confirmation_raw_contribution?: number | null
          structure_confirmation_reason?: string | null
          structure_confirmation_shadow_only?: boolean | null
          structure_confirmation_triggered?: boolean | null
          structure_expansion_efficiency_threshold?: number | null
          structure_expansion_efficiency_value?: number | null
          structure_expansion_evaluable?: boolean | null
          structure_expansion_pass?: boolean | null
          structure_expansion_range_threshold?: number | null
          structure_expansion_range_value?: number | null
          structure_rejection_aligned_wick_threshold?: number | null
          structure_rejection_aligned_wick_value?: number | null
          structure_rejection_evaluable?: boolean | null
          structure_rejection_lower_wick_threshold?: number | null
          structure_rejection_lower_wick_value?: number | null
          structure_rejection_pass?: boolean | null
          structure_underlying_actual_direction?: string | null
          structure_underlying_adjusted_score?: number | null
          structure_underlying_prediction?: string | null
          structure_underlying_raw_score?: number | null
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
          webhook_conflict_with_b4x4?: boolean | null
          webhook_eligible?: boolean | null
          webhook_sent_at?: string | null
          webhook_suppressed_reason?: string | null
        }
        Update: {
          abstain_reason?: string | null
          abstain_status?: string | null
          aligned_wick_pressure_4?: number | null
          anchor_distance_from_neutral?: number | null
          anchor_percentile?: number | null
          anchor_score?: number | null
          b4x4_direction_at_send?: string | null
          base_green_count_last8?: number | null
          base_predictions_last8_json?: Json | null
          base_v6_adjusted_score?: number | null
          base_v6_prediction?: string | null
          base_v6_raw_score?: number | null
          broad_conflict_anchor_direction?: string | null
          broad_conflict_anchor_distance?: number | null
          broad_conflict_anchor_percentile?: number | null
          broad_conflict_max_distance?: number | null
          broad_conflict_min_distance?: number | null
          broad_conflict_original_prediction?: string | null
          broad_conflict_original_source?: string | null
          broad_conflict_publication_enabled?: boolean | null
          broad_conflict_underlying_adjusted_score?: number | null
          broad_conflict_underlying_prediction?: string | null
          broad_conflict_underlying_raw_score?: number | null
          broad_conflict_veto_adjusted_contribution?: number | null
          broad_conflict_veto_evaluable?: boolean | null
          broad_conflict_veto_raw_contribution?: number | null
          broad_conflict_veto_reason?: string | null
          broad_conflict_veto_triggered?: boolean | null
          broad_distance_from_neutral?: number | null
          broad_percentile?: number | null
          broad_red_history_count?: number | null
          broad_red_history_json?: Json | null
          broad_red_last12_adjusted_net?: number | null
          broad_red_last12_losses?: number | null
          broad_red_last12_wins?: number | null
          broad_red_reliability_adjusted_contribution?: number | null
          broad_red_reliability_evaluable?: boolean | null
          broad_red_reliability_publication_enabled?: boolean | null
          broad_red_reliability_raw_contribution?: number | null
          broad_red_reliability_ready?: boolean | null
          broad_red_reliability_reason?: string | null
          broad_red_reliability_threshold?: number | null
          broad_red_reliability_veto_active?: boolean | null
          broad_red_reliability_veto_triggered?: boolean | null
          broad_red_shadow_adjusted_score?: number | null
          broad_red_shadow_prediction?: string | null
          broad_red_underlying_adjusted_score?: number | null
          broad_red_underlying_prediction?: string | null
          broad_red_underlying_raw_score?: number | null
          broad_score?: number | null
          canonical_actual_direction?: string | null
          canonical_candle_row_id?: string | null
          canonical_close?: number | null
          canonical_ground_truth_valid?: boolean | null
          canonical_high?: number | null
          canonical_low?: number | null
          canonical_open?: number | null
          canonical_volume?: number | null
          consensus_red_shadow_adjusted_score?: number | null
          consensus_red_shadow_prediction?: string | null
          consensus_red_shadow_raw_score?: number | null
          consensus_red_shadow_result?: string | null
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
          final_reason?: string | null
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
          legacy_pickup_publication_enabled?: boolean | null
          legacy_r4_shadow_adjusted_score?: number | null
          legacy_r4_shadow_prediction?: string | null
          legacy_r4_shadow_raw_score?: number | null
          legacy_r4_shadow_reason?: string | null
          legacy_r4_shadow_result?: string | null
          legacy_r4_shadow_source?: string | null
          lower_wick_pct?: number | null
          model_artifact_sha256?: string | null
          model_revision?: string | null
          model_revision_activated_at?: string | null
          model_version?: string
          momentum_green_shadow_adjusted_score?: number | null
          momentum_green_shadow_prediction?: string | null
          momentum_green_shadow_raw_score?: number | null
          momentum_green_shadow_result?: string | null
          operational_error?: string | null
          operational_status?: string
          original_v6_base_prediction?: string | null
          original_v6_base_source?: string | null
          original_v6_shadow_adjusted_score?: number | null
          original_v6_shadow_raw_score?: number | null
          path_efficiency_4?: number | null
          pickup_conflict?: boolean
          pre_inverter_adjusted_score?: number | null
          pre_inverter_prediction?: string | null
          pre_inverter_prediction_source?: string | null
          pre_inverter_raw_score?: number | null
          pre_structure_prediction?: string | null
          pre_structure_source?: string | null
          pre_weak_red_veto_adjusted_score?: number | null
          pre_weak_red_veto_prediction?: string | null
          pre_weak_red_veto_raw_score?: number | null
          prediction_after_broad_conflict_veto?: string | null
          prediction_after_broad_red_reliability?: string | null
          prediction_after_structure_confirmation?: string | null
          prediction_after_weak_red_recovery?: string | null
          prediction_created_at?: string
          prediction_created_before_target?: boolean
          prediction_id?: string
          prediction_source?: string | null
          prediction_source_after_broad_conflict_veto?: string | null
          prediction_source_after_broad_red_reliability?: string | null
          prediction_source_after_structure_confirmation?: string | null
          prediction_source_after_weak_red_recovery?: string | null
          prior_candle_ids_json?: Json | null
          provider?: string
          r5_aligned_wick_red_shadow_adjusted_score?: number | null
          r5_aligned_wick_red_shadow_candidate?: boolean | null
          r5_aligned_wick_red_shadow_evaluable?: boolean | null
          r5_aligned_wick_red_shadow_raw_score?: number | null
          r5_aligned_wick_red_shadow_result?: string | null
          r5_aligned_wick_red_shadow_threshold?: number | null
          r5_aligned_wick_red_shadow_value?: number | null
          r5_anchor_red_route_brake_evaluable?: boolean | null
          r5_anchor_red_route_brake_reason?: string | null
          r5_anchor_red_route_brake_triggered?: boolean | null
          r5_anchor_red_route_consecutive_shadow_losses?: number | null
          r5_anchor_red_route_pause_active?: boolean | null
          r5_anchor_red_route_pause_after_resolution?: boolean | null
          r5_anchor_red_route_pause_before_resolution?: boolean | null
          r5_anchor_red_route_shadow_eligible?: boolean | null
          r5_anchor_red_route_shadow_result?: string | null
          r5_anchor_red_route_shadow_streak_after?: number | null
          r5_anchor_red_route_shadow_streak_before?: number | null
          r5_conflict?: boolean | null
          r5_conflict_green_result?: string | null
          r5_conflict_red_result?: string | null
          r5_final_adjusted_score?: number | null
          r5_final_raw_score?: number | null
          r5_final_result?: string | null
          r5_green_body_condition?: boolean | null
          r5_green_candidate?: boolean | null
          r5_green_d1_mean_body_to_range_2?: number | null
          r5_green_d1_mean_body_to_range_2_threshold?: number | null
          r5_green_evaluable?: boolean | null
          r5_green_route_brake_evaluable?: boolean | null
          r5_green_route_brake_reason?: string | null
          r5_green_route_brake_triggered?: boolean | null
          r5_green_route_consecutive_shadow_losses?: number | null
          r5_green_route_pause_active?: boolean | null
          r5_green_route_pause_after_resolution?: boolean | null
          r5_green_route_pause_before_resolution?: boolean | null
          r5_green_route_shadow_eligible?: boolean | null
          r5_green_route_shadow_result?: string | null
          r5_green_route_shadow_streak_after?: number | null
          r5_green_route_shadow_streak_before?: number | null
          r5_green_shadow_adjusted_score?: number | null
          r5_green_shadow_prediction?: string | null
          r5_green_shadow_raw_score?: number | null
          r5_green_shadow_result?: string | null
          r5_green_stoch_condition?: boolean | null
          r5_green_stoch_spread?: number | null
          r5_green_stoch_spread_threshold?: number | null
          r5_pre_brake_prediction?: string | null
          r5_pre_brake_reason?: string | null
          r5_pre_brake_source?: string | null
          r5_red_anchor_candidate?: boolean | null
          r5_red_anchor_condition?: boolean | null
          r5_red_anchor_d1_close_position?: number | null
          r5_red_anchor_d1_close_position_threshold?: number | null
          r5_red_anchor_evaluable?: boolean | null
          r5_red_anchor_shadow_adjusted_score?: number | null
          r5_red_anchor_shadow_prediction?: string | null
          r5_red_anchor_shadow_raw_score?: number | null
          r5_red_anchor_shadow_result?: string | null
          r5_red_broad_bb_condition?: boolean | null
          r5_red_broad_bb_width_pct?: number | null
          r5_red_broad_bb_width_threshold?: number | null
          r5_red_broad_candidate?: boolean | null
          r5_red_broad_close_slope_8?: number | null
          r5_red_broad_close_slope_threshold?: number | null
          r5_red_broad_evaluable?: boolean | null
          r5_red_broad_shadow_adjusted_score?: number | null
          r5_red_broad_shadow_prediction?: string | null
          r5_red_broad_shadow_raw_score?: number | null
          r5_red_broad_shadow_result?: string | null
          r5_red_broad_slope_condition?: boolean | null
          r5_red_candidate?: boolean | null
          r5_red_feeder_evaluable?: boolean | null
          r5_red_feeder_pass?: boolean | null
          r5_red_feeder_prediction?: string | null
          r5_red_feeder_source?: string | null
          r5_route_brake_activated_at?: string | null
          r5_route_brake_adjusted_contribution?: number | null
          r5_route_brake_pause_loss_threshold?: number | null
          r5_route_brake_publication_enabled?: boolean | null
          r5_route_brake_raw_contribution?: number | null
          r5_route_brake_reason?: string | null
          r5_route_brake_resume_win_threshold?: number | null
          r5_route_brake_revision?: string | null
          r5_route_brake_route_key?: string | null
          r5_route_brake_shadow_adjusted_score?: number | null
          r5_route_brake_shadow_only?: boolean | null
          r5_route_brake_shadow_prediction?: string | null
          r5_route_brake_shadow_raw_score?: number | null
          r5_route_brake_shadow_reason?: string | null
          r5_route_brake_shadow_result?: string | null
          r5_route_brake_state_rebuilt?: boolean | null
          r5_route_brake_triggered?: boolean | null
          r5_route_brake_underlying_actual?: string | null
          r5_route_brake_underlying_adjusted_score?: number | null
          r5_route_brake_underlying_prediction?: string | null
          r5_route_brake_underlying_raw_score?: number | null
          r5_route_brake_underlying_result?: string | null
          r5_router_decision?: string | null
          r5_router_reason?: string | null
          r5_router_source?: string | null
          r5_router_version?: string | null
          r6_base_prediction?: string | null
          r6_base_r5_adjusted_score?: number | null
          r6_base_r5_raw_score?: number | null
          r6_base_r5_result?: string | null
          r6_base_reason?: string | null
          r6_base_source?: string | null
          r6_conflict_green_result?: string | null
          r6_conflict_red_result?: string | null
          r6_final_adjusted_score?: number | null
          r6_final_prediction?: string | null
          r6_final_raw_score?: number | null
          r6_final_reason?: string | null
          r6_final_result?: string | null
          r6_final_source?: string | null
          r6_green_promotion_candidate?: boolean | null
          r6_green_promotion_rule_count?: number | null
          r6_green_promotion_rules_triggered?: Json | null
          r6_green_promotion_shadow_adjusted_score?: number | null
          r6_green_promotion_shadow_raw_score?: number | null
          r6_green_promotion_shadow_result?: string | null
          r6_p1_condition_a?: boolean | null
          r6_p1_condition_b?: boolean | null
          r6_p1_evaluable?: boolean | null
          r6_p1_green_candidate?: boolean | null
          r6_p1_momentum_8_over_atr?: number | null
          r6_p1_momentum_threshold?: number | null
          r6_p1_path_efficiency_4?: number | null
          r6_p1_path_efficiency_threshold?: number | null
          r6_p1_shadow_adjusted_score?: number | null
          r6_p1_shadow_raw_score?: number | null
          r6_p1_shadow_result?: string | null
          r6_p2_condition_a?: boolean | null
          r6_p2_condition_b?: boolean | null
          r6_p2_evaluable?: boolean | null
          r6_p2_red_candidate?: boolean | null
          r6_p2_roc_8?: number | null
          r6_p2_roc_threshold?: number | null
          r6_p2_shadow_adjusted_score?: number | null
          r6_p2_shadow_raw_score?: number | null
          r6_p2_shadow_result?: string | null
          r6_p2_volume_expansion?: number | null
          r6_p2_volume_expansion_threshold?: number | null
          r6_p3_change_pct?: number | null
          r6_p3_change_pct_threshold?: number | null
          r6_p3_channel_position_0_1?: number | null
          r6_p3_channel_position_threshold?: number | null
          r6_p3_condition_a?: boolean | null
          r6_p3_condition_b?: boolean | null
          r6_p3_evaluable?: boolean | null
          r6_p3_green_candidate?: boolean | null
          r6_p3_shadow_adjusted_score?: number | null
          r6_p3_shadow_raw_score?: number | null
          r6_p3_shadow_result?: string | null
          r6_p4_condition_a?: boolean | null
          r6_p4_condition_b?: boolean | null
          r6_p4_evaluable?: boolean | null
          r6_p4_macd_hist_over_atr14?: number | null
          r6_p4_macd_threshold?: number | null
          r6_p4_mean_body_threshold?: number | null
          r6_p4_mean_body_to_range_2?: number | null
          r6_p4_red_candidate?: boolean | null
          r6_p4_shadow_adjusted_score?: number | null
          r6_p4_shadow_raw_score?: number | null
          r6_p4_shadow_result?: string | null
          r6_p5_change_pct?: number | null
          r6_p5_change_pct_threshold?: number | null
          r6_p5_condition_a?: boolean | null
          r6_p5_condition_b?: boolean | null
          r6_p5_dist_low20_threshold?: number | null
          r6_p5_dist_to_low20_pct?: number | null
          r6_p5_evaluable?: boolean | null
          r6_p5_green_candidate?: boolean | null
          r6_p5_shadow_adjusted_score?: number | null
          r6_p5_shadow_raw_score?: number | null
          r6_p5_shadow_result?: string | null
          r6_p6_condition_a?: boolean | null
          r6_p6_condition_b?: boolean | null
          r6_p6_evaluable?: boolean | null
          r6_p6_green_candidate?: boolean | null
          r6_p6_mean_body_threshold?: number | null
          r6_p6_mean_body_to_range_2?: number | null
          r6_p6_path_efficiency_4?: number | null
          r6_p6_path_efficiency_threshold?: number | null
          r6_p6_shadow_adjusted_score?: number | null
          r6_p6_shadow_raw_score?: number | null
          r6_p6_shadow_result?: string | null
          r6_promotion_adjusted_contribution?: number | null
          r6_promotion_all_rules?: Json | null
          r6_promotion_conflict?: boolean | null
          r6_promotion_final_prediction?: string | null
          r6_promotion_primary_rule?: string | null
          r6_promotion_raw_contribution?: number | null
          r6_promotion_result?: string | null
          r6_promotion_underlying_r5_prediction?: string | null
          r6_red_promotion_candidate?: boolean | null
          r6_red_promotion_rule_count?: number | null
          r6_red_promotion_rules_triggered?: Json | null
          r6_red_promotion_shadow_adjusted_score?: number | null
          r6_red_promotion_shadow_raw_score?: number | null
          r6_red_promotion_shadow_result?: string | null
          r6_router_version?: string | null
          r7_action_vs_r6?: string | null
          r7_activated_at?: string | null
          r7_anchor_bin?: number | null
          r7_best_green_edge_rate?: number | null
          r7_best_green_expert?: string | null
          r7_best_green_samples?: number | null
          r7_best_red_edge_rate?: number | null
          r7_best_red_expert?: string | null
          r7_best_red_samples?: number | null
          r7_broad_bin?: number | null
          r7_e1_candidate?: string | null
          r7_e1_qualified?: boolean | null
          r7_e1_shadow_raw_score?: number | null
          r7_e1_shadow_result?: string | null
          r7_e1_state_edge_rate?: number | null
          r7_e1_state_losses?: number | null
          r7_e1_state_raw_net?: number | null
          r7_e1_state_samples?: number | null
          r7_e1_state_win_rate?: number | null
          r7_e1_state_wins?: number | null
          r7_e2_candidate?: string | null
          r7_e2_qualified?: boolean | null
          r7_e2_shadow_raw_score?: number | null
          r7_e2_shadow_result?: string | null
          r7_e2_state_edge_rate?: number | null
          r7_e2_state_losses?: number | null
          r7_e2_state_raw_net?: number | null
          r7_e2_state_samples?: number | null
          r7_e2_state_win_rate?: number | null
          r7_e2_state_wins?: number | null
          r7_e3_candidate?: string | null
          r7_e3_qualified?: boolean | null
          r7_e3_shadow_raw_score?: number | null
          r7_e3_shadow_result?: string | null
          r7_e3_state_edge_rate?: number | null
          r7_e3_state_losses?: number | null
          r7_e3_state_raw_net?: number | null
          r7_e3_state_samples?: number | null
          r7_e3_state_win_rate?: number | null
          r7_e3_state_wins?: number | null
          r7_e4_candidate?: string | null
          r7_e4_qualified?: boolean | null
          r7_e4_shadow_raw_score?: number | null
          r7_e4_shadow_result?: string | null
          r7_e4_state_edge_rate?: number | null
          r7_e4_state_losses?: number | null
          r7_e4_state_raw_net?: number | null
          r7_e4_state_samples?: number | null
          r7_e4_state_win_rate?: number | null
          r7_e4_state_wins?: number | null
          r7_history_error?: string | null
          r7_history_ready?: boolean | null
          r7_history_window?: number | null
          r7_model_revision?: string | null
          r7_prior_valid_opportunity_count?: number | null
          r7_publication_enabled?: boolean | null
          r7_r6_reference_prediction?: string | null
          r7_raw_contribution_vs_r6?: number | null
          r7_selected_expert?: string | null
          r7_shadow_enabled?: boolean | null
          r7_shadow_prediction?: string | null
          r7_shadow_raw_score?: number | null
          r7_shadow_reason?: string | null
          r7_shadow_result?: string | null
          r7_state_evaluable?: boolean | null
          r7_state_green_count?: number | null
          r7_state_green_win_rate?: number | null
          r7_state_id?: string | null
          r7_state_red_count?: number | null
          r7_state_red_win_rate?: number | null
          r7_state_sample_count?: number | null
          r7_version?: string | null
          range_expansion_vs_avg20?: number | null
          red_pickup_adjusted_contribution?: number | null
          red_pickup_evaluable?: boolean
          red_pickup_raw_contribution?: number | null
          red_pickup_triggered?: boolean
          red_threshold?: number | null
          regime_inverter_activation_threshold?: number | null
          regime_inverter_active?: boolean | null
          regime_inverter_adjusted_contribution?: number | null
          regime_inverter_counterfactual_adjusted_contribution?: number | null
          regime_inverter_counterfactual_raw_contribution?: number | null
          regime_inverter_evaluable?: boolean | null
          regime_inverter_history_count?: number | null
          regime_inverter_history_json?: Json | null
          regime_inverter_last20_adjusted_net?: number | null
          regime_inverter_last20_losses?: number | null
          regime_inverter_last20_wins?: number | null
          regime_inverter_original_prediction?: string | null
          regime_inverter_publication_enabled?: boolean | null
          regime_inverter_raw_contribution?: number | null
          regime_inverter_ready?: boolean | null
          regime_inverter_reason?: string | null
          regime_inverter_replacement_prediction?: string | null
          regime_inverter_shadow_adjusted_score?: number | null
          regime_inverter_shadow_only?: boolean | null
          regime_inverter_shadow_raw_score?: number | null
          regime_inverter_triggered?: boolean | null
          regime_inverter_would_publish?: string | null
          regime_inverter_would_trigger?: boolean | null
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
          selected_component?: string | null
          structure_confirmation_adjusted_contribution?: number | null
          structure_confirmation_evaluable?: boolean | null
          structure_confirmation_pass?: boolean | null
          structure_confirmation_publication_enabled?: boolean | null
          structure_confirmation_raw_contribution?: number | null
          structure_confirmation_reason?: string | null
          structure_confirmation_shadow_only?: boolean | null
          structure_confirmation_triggered?: boolean | null
          structure_expansion_efficiency_threshold?: number | null
          structure_expansion_efficiency_value?: number | null
          structure_expansion_evaluable?: boolean | null
          structure_expansion_pass?: boolean | null
          structure_expansion_range_threshold?: number | null
          structure_expansion_range_value?: number | null
          structure_rejection_aligned_wick_threshold?: number | null
          structure_rejection_aligned_wick_value?: number | null
          structure_rejection_evaluable?: boolean | null
          structure_rejection_lower_wick_threshold?: number | null
          structure_rejection_lower_wick_value?: number | null
          structure_rejection_pass?: boolean | null
          structure_underlying_actual_direction?: string | null
          structure_underlying_adjusted_score?: number | null
          structure_underlying_prediction?: string | null
          structure_underlying_raw_score?: number | null
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
          webhook_conflict_with_b4x4?: boolean | null
          webhook_eligible?: boolean | null
          webhook_sent_at?: string | null
          webhook_suppressed_reason?: string | null
        }
        Relationships: []
      }
      v6_r5_route_brake_state: {
        Row: {
          consecutive_shadow_losses: number
          created_at: string
          id: string
          last_shadow_prediction: string | null
          last_shadow_result: string | null
          last_shadow_target_ts: string | null
          model_revision: string
          model_version: string
          pause_active: boolean
          route_key: string
          state_updated_at: string
          updated_at: string
        }
        Insert: {
          consecutive_shadow_losses?: number
          created_at?: string
          id?: string
          last_shadow_prediction?: string | null
          last_shadow_result?: string | null
          last_shadow_target_ts?: string | null
          model_revision: string
          model_version?: string
          pause_active?: boolean
          route_key: string
          state_updated_at?: string
          updated_at?: string
        }
        Update: {
          consecutive_shadow_losses?: number
          created_at?: string
          id?: string
          last_shadow_prediction?: string | null
          last_shadow_result?: string | null
          last_shadow_target_ts?: string | null
          model_revision?: string
          model_version?: string
          pause_active?: boolean
          route_key?: string
          state_updated_at?: string
          updated_at?: string
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
      b4x4_begin_resolution_attempt: {
        Args: { p_model_version: string; p_target_candle_ts: string }
        Returns: Json
      }
      b4x4_ob_capture_call: { Args: never; Returns: undefined }
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
      t45pf_mint_lock: { Args: { p_block_start: number }; Returns: boolean }
    }
    Enums: {
      binance_ob_capture_status:
        | "FRESH"
        | "STALE"
        | "NO_DATA"
        | "SEQUENCE_GAP"
        | "RESYNCING"
        | "INCOMPLETE_BOOK"
        | "CROSSED_BOOK"
        | "REST_FALLBACK"
        | "REGION_BLOCKED"
        | "COLLECTOR_ERROR"
      binance_ob_market_kind: "SPOT" | "USD_M_PERP"
      binance_ob_mode: "SHADOW_ONLY" | "ACTIVE"
      binance_ob_policy_name:
        | "SPOT_FOLLOW_CURRENT_BAND"
        | "SPOT_FADE_CURRENT_BAND"
        | "SPOT_FOLLOW_PERSISTENT"
        | "SPOT_FADE_PERSISTENT"
        | "SPOT_PERP_CONSENSUS_FOLLOW"
        | "SPOT_PERP_CONSENSUS_FADE"
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
    Enums: {
      binance_ob_capture_status: [
        "FRESH",
        "STALE",
        "NO_DATA",
        "SEQUENCE_GAP",
        "RESYNCING",
        "INCOMPLETE_BOOK",
        "CROSSED_BOOK",
        "REST_FALLBACK",
        "REGION_BLOCKED",
        "COLLECTOR_ERROR",
      ],
      binance_ob_market_kind: ["SPOT", "USD_M_PERP"],
      binance_ob_mode: ["SHADOW_ONLY", "ACTIVE"],
      binance_ob_policy_name: [
        "SPOT_FOLLOW_CURRENT_BAND",
        "SPOT_FADE_CURRENT_BAND",
        "SPOT_FOLLOW_PERSISTENT",
        "SPOT_FADE_PERSISTENT",
        "SPOT_PERP_CONSENSUS_FOLLOW",
        "SPOT_PERP_CONSENSUS_FADE",
      ],
    },
  },
} as const
