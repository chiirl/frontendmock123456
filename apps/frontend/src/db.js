const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const supabaseReadKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!process.env.SUPABASE_URL || !supabaseReadKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
}

const supabase = createClient(process.env.SUPABASE_URL, supabaseReadKey);
const EVENTS_TABLE_NAME = process.env.SUPABASE_TABLE || 'beta_chiirl_events';

module.exports = { supabase, EVENTS_TABLE_NAME };
