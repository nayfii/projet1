
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_models": {
                  Row: {
                    "api_model_id": string,"cached_input_credits_per_mtok": number,"cached_input_usd_per_mtok": number,"context_window": number,"created_at": string,"default_allowed": boolean,"id": string,"input_credits_per_mtok": number,"input_usd_per_mtok": number,"is_enabled": boolean,"label": string,"max_output_tokens": number,"output_credits_per_mtok": number,"output_usd_per_mtok": number,"provider": Database["public"]['Enums']["ai_provider"],"sort_order": number,"strengths": (string)[],"supports_images": boolean,"tier": Database["public"]['Enums']["model_tier"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "api_model_id": string,"cached_input_credits_per_mtok"?: number,"cached_input_usd_per_mtok"?: number,"context_window": number,"created_at"?: string,"default_allowed"?: boolean,"id": string,"input_credits_per_mtok"?: number,"input_usd_per_mtok"?: number,"is_enabled"?: boolean,"label": string,"max_output_tokens": number,"output_credits_per_mtok"?: number,"output_usd_per_mtok"?: number,"provider": Database["public"]['Enums']["ai_provider"],"sort_order"?: number,"strengths"?: (string)[],"supports_images"?: boolean,"tier": Database["public"]['Enums']["model_tier"],"updated_at"?: string
                  }
                  Update: {
                    "api_model_id"?: string,"cached_input_credits_per_mtok"?: number,"cached_input_usd_per_mtok"?: number,"context_window"?: number,"created_at"?: string,"default_allowed"?: boolean,"id"?: string,"input_credits_per_mtok"?: number,"input_usd_per_mtok"?: number,"is_enabled"?: boolean,"label"?: string,"max_output_tokens"?: number,"output_credits_per_mtok"?: number,"output_usd_per_mtok"?: number,"provider"?: Database["public"]['Enums']["ai_provider"],"sort_order"?: number,"strengths"?: (string)[],"supports_images"?: boolean,"tier"?: Database["public"]['Enums']["model_tier"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"company_id": string | null,"created_at": string,"id": number,"metadata": NonNullable<Json>,"scope": string,"target_id": string | null,"target_type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"company_id"?: string | null,"created_at"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"scope": string,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"company_id"?: string | null,"created_at"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"scope"?: string,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_log_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"client_assignments": {
                  Row: {
                    "assigned_at": string,"assigned_by": string | null,"client_id": string,"company_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"client_id": string,"company_id": string,"user_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"client_id"?: string,"company_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_assignments_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_assignments_client_id_company_id_fkey"
      columns: ["client_id","company_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","company_id"]
    },{
      foreignKeyName: "client_assignments_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: false
      referencedRelation: "company_members"
      referencedColumns: ["company_id","user_id"]
    },{
      foreignKeyName: "client_assignments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "archived_at": string | null,"company_id": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"name": string,"sector": string | null,"updated_at": string,"visibility": Database["public"]['Enums']["client_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"company_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name": string,"sector"?: string | null,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["client_visibility"]
                  }
                  Update: {
                    "archived_at"?: string | null,"company_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"sector"?: string | null,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["client_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "created_at": string,"created_by": string | null,"default_locale": string,"description": string | null,"id": string,"industry": string | null,"name": string,"onboarding_completed_at": string | null,"plan_id": string | null,"size_range": string | null,"status": Database["public"]['Enums']["company_status"],"updated_at": string,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"default_locale"?: string,"description"?: string | null,"id"?: string,"industry"?: string | null,"name": string,"onboarding_completed_at"?: string | null,"plan_id"?: string | null,"size_range"?: string | null,"status"?: Database["public"]['Enums']["company_status"],"updated_at"?: string,"website"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"default_locale"?: string,"description"?: string | null,"id"?: string,"industry"?: string | null,"name"?: string,"onboarding_completed_at"?: string | null,"plan_id"?: string | null,"size_range"?: string | null,"status"?: Database["public"]['Enums']["company_status"],"updated_at"?: string,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"company_ai_settings": {
                  Row: {
                    "auto_enabled": boolean,"company_id": string,"default_model_id": string | null,"default_user_monthly_credits": number | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_enabled"?: boolean,"company_id": string,"default_model_id"?: string | null,"default_user_monthly_credits"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "auto_enabled"?: boolean,"company_id"?: string,"default_model_id"?: string | null,"default_user_monthly_credits"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_ai_settings_company_id_fkey"
      columns: ["company_id"]
isOneToOne: true
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_ai_settings_default_model_id_fkey"
      columns: ["default_model_id"]
isOneToOne: false
      referencedRelation: "ai_models"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_ai_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"company_allowed_models": {
                  Row: {
                    "company_id": string,"model_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"model_id": string
                  }
                  Update: {
                    "company_id"?: string,"model_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_allowed_models_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_allowed_models_model_id_fkey"
      columns: ["model_id"]
isOneToOne: false
      referencedRelation: "ai_models"
      referencedColumns: ["id"]
    }
                  ]
                },"company_members": {
                  Row: {
                    "admin_scopes": (string)[],"company_id": string,"deactivated_at": string | null,"expertise": (string)[],"job_title": string | null,"joined_at": string,"role": Database["public"]['Enums']["company_role"],"status": Database["public"]['Enums']["member_status"],"team_id": string | null,"updated_at": string,"user_id": string,"who_can_help_opt_out": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_scopes"?: (string)[],"company_id": string,"deactivated_at"?: string | null,"expertise"?: (string)[],"job_title"?: string | null,"joined_at"?: string,"role"?: Database["public"]['Enums']["company_role"],"status"?: Database["public"]['Enums']["member_status"],"team_id"?: string | null,"updated_at"?: string,"user_id": string,"who_can_help_opt_out"?: boolean
                  }
                  Update: {
                    "admin_scopes"?: (string)[],"company_id"?: string,"deactivated_at"?: string | null,"expertise"?: (string)[],"job_title"?: string | null,"joined_at"?: string,"role"?: Database["public"]['Enums']["company_role"],"status"?: Database["public"]['Enums']["member_status"],"team_id"?: string | null,"updated_at"?: string,"user_id"?: string,"who_can_help_opt_out"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_members_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_members_team_id_company_id_fkey"
      columns: ["team_id","company_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","company_id"]
    },{
      foreignKeyName: "company_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_attachments": {
                  Row: {
                    "company_id": string,"conversation_id": string,"created_at": string,"extracted_text": string | null,"filename": string,"id": string,"kind": string,"message_id": string | null,"mime_type": string,"size_bytes": number,"storage_path": string,"text_truncated": boolean,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id"?: string,"conversation_id": string,"created_at"?: string,"extracted_text"?: string | null,"filename": string,"id"?: string,"kind": string,"message_id"?: string | null,"mime_type": string,"size_bytes": number,"storage_path": string,"text_truncated"?: boolean,"uploaded_by"?: string
                  }
                  Update: {
                    "company_id"?: string,"conversation_id"?: string,"created_at"?: string,"extracted_text"?: string | null,"filename"?: string,"id"?: string,"kind"?: string,"message_id"?: string | null,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"text_truncated"?: boolean,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_attachments_conversation_id_company_id_fkey"
      columns: ["conversation_id","company_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","company_id"]
    },{
      foreignKeyName: "conversation_attachments_message_id_conversation_id_fkey"
      columns: ["message_id","conversation_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id","conversation_id"]
    },{
      foreignKeyName: "conversation_attachments_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_participants": {
                  Row: {
                    "added_by": string | null,"company_id": string,"conversation_id": string,"joined_at": string,"role": string,"user_id": string,"visible_from_seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"company_id": string,"conversation_id": string,"joined_at"?: string,"role"?: string,"user_id": string,"visible_from_seq"?: number
                  }
                  Update: {
                    "added_by"?: string | null,"company_id"?: string,"conversation_id"?: string,"joined_at"?: string,"role"?: string,"user_id"?: string,"visible_from_seq"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_participants_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_participants_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: false
      referencedRelation: "company_members"
      referencedColumns: ["company_id","user_id"]
    },{
      foreignKeyName: "conversation_participants_conversation_id_company_id_fkey"
      columns: ["conversation_id","company_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","company_id"]
    },{
      foreignKeyName: "conversation_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "client_id": string | null,"company_id": string,"created_at": string,"id": string,"is_group": boolean,"last_message_at": string | null,"last_seq": number,"model_choice": string,"owner_id": string,"title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"company_id": string,"created_at"?: string,"id"?: string,"is_group"?: boolean,"last_message_at"?: string | null,"last_seq"?: number,"model_choice"?: string,"owner_id"?: string,"title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string | null,"company_id"?: string,"created_at"?: string,"id"?: string,"is_group"?: boolean,"last_message_at"?: string | null,"last_seq"?: number,"model_choice"?: string,"owner_id"?: string,"title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_client_id_company_id_fkey"
      columns: ["client_id","company_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","company_id"]
    },{
      foreignKeyName: "conversations_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_grants": {
                  Row: {
                    "company_id": string,"created_at": string,"credits": number,"granted_by": string | null,"id": string,"note": string | null,"period_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"created_at"?: string,"credits": number,"granted_by"?: string | null,"id"?: string,"note"?: string | null,"period_start": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"credits"?: number,"granted_by"?: string | null,"id"?: string,"note"?: string | null,"period_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_grants_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_grants_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"admin_scopes": (string)[],"company_id": string,"created_at": string,"email": string,"expertise": (string)[],"expires_at": string,"id": string,"invited_by": string | null,"job_title": string | null,"revoked_at": string | null,"role": Database["public"]['Enums']["company_role"],"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"admin_scopes"?: (string)[],"company_id": string,"created_at"?: string,"email": string,"expertise"?: (string)[],"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"job_title"?: string | null,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["company_role"],"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"admin_scopes"?: (string)[],"company_id"?: string,"created_at"?: string,"email"?: string,"expertise"?: (string)[],"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"job_title"?: string | null,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["company_role"],"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"member_quotas": {
                  Row: {
                    "company_id": string,"monthly_credits": number,"updated_at": string,"updated_by": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"monthly_credits": number,"updated_at"?: string,"updated_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"monthly_credits"?: number,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_quotas_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: true
      referencedRelation: "company_members"
      referencedColumns: ["company_id","user_id"]
    },{
      foreignKeyName: "member_quotas_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_quotas_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "api_model_id": string | null,"author_id": string | null,"author_type": string,"company_id": string,"content": string,"context_meta": Json | null,"conversation_id": string,"created_at": string,"error_code": string | null,"id": string,"input_tokens": number | null,"model_content": string | null,"model_id": string | null,"model_label": string | null,"output_tokens": number | null,"provider": Database["public"]['Enums']["ai_provider"] | null,"routing": Json | null,"seq": number,"status": string,"stop_requested_at": string | null,"superseded_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "api_model_id"?: string | null,"author_id"?: string | null,"author_type"?: string,"company_id"?: string,"content"?: string,"context_meta"?: Json | null,"conversation_id": string,"created_at"?: string,"error_code"?: string | null,"id"?: string,"input_tokens"?: number | null,"model_content"?: string | null,"model_id"?: string | null,"model_label"?: string | null,"output_tokens"?: number | null,"provider"?: Database["public"]['Enums']["ai_provider"] | null,"routing"?: Json | null,"seq"?: number,"status"?: string,"stop_requested_at"?: string | null,"superseded_at"?: string | null
                  }
                  Update: {
                    "api_model_id"?: string | null,"author_id"?: string | null,"author_type"?: string,"company_id"?: string,"content"?: string,"context_meta"?: Json | null,"conversation_id"?: string,"created_at"?: string,"error_code"?: string | null,"id"?: string,"input_tokens"?: number | null,"model_content"?: string | null,"model_id"?: string | null,"model_label"?: string | null,"output_tokens"?: number | null,"provider"?: Database["public"]['Enums']["ai_provider"] | null,"routing"?: Json | null,"seq"?: number,"status"?: string,"stop_requested_at"?: string | null,"superseded_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_conversation_id_company_id_fkey"
      columns: ["conversation_id","company_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","company_id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_active": boolean,"is_default": boolean,"monthly_credits": number,"name": string,"price_label": string | null,"seat_limit": number | null,"updated_at": string,"video_credits": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"monthly_credits"?: number,"name": string,"price_label"?: string | null,"seat_limit"?: number | null,"updated_at"?: string,"video_credits"?: number
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"monthly_credits"?: number,"name"?: string,"price_label"?: string | null,"seat_limit"?: number | null,"updated_at"?: string,"video_credits"?: number
                  }
                  Relationships: [
                    
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "active_company_id": string | null,"avatar_url": string | null,"created_at": string,"email": string,"full_name": string | null,"id": string,"locale": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_company_id"?: string | null,"avatar_url"?: string | null,"created_at"?: string,"email": string,"full_name"?: string | null,"id": string,"locale"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active_company_id"?: string | null,"avatar_url"?: string | null,"created_at"?: string,"email"?: string,"full_name"?: string | null,"id"?: string,"locale"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_active_company_id_fkey"
      columns: ["active_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_events": {
                  Row: {
                    "api_model_id": string | null,"auto_routed": boolean,"cached_input_tokens": number,"company_id": string,"conversation_id": string | null,"created_at": string,"credit_pool": string,"credits": number,"error_code": string | null,"estimated_cost_usd": number,"feature": string,"id": number,"input_tokens": number,"latency_ms": number | null,"message_id": string | null,"model_id": string | null,"output_tokens": number,"provider": Database["public"]['Enums']["ai_provider"] | null,"status": string,"tokens_estimated": boolean,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "api_model_id"?: string | null,"auto_routed"?: boolean,"cached_input_tokens"?: number,"company_id": string,"conversation_id"?: string | null,"created_at"?: string,"credit_pool"?: string,"credits"?: number,"error_code"?: string | null,"estimated_cost_usd"?: number,"feature": string,"id"?: never,"input_tokens"?: number,"latency_ms"?: number | null,"message_id"?: string | null,"model_id"?: string | null,"output_tokens"?: number,"provider"?: Database["public"]['Enums']["ai_provider"] | null,"status": string,"tokens_estimated"?: boolean,"user_id"?: string | null
                  }
                  Update: {
                    "api_model_id"?: string | null,"auto_routed"?: boolean,"cached_input_tokens"?: number,"company_id"?: string,"conversation_id"?: string | null,"created_at"?: string,"credit_pool"?: string,"credits"?: number,"error_code"?: string | null,"estimated_cost_usd"?: number,"feature"?: string,"id"?: never,"input_tokens"?: number,"latency_ms"?: number | null,"message_id"?: string | null,"model_id"?: string | null,"output_tokens"?: number,"provider"?: Database["public"]['Enums']["ai_provider"] | null,"status"?: string,"tokens_estimated"?: boolean,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_events_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usage_events_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usage_events_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usage_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_invitation"?: string,"p_token"?: string }; Returns: string
                           },
"admin_member_credits":
{ Args: { "p_company": string }; Returns: {
              "credits_used": number,"has_override": boolean,"personal_limit": number,"user_id": string
            }[]
                           },
"admin_set_default_user_quota":
{ Args: { "p_company": string,"p_credits": number }; Returns: undefined
                           },
"admin_set_member_quota":
{ Args: { "p_company": string,"p_credits": number,"p_user": string }; Returns: undefined
                           },
"admin_update_member":
{ Args: { "p_admin_scopes"?: (string)[],"p_company": string,"p_expertise"?: (string)[],"p_job_title"?: string,"p_role"?: Database["public"]['Enums']["company_role"],"p_status"?: Database["public"]['Enums']["member_status"],"p_team"?: string,"p_user": string }; Returns: undefined
                           },
"admin_update_model_settings":
{ Args: { "p_allowed": (string)[],"p_auto": boolean,"p_company": string,"p_default": string }; Returns: undefined
                           },
"company_usage_summary":
{ Args: { "p_company": string,"p_from": string,"p_to": string }; Returns: Json
                           },
"create_company":
{ Args: { "p_default_locale"?: string,"p_description"?: string,"p_industry"?: string,"p_name": string,"p_size_range"?: string,"p_website"?: string }; Returns: string
                           },
"create_invitation":
{ Args: { "p_admin_scopes"?: (string)[],"p_company": string,"p_email": string,"p_expertise"?: (string)[],"p_job_title"?: string,"p_role"?: Database["public"]['Enums']["company_role"] }; Returns: {
              "invitation_id": string,"token": string
            }[]
                           },
"my_memberships":
{ Args: Record<PropertyKey, never>; Returns: {
              "admin_scopes": (string)[],"company_id": string,"company_name": string,"company_status": Database["public"]['Enums']["company_status"],"member_status": Database["public"]['Enums']["member_status"],"onboarding_completed_at": string,"role": Database["public"]['Enums']["company_role"]
            }[]
                           },
"my_pending_invitations":
{ Args: Record<PropertyKey, never>; Returns: {
              "company_id": string,"company_name": string,"expires_at": string,"invitation_id": string,"invited_by_name": string,"role": Database["public"]['Enums']["company_role"]
            }[]
                           },
"my_quota_status":
{ Args: { "p_company": string }; Returns: {
              "company_limit": number,"company_used": number,"period_start": string,"user_limit": number,"user_used": number
            }[]
                           },
"platform_company_credits":
{ Args: Record<PropertyKey, never>; Returns: {
              "company_id": string,"credit_limit": number,"credits_used": number,"estimated_cost_usd": number,"granted": number,"requests": number
            }[]
                           },
"platform_create_company":
{ Args: { "p_name": string,"p_owner_email": string,"p_plan": string }; Returns: {
              "company_id": string,"invitation_id": string,"token": string
            }[]
                           },
"platform_grant_credits":
{ Args: { "p_company": string,"p_credits": number,"p_note"?: string }; Returns: undefined
                           },
"platform_list_companies":
{ Args: Record<PropertyKey, never>; Returns: {
              "active_seats": number,"created_at": string,"id": string,"name": string,"owner_email": string,"pending_invitations": number,"plan_id": string,"plan_name": string,"seat_limit": number,"status": Database["public"]['Enums']["company_status"]
            }[]
                           },
"platform_update_company":
{ Args: { "p_company": string,"p_plan"?: string,"p_status"?: Database["public"]['Enums']["company_status"] }; Returns: undefined
                           },
"record_sign_in":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"revoke_invitation":
{ Args: { "p_invitation": string }; Returns: undefined
                           },
"search_conversations":
{ Args: { "p_company": string,"p_limit"?: number,"p_query": string }; Returns: {
              "client_id": string,"conversation_id": string,"matched_at": string,"snippet": string,"title": string
            }[]
                           },
"update_my_member_card":
{ Args: { "p_company": string,"p_expertise": (string)[],"p_job_title": string,"p_opt_out": boolean }; Returns: undefined
                           }
          }
          Enums: {
            "ai_provider": "openai"|"anthropic"|"google","client_visibility": "open"|"restricted","company_role": "owner"|"admin"|"member","company_status": "active"|"suspended","member_status": "active"|"deactivated","model_tier": "fast"|"balanced"|"advanced"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "ai_provider": ["openai", "anthropic", "google"],"client_visibility": ["open", "restricted"],"company_role": ["owner", "admin", "member"],"company_status": ["active", "suspended"],"member_status": ["active", "deactivated"],"model_tier": ["fast", "balanced", "advanced"]
          }
        }
} as const
