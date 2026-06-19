import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  // On Railway (and most cloud platforms) request.url is the internal container
  // URL (http://0.0.0.0:8080). Use x-forwarded-host to get the real public origin.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  const siteOrigin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_SITE_URL || origin);

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (toSet) =>
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            ),
        },
      }
    );

    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // For new OAuth accounts that have no profile yet, send them to onboarding.
      // Only do this when redirecting to /dashboard (not when linking accounts).
      if (next === '/dashboard' && data?.user) {
        try {
          const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
          const profilesRes = await fetch(
            `${apiBase}/profiles?user_id=${encodeURIComponent(data.user.id)}`,
            {
              headers: { Authorization: `Bearer ${data.session?.access_token}` },
              signal: AbortSignal.timeout(5000),
            }
          );
          if (profilesRes.ok) {
            const profiles = await profilesRes.json().catch(() => []);
            if (!profiles?.length) {
              return NextResponse.redirect(`${siteOrigin}/onboarding`);
            }
          }
        } catch {
          // If the profile check fails, proceed to dashboard — better than blocking login.
        }
      }

      return NextResponse.redirect(`${siteOrigin}${next}`);
    }
  }

  return NextResponse.redirect(`${siteOrigin}/login?error=auth_callback_failed`);
}
