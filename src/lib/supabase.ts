import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Server-only client — never import this in client components.
// Uses the service-role key; RLS is intentionally disabled (five friends).
export const db = createClient(url, key, {
  auth: { persistSession: false },
});
