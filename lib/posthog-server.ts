import { PostHog } from "posthog-node";

/**
 * Returns a server side PostHog client, or null when analytics is not configured.
 *
 * This must never throw. It is called from inside request handlers, including the
 * paid voice session route, where a thrown analytics error gets swallowed by the
 * surrounding catch and looks exactly like the feature itself failing.
 */
export function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!token) return null;
  try {
    return new PostHog(token, { host, flushAt: 1, flushInterval: 0 });
  } catch {
    return null;
  }
}

/**
 * Fire and forget event capture. Swallows every failure on purpose so analytics
 * can never take a feature down or add latency to a failed request path.
 */
export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties });
    await client.shutdown();
  } catch {
    // Analytics is best effort. Never surface this to the caller.
  }
}
