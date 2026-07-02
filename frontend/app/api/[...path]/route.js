import { NextResponse } from 'next/server';

let _apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
if (!_apiUrl.startsWith('http://') && !_apiUrl.startsWith('https://')) {
  _apiUrl = 'http://' + _apiUrl;
}
const API_URL = _apiUrl.replace(/\/$/, '');

async function proxy(request, { params }) {
  const path = (params.path || []).join('/');
  const url = new URL(request.url);
  const backendUrl = `${API_URL}/${path}${url.search}`;

  const headers = {};
  const auth = request.headers.get('authorization');
  if (auth) headers['authorization'] = auth;
  const ct = request.headers.get('content-type');
  if (ct) headers['content-type'] = ct;

  const init = { method: request.method, headers };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  try {
    const res = await fetch(backendUrl, init);
    const body = await res.arrayBuffer();

    const resHeaders = {};
    const resCt = res.headers.get('content-type');
    if (resCt) resHeaders['content-type'] = resCt;

    return new NextResponse(body, { status: res.status, headers: resHeaders });
  } catch (err) {
    return NextResponse.json(
      { detail: `Backend unreachable (${API_URL}): ${err.message}` },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
