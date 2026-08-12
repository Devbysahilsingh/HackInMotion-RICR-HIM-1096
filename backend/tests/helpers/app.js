/**
 * HTTP test client.
 *
 * The app is bound to an ephemeral port and driven with the platform `fetch`
 * rather than Supertest. That keeps the request path identical to production
 * — real sockets, real headers, real CORS preflight handling — and adds no
 * dependency to a project whose dependency list is deliberately locked.
 */
import { createApp } from '../../src/app.js';

/**
 * @returns {Promise<{ url: string, request: Function, close: () => Promise<void> }>}
 */
export async function startTestServer(app = createApp()) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown, token?: string, headers?: Record<string,string>, raw?: string }} [options]
   */
  async function request(path, options = {}) {
    const { method = 'GET', body, token, headers = {}, raw } = options;

    const finalHeaders = { ...headers };
    let payload;

    // fetch throws outright if a GET or HEAD carries a body. Matrix-driven
    // suites pass one sample body per route regardless of method, so drop it
    // here rather than making every caller special-case the verb.
    const allowsBody = !['GET', 'HEAD'].includes(method.toUpperCase());

    if (raw !== undefined && allowsBody) {
      payload = raw;
      finalHeaders['Content-Type'] ??= 'application/json';
    } else if (body !== undefined && allowsBody) {
      payload = JSON.stringify(body);
      finalHeaders['Content-Type'] = 'application/json';
    }

    if (token) finalHeaders.Authorization = `Bearer ${token}`;

    const response = await fetch(`${url}${path}`, { method, headers: finalHeaders, body: payload });

    // Bodyless responses (204) and non-JSON error pages must not throw here —
    // several assertions are specifically about what the body is *not*.
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { status: response.status, headers: response.headers, body: json, text };
  }

  return {
    url,
    request,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
