import { ok } from "../../src/utils/ApiResponse";

describe("ok", () => {
  it("wraps data in the success envelope", () => {
    expect(ok({ id: "1" })).toEqual({
      success: true,
      message: "OK",
      data: { id: "1" },
    });
  });

  it("accepts a custom message", () => {
    expect(ok(null, "Room created").message).toBe("Room created");
  });
});
