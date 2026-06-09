import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

const PROTECTED = ['/dashboard', '/profile', '/jobs', '/applications', '/pipeline', '/settings', '/forms', '/onboarding', '/email-drafts', '/integrations'];

export async function middleware(request) {
  const { pathname, searchParams } = request.nextUrl;

  // If Supabase sends ?code= to the wrong page, forward to the callback route
  const code = searchParams.get('code');
  if (code && pathname !== '/auth/callback') {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    url.searchParams.set('code', code);
    url.searchParams.set('next', '/dashboard');
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return response;

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          ),
      },
    });

    const { data: { user } } = await supabase.auth.getUser();
    const { pathname } = request.nextUrl;

    const needsAuth = PROTECTED.some((p) => pathname.startsWith(p));
    if (!user && needsAuth) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (user && (pathname === '/login' || pathname === '/register' || pathname === '/')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  } catch {
    // if Supabase fails, let the request through
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|auth).*)'],
};
