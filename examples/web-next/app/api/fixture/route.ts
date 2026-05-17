import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);

  return NextResponse.json({
    ok: true,
    plan: url.searchParams.get('plan'),
    receivedPlan: typeof body === 'object' && body !== null ? (body as { plan?: unknown }).plan : null,
  });
}
