import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'HummyTummy Landing',
    timestamp: new Date().toISOString(),
  });
}
