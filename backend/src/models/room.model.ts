import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";
import { DEFAULT_MAX_PARTICIPANTS } from "../config/constants";

export const ROOM_STATUS = { LIVE: "live", ENDED: "ended" } as const;
export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export interface IRoom {
  name: string;
  host: Types.ObjectId;
  status: RoomStatus;
  maxParticipants: number;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type RoomDocument = HydratedDocument<IRoom> & { _id: Types.ObjectId };

const roomSchema = new Schema<IRoom>(
  {
    name: {
      type: String,
      required: [true, "Room name is required"],
      trim: true,
      minlength: [3, "Room name must be at least 3 characters"],
      maxlength: [80, "Room name must be at most 80 characters"],
    },
    host: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Room must have a host"],
      index: true,
    },
    status: {
      type: String,
      enum: { values: Object.values(ROOM_STATUS), message: "{VALUE} is not a valid room status" },
      default: ROOM_STATUS.LIVE,
    },
    maxParticipants: {
      type: Number,
      default: DEFAULT_MAX_PARTICIPANTS,
      min: [2, "A room needs room for at least two people"],
      max: [500, "Rooms are capped at 500 participants"],
    },
    endedAt: { type: Date },
  },
  { timestamps: true },
);

// Serves GET /rooms — active rooms, newest first — without an in-memory sort.
roomSchema.index({ status: 1, createdAt: -1 });

// No participants array and no participantCount: Redis owns live membership,
// and both values are computed into the response DTO at read time.

export const RoomModel: Model<IRoom> = model<IRoom>("Room", roomSchema);
