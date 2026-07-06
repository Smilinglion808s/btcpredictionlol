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
      predictions: {
        Row: {
          actual_direction: string | null
          actual_next_candle_close: number | null
          actual_next_candle_high: number | null
          actual_next_candle_low: number | null
          actual_next_candle_open: number | null
          api_model_id: string | null
          btc_price_at_prediction: number
          candle_ts: string
          confidence: number
          created_at: string
          freshness_action: string | null
          full_ai_response: Json | null
          id: string
          indicators: Json | null
          input_candle_age_seconds: number | null
          input_candle_ts: string | null
          input_features_fresh: boolean | null
          market_condition: string | null
          model_version: string
          notes: string | null
          orderbook: Json | null
          prediction: string
          reasoning_summary: string | null
          resolved_at: string | null
          setup_type: string | null
          status: string
          symbol: string
          timeframe: string
        }
        Insert: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          api_model_id?: string | null
          btc_price_at_prediction: number
          candle_ts: string
          confidence: number
          created_at?: string
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version: string
          notes?: string | null
          orderbook?: Json | null
          prediction: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
        }
        Update: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          api_model_id?: string | null
          btc_price_at_prediction?: number
          candle_ts?: string
          confidence?: number
          created_at?: string
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version?: string
          notes?: string | null
          orderbook?: Json | null
          prediction?: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
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
          api_model_id: string | null
          archived_at: string
          btc_price_at_prediction: number
          candle_ts: string
          confidence: number
          created_at: string
          freshness_action: string | null
          full_ai_response: Json | null
          id: string
          indicators: Json | null
          input_candle_age_seconds: number | null
          input_candle_ts: string | null
          input_features_fresh: boolean | null
          market_condition: string | null
          model_version: string
          notes: string | null
          orderbook: Json | null
          prediction: string
          reasoning_summary: string | null
          resolved_at: string | null
          setup_type: string | null
          status: string
          symbol: string
          timeframe: string
        }
        Insert: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          api_model_id?: string | null
          archived_at?: string
          btc_price_at_prediction: number
          candle_ts: string
          confidence: number
          created_at?: string
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version: string
          notes?: string | null
          orderbook?: Json | null
          prediction: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
        }
        Update: {
          actual_direction?: string | null
          actual_next_candle_close?: number | null
          actual_next_candle_high?: number | null
          actual_next_candle_low?: number | null
          actual_next_candle_open?: number | null
          api_model_id?: string | null
          archived_at?: string
          btc_price_at_prediction?: number
          candle_ts?: string
          confidence?: number
          created_at?: string
          freshness_action?: string | null
          full_ai_response?: Json | null
          id?: string
          indicators?: Json | null
          input_candle_age_seconds?: number | null
          input_candle_ts?: string | null
          input_features_fresh?: boolean | null
          market_condition?: string | null
          model_version?: string
          notes?: string | null
          orderbook?: Json | null
          prediction?: string
          reasoning_summary?: string | null
          resolved_at?: string | null
          setup_type?: string | null
          status?: string
          symbol?: string
          timeframe?: string
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
      prediction_stats: { Args: never; Returns: Json }
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
