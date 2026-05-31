import { NextResponse } from 'next/server';

/**
 * v2.8.98 — landing-side proxy to the backend's public contact
 * endpoint. Keeps the landing origin out of the backend's CORS
 * allowlist and gives us one place to log inbound contact rates
 * before they hit the backend's @Throttle({3/hr}) gate.
 *
 * Request body shape:
 *   { name, email, phone?, message, website? (honeypot) }
 *
 * Validation:
 *   - Honeypot: `website` must be empty (silent 200 if not — drop)
 *   - All other validation runs server-side at the backend pipeline;
 *     the form's client-side checks are convenience.
 */
export async function POST(req: Request) {
  const apiBase = process.env.BACKEND_API_URL?.replace(/\/+$/, '') ??
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ??
    '';
  if (!apiBase) {
    return NextResponse.json(
      { message: 'Contact endpoint not configured' },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  // Silent honeypot — return 200 so spam bots see "success" and don't
  // retry, but DO NOT forward to the backend.
  if (typeof body.website === 'string' && body.website.length > 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Forward to backend's public contact endpoint. The Throttle({3/hr})
  // gate there is the real defense; this proxy just translates the
  // origin.
  try {
    const upstream = await fetch(`${apiBase}/api/contact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Forward the client IP via the same shape backend's @ip
        // resolver already understands (X-Forwarded-For chain).
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify({
        name: body.name,
        email: body.email,
        phone: body.phone,
        message: body.message,
      }),
    });

    const upstreamBody = await upstream.json().catch(() => ({}));
    return NextResponse.json(upstreamBody, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { message: 'Failed to reach contact endpoint' },
      { status: 502 },
    );
  }
}
