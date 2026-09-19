import { z } from "zod";

// Matches the brief's documented request shape (userId, roomName, role) for
// compatibility -- but userId is checked against the verified JWT, never
// trusted on its own. See livekit.controller.ts.
export const tokenRequestSchema = z.object({
  userId: z.string().min(1),
  roomName: z.string().min(1),
  role: z.enum(["host", "participant"]).optional(),
});
export type TokenRequestInput = z.infer<typeof tokenRequestSchema>;
