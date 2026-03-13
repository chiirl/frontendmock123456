const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const table = process.env.SUPABASE_TABLE || 'beta_chiirl_events';

function toTags(techCategory) {
  if (!techCategory) return [];
  return [...new Set(String(techCategory).split('|').map((x) => x.trim()).filter(Boolean))];
}

async function run() {
  const { error: tagsColErr } = await supabase.from(table).select('tags').limit(1);
  if (tagsColErr) {
    throw new Error('Missing tags column. Run sql/add_tags_column.sql in Supabase SQL Editor first.');
  }

  const { data, error } = await supabase
    .from(table)
    .select('id,tech_category,tags')
    .order('id', { ascending: true });
  if (error) throw new Error(error.message);

  const updates = data
    .filter((row) => !Array.isArray(row.tags) || row.tags.length === 0)
    .map((row) => ({ id: row.id, tags: toTags(row.tech_category) }))
    .filter((row) => row.tags.length > 0);

  if (updates.length === 0) {
    console.log('No rows needed backfill.');
    return;
  }

  const { error: upErr } = await supabase.from(table).upsert(updates, { onConflict: 'id' });
  if (upErr) throw new Error(upErr.message);

  console.log(`Backfilled tags for ${updates.length} rows.`);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
