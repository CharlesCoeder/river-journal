export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
  public: {
    Tables: {
      collective_posts: {
        Row: {
          body: string
          created_at: string
          id: string
          is_removed: boolean
          is_user_deleted: boolean
          parent_post_id: string | null
          removed_at: string | null
          removed_reason: string | null
          updated_at: string
          user_deleted_at: string | null
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id: string
          is_removed?: boolean
          is_user_deleted?: boolean
          parent_post_id?: string | null
          removed_at?: string | null
          removed_reason?: string | null
          updated_at?: string
          user_deleted_at?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_removed?: boolean
          is_user_deleted?: boolean
          parent_post_id?: string | null
          removed_at?: string | null
          removed_reason?: string | null
          updated_at?: string
          user_deleted_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'collective_posts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'collective_posts_parent_post_id_fkey'
            columns: ['parent_post_id']
            isOneToOne: false
            referencedRelation: 'collective_posts'
            referencedColumns: ['id']
          },
        ]
      }
      collective_reactions: {
        Row: {
          created_at: string
          id: string
          kind: string
          post_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          post_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          post_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'collective_reactions_post_id_fkey'
            columns: ['post_id']
            isOneToOne: false
            referencedRelation: 'collective_posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'collective_reactions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      collective_reports: {
        Row: {
          created_at: string
          id: string
          note: string | null
          post_id: string
          reason_code: string
          reporter_user_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id: string
          note?: string | null
          post_id: string
          reason_code: string
          reporter_user_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          post_id?: string
          reason_code?: string
          reporter_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'collective_reports_post_id_fkey'
            columns: ['post_id']
            isOneToOne: false
            referencedRelation: 'collective_posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'collective_reports_reporter_user_id_fkey'
            columns: ['reporter_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      daily_entries: {
        Row: {
          created_at: string
          entry_date: string
          id: string
          is_deleted: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          id: string
          is_deleted?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          is_deleted?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'daily_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      flows: {
        Row: {
          content: string
          created_at: string
          daily_entry_id: string
          id: string
          is_deleted: boolean
          updated_at: string
          word_count: number
        }
        Insert: {
          content: string
          created_at?: string
          daily_entry_id: string
          id: string
          is_deleted?: boolean
          updated_at?: string
          word_count?: number
        }
        Update: {
          content?: string
          created_at?: string
          daily_entry_id?: string
          id?: string
          is_deleted?: boolean
          updated_at?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'flows_daily_entry_id_fkey'
            columns: ['daily_entry_id']
            isOneToOne: false
            referencedRelation: 'daily_entries'
            referencedColumns: ['id']
          },
        ]
      }
      trusted_browsers: {
        Row: {
          created_at: string
          device_token_hash: string
          id: string
          label: string
          last_used_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_token_hash: string
          id?: string
          label?: string
          last_used_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_token_hash?: string
          id?: string
          label?: string
          last_used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trusted_browsers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_grace_days: {
        Row: {
          created_at: string
          earned_at: string
          earned_for_milestone: number
          id: string
          is_deleted: boolean
          updated_at: string
          used_for_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          earned_at?: string
          earned_for_milestone: number
          id: string
          is_deleted?: boolean
          updated_at?: string
          used_for_date?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          earned_at?: string
          earned_for_milestone?: number
          id?: string
          is_deleted?: boolean
          updated_at?: string
          used_for_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_grace_days_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      /**
       * users.preferences JSONB documented shape (client-known keys; server tolerates extra):
       *   {
       *     unlockedThemes?: string[]   // ThemeName[]; user-chosen unlock tokens (Model B)
       *     disclosures?: {
       *       collective_post_v1?: { acknowledged_at: string }
       *       ai_cloud_v1?:        { acknowledged_at: string }   // reserved (Growth phase)
       *     }
       *     // ...other client-extensible keys (e.g. focusMode is local-only on UserProfile, NOT server-persisted today)
       *   }
       *
       * The Database['public']['Tables']['users'].Row.preferences field stays typed as `Json`
       * (any-shape) to avoid coupling the generated Database type to a hand-curated client shape.
       * The ThemeName[] / disclosures narrowing happens at the consumer site in
       * `state/types.ts` UserProfile (disclosures wiring lands when the disclosure
       * primitive is added in a follow-up).
       */
      users: {
        Row: {
          created_at: string
          encryption_mode: Database['public']['Enums']['encryption_mode'] | null
          encryption_salt: string | null
          id: string
          managed_encryption_key: string | null
          preferences: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          encryption_mode?: Database['public']['Enums']['encryption_mode'] | null
          encryption_salt?: string | null
          id: string
          managed_encryption_key?: string | null
          preferences?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          encryption_mode?: Database['public']['Enums']['encryption_mode'] | null
          encryption_salt?: string | null
          id?: string
          managed_encryption_key?: string | null
          preferences?: Json
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_stale_trusted_browsers: { Args: Record<string, never>; Returns: number }
      collective_feed_page: {
        Args: { cursor: string | null; page_size: number }
        Returns: {
          id: string
          user_id: string | null
          parent_post_id: string | null
          body: string
          created_at: string
          is_removed: boolean
          is_user_deleted: boolean
          user_deleted_at: string | null
          mode: 'full' | 'preview'
        }[]
      }
      collective_thread_page: {
        Args: { post_id: string; cursor: string | null; page_size: number }
        Returns: {
          id: string
          user_id: string | null
          parent_post_id: string | null
          body: string
          created_at: string
          is_removed: boolean
          is_user_deleted: boolean
          user_deleted_at: string | null
          mode: 'full' | 'preview'
        }[]
      }
      collective_your_posts_page: {
        Args: { cursor: string | null; page_size: number }
        Returns: {
          id: string
          user_id: string
          parent_post_id: string | null
          body: string
          created_at: string
          is_removed: boolean
          is_user_deleted: boolean
          user_deleted_at: string | null
          reaction_count: number
          descendant_count: number
          tenure_tier: number | null
          mode: 'full'
        }[]
      }
      daily_500_completed_today: { Args: { uid: string }; Returns: boolean }
      delete_my_post: { Args: { post_id: string }; Returns: undefined }
      is_active_suspension: { Args: { uid: string; kind_param: string }; Returns: boolean }
      user_has_password: { Args: never; Returns: boolean }
    }
    Enums: {
      encryption_mode: 'e2e' | 'managed'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      encryption_mode: ['e2e', 'managed'],
    },
  },
} as const
