const { createClient } = require('@supabase/supabase-js');

const ACCESS_COOKIE = 'chiirl-access-token';
const REFRESH_COOKIE = 'chiirl-refresh-token';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const PROFILES_TABLE = 'ctc_v2_profiles';

function getPublicKey() {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY
  );
}

function getWriteKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function requireEnv() {
  if (!process.env.SUPABASE_URL || !getPublicKey()) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
  }
}

function createSupabaseClient(key) {
  requireEnv();
  return createClient(process.env.SUPABASE_URL, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

function createPublicClient() {
  return createSupabaseClient(getPublicKey());
}

function createAdminClient() {
  const writeKey = getWriteKey();
  if (!writeKey) {
    throw new Error('Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY for profile writes');
  }
  return createSupabaseClient(writeKey);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return;
      const key = decodeURIComponent(part.slice(0, idx).trim());
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      out[key] = value;
    });
  return out;
}

function serializeCookie(name, value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function setSessionCookies(res, session) {
  if (!session?.access_token || !session?.refresh_token) return;
  res.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, session.access_token, ONE_YEAR_SECONDS),
    serializeCookie(REFRESH_COOKIE, session.refresh_token, ONE_YEAR_SECONDS)
  ]);
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, '', 0),
    serializeCookie(REFRESH_COOKIE, '', 0)
  ]);
}

function deriveDisplayName(user) {
  const metaName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name;
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  const email = String(user?.email || '').trim();
  if (!email) return 'CHIIRL User';
  return email.split('@')[0];
}

async function ensureProfile(user) {
  if (!user?.id) return null;
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from(PROFILES_TABLE)
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const insert = {
    id: user.id,
    email: user.email,
    display_name: deriveDisplayName(user),
    profile_type: 'person',
    avatar_url: user.user_metadata?.avatar_url || null
  };

  const { data: created, error: insertError } = await admin
    .from(PROFILES_TABLE)
    .insert(insert)
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

async function getProfile(userId) {
  if (!userId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(PROFILES_TABLE)
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateProfile(userId, updates) {
  const admin = createAdminClient();
  const payload = {};
  if (typeof updates.display_name === 'string') {
    payload.display_name = updates.display_name.trim();
  }
  if (typeof updates.username === 'string') {
    const username = updates.username.trim().toLowerCase();
    payload.username = username || null;
  }
  if (!Object.keys(payload).length) {
    return getProfile(userId);
  }
  const { data, error } = await admin
    .from(PROFILES_TABLE)
    .update(payload)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getSessionContext(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!accessToken || !refreshToken) {
    return { user: null, profile: null };
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (error || !data?.session?.user) {
    clearSessionCookies(res);
    return { user: null, profile: null };
  }

  if (
    data.session.access_token !== accessToken ||
    data.session.refresh_token !== refreshToken
  ) {
    setSessionCookies(res, data.session);
  }

  let profile = null;
  try {
    profile = await getProfile(data.session.user.id);
  } catch {
    profile = null;
  }

  return { user: data.session.user, profile };
}

module.exports = {
  clearSessionCookies,
  createAdminClient,
  createPublicClient,
  ensureProfile,
  getSessionContext,
  setSessionCookies,
  updateProfile
};
