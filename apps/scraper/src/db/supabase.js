const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function getReadKey() {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY
  );
}

function getWriteKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function requireEnv(key) {
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error('Missing SUPABASE_URL or Supabase key in environment');
  }
}

function createReadClient() {
  const key = getReadKey();
  requireEnv(key);
  return createClient(process.env.SUPABASE_URL, key);
}

function createWriteClient() {
  const key = getWriteKey();
  requireEnv(key);
  return createClient(process.env.SUPABASE_URL, key);
}

function getEventsTable() {
  return process.env.SUPABASE_TABLE || 'beta_chiirl_events';
}

module.exports = {
  createReadClient,
  createWriteClient,
  getEventsTable
};
