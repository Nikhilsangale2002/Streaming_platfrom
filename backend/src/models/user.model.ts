import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  profileImage?: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser> & { _id: Types.ObjectId };

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [60, "Name must be at most 60 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email is not valid"],
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      // Never returned unless a query opts in with .select("+passwordHash").
      select: false,
    },
    profileImage: { type: String, trim: true },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// No isOnline field: presence is ephemeral and lives in Redis. Persisting it
// would create a second source of truth that drifts whenever a process dies.

export const UserModel: Model<IUser> = model<IUser>("User", userSchema);
