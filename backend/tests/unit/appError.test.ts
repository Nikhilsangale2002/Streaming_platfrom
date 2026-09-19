import { AppError } from "../../src/utils/AppError";

describe("AppError", () => {
  it("carries a code, message and status", () => {
    const error = new AppError("ROOM_NOT_FOUND", "Room not found", 404);

    expect(error.code).toBe("ROOM_NOT_FOUND");
    expect(error.message).toBe("Room not found");
    expect(error.status).toBe(404);
  });

  it("defaults to status 400", () => {
    expect(new AppError("BAD_INPUT", "Bad input").status).toBe(400);
  });

  it("is an instance of Error and of AppError", () => {
    const error = new AppError("X", "x");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });
});
