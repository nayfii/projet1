
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_invitation"?: string,"p_token"?: string }; Returns: string
                           },
"admin_update_member":
{ Args: { "p_admin_scopes"?: (string)[],"p_company": string,"p_expertise"?: (string)[],"p_job_title"?: string,"p_role"?: Database["public"]['Enums']["company_role"],"p_status"?: Database["public"]['Enums']["member_status"],"p_team"?: string,"p_user": string }; Returns: undefined
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
"platform_create_company":
{ Args: { "p_name": string,"p_owner_email": string,"p_plan": string }; Returns: {
              "company_id": string,"invitation_id": string,"token": string
            }[]
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
"update_my_member_card":
{ Args: { "p_company": string,"p_expertise": (string)[],"p_job_title": string,"p_opt_out": boolean }; Returns: undefined
                           }
          }
          Enums: {
            "client_visibility": "open"|"restricted","company_role": "owner"|"admin"|"member","company_status": "active"|"suspended","member_status": "active"|"deactivated"
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
            "client_visibility": ["open", "restricted"],"company_role": ["owner", "admin", "member"],"company_status": ["active", "suspended"],"member_status": ["active", "deactivated"]
          }
        }
} as const
