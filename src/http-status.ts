/**
 * HTTP server health check for Streamer.bot DoAction HTTP API.
 */

export interface HttpStatusResult {
  available: boolean;
  port: number;
  latency_ms: number;
}

export async function checkHttpServer(host: string, port: number): Promise<HttpStatusResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://${host}:${port}/`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return {
      available: res.ok || res.status === 404 || res.status === 405,
      port,
      latency_ms: Date.now() - start,
    };
  } catch {
    return { available: false, port, latency_ms: Date.now() - start };
  }
}
