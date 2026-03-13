/**
 * Proxy client for calling the devportal Canton proxy API.
 * Replaces direct Canton JSON API and Splice wallet API connections.
 */

export interface ProxyExerciseResult {
  exerciseResult: unknown;
  events?: Array<{ contractId: string; templateId: string; payload: Record<string, unknown> }>;
}

export interface ProxyContract {
  contractId: string;
  templateId: string;
  payload: Record<string, unknown>;
}

async function proxyFetch<T>(url: string, apiKey: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Proxy API ${res.status}: ${errText}`);
  }

  const data = await res.json() as { success: boolean; data?: T; error?: string };
  if (!data.success) {
    throw new Error(data.error || 'Proxy request failed');
  }
  return data.data as T;
}

export async function proxyQuery(
  baseUrl: string,
  apiKey: string,
  templateId: string,
  filter?: Record<string, unknown>,
): Promise<ProxyContract[]> {
  return proxyFetch<ProxyContract[]>(`${baseUrl}/query`, apiKey, { templateId, filter });
}

export async function proxyExercise(
  baseUrl: string,
  apiKey: string,
  contractId: string,
  templateId: string,
  choice: string,
  argument: Record<string, unknown> = {},
): Promise<ProxyExerciseResult> {
  return proxyFetch<ProxyExerciseResult>(`${baseUrl}/exercise`, apiKey, {
    contractId,
    templateId,
    choice,
    argument,
  });
}

export async function proxyCreate(
  baseUrl: string,
  apiKey: string,
  templateId: string,
  payload: Record<string, unknown>,
): Promise<{ contractId: string }> {
  return proxyFetch<{ contractId: string }>(`${baseUrl}/create`, apiKey, { templateId, payload });
}
