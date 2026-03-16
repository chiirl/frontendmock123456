# Supabase Magic Link Notes

## Why Auth Works Now

Supabase is currently sending CHIIRL a magic-link callback URL in the default fragment format:

```text
/auth/callback?next=%2Fme#access_token=...&refresh_token=...&type=magiclink
```

That format does not expose the session tokens to the server on the initial HTTP request, because everything after `#` stays in the browser.

Originally, CHIIRL expected a server-readable callback using either:

- `token_hash` in the query string, or
- `code` in the query string

When neither was present, `/auth/callback` failed with:

```text
Auth callback is missing a server-readable token.
```

The app now works because `/auth/callback` contains a browser-side fallback:

1. The browser loads `/auth/callback`.
2. The page reads `window.location.hash`.
3. If it finds `access_token` and `refresh_token`, it `POST`s them to `/auth/callback/session`.
4. The server calls `supabase.auth.setSession(...)`.
5. The server sets CHIIRL's HTTP-only cookies.
6. The user is redirected to `/me`.

This keeps the app working even while Supabase is still sending the old fragment-style link.

Relevant code:

- [index.js](/home/ev/chiirl-supa-hookup/index.js#L466)
- [index.js](/home/ev/chiirl-supa-hookup/index.js#L536)
- [auth.js](/home/ev/chiirl-supa-hookup/auth.js#L61)

## Root Cause

The Supabase Magic Link email/template configuration is still using the default fragment-style auth flow instead of a server-readable callback.

Expected long-term callback shape:

```text
/auth/callback?next=%2Fme&token_hash=...&type=email
```

Actual current callback shape:

```text
/auth/callback?next=%2Fme#access_token=...&refresh_token=...
```

## Clean Fix Later

Update Supabase so the email link sends `token_hash` in the query string.

In Supabase:

1. Go to `Authentication -> URL Configuration`
2. Ensure:
   - `Site URL` is the app origin, for local dev: `http://localhost:3000`
   - Redirect allowlist includes: `http://localhost:3000/auth/callback`

Then update:

1. `Authentication -> Email Templates -> Magic Link`
2. Use a template like:

```html
<h2>Magic Link</h2>
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in to CHIIRL</a></p>
```

This assumes CHIIRL sends:

```text
emailRedirectTo = http://localhost:3000/auth/callback?next=%2Fme
```

Because `{{ .RedirectTo }}` already includes `?next=%2Fme`, the template must append with `&`, not `?`.

## After the Dashboard Fix

Once Supabase is consistently sending `token_hash` or `code` in the query string, the fragment fallback is no longer required for normal operation.

At that point, we can optionally remove the browser bridge from `/auth/callback` and keep the route fully server-side.

There is no urgent need to remove it now. It is a compatibility fallback, not a production blocker.
