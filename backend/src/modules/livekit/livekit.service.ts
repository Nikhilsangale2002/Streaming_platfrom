import { AccessToken, WebhookReceiver, type VideoGrant, type WebhookEvent } from "livekit-server-sdk";
import { env } from "../../config/env";

export interface GenerateTokenParams {
  participantId: string;
  participantName: string;
  roomName: string;
  role: "host" | "participant";
}

export interface LiveKitTokenResult {
  token: string;
  serverUrl: string;
  roomName: string;
}

/**
 * Grant matrix (plan.md §7 / CLAUDE.md): the product is live streaming AND
 * group voice chat, so the two roles map onto the two modes. Both can
 * publish audio; only the host also gets video and room-admin rights.
 */
function grantFor(role: "host" | "participant", roomName: string): VideoGrant {
  const base: VideoGrant = {
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  if (role === "host") {
    return { ...base, roomAdmin: true };
  }
  return base;
}

export async function generateToken(params: GenerateTokenParams): Promise<LiveKitTokenResult> {
  const { participantId, participantName, roomName, role } = params;

  // `AccessToken.toJwt()` is async in the current SDK -- awaiting it is not optional.
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: participantId,
    name: participantName,
  });
  at.addGrant(grantFor(role, roomName));

  const token = await at.toJwt();

  return { token, serverUrl: env.LIVEKIT_URL, roomName };
}

const webhookReceiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

/** Throws if the signature is invalid. `rawBody` must be the exact bytes LiveKit sent. */
export function verifyWebhookEvent(rawBody: string, authHeader: string | undefined): Promise<WebhookEvent> {
  return webhookReceiver.receive(rawBody, authHeader);
}
