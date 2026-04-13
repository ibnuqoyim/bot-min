import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.ts'

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
    if (!config.supabase.url || !config.supabase.serviceKey) {
        throw new Error(
            'Supabase belum dikonfigurasi. Tambahkan NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di bot/.env'
        )
    }
    if (!_client) {
        _client = createClient(config.supabase.url, config.supabase.serviceKey)
    }
    return _client
}
