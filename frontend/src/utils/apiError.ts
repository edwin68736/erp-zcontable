/** Mensaje de error legible desde respuestas axios del backend. */
export function extractApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data;
    if (typeof data?.error === 'string' && data.error.trim()) {
      return data.error.trim();
    }
  }
  if (err instanceof Error) {
    const m = err.message.trim();
    if (m && !m.startsWith('Request failed with status code')) {
      return m;
    }
  }
  return fallback;
}
