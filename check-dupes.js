const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseReadKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supabaseReadKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
}
const supabase = createClient(process.env.SUPABASE_URL, supabaseReadKey);
const TABLE_NAME = process.env.SUPABASE_TABLE || 'CTC Current Events';

async function check() {
  const { data } = await supabase.from(TABLE_NAME).select('*');
  const titles = data.map(e => e.title);
  const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
  console.log('Total rows:', data.length);
  console.log('Unique titles:', new Set(titles).size);
  console.log('Duplicate titles:', [...new Set(dupes)].length);
  console.log('Sample dupes:', [...new Set(dupes)].slice(0, 5));
}

check();
