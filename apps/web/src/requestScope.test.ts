import { describe, expect, it } from "vitest";
import { RequestScope } from "./requestScope";

describe("account-scoped asynchronous requests", () => {
  it("drops a response that resolves after logout even when a transport ignores abort", async () => {
    const scope = new RequestScope();
    let currentAccount = "owner-a";
    const request = scope.begin(currentAccount);
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => {
      resolve = done;
    });
    const applied: string[] = [];
    const task = response.then((value) => {
      if (scope.current(request, currentAccount)) applied.push(value);
    });
    currentAccount = "anonymous";
    scope.invalidate();
    resolve("owner-a private state");
    await task;
    expect(request.signal.aborted).toBe(true);
    expect(applied).toEqual([]);
  });

  it("rejects the previous owner before effect cleanup and accepts the new owner's request", () => {
    const scope = new RequestScope();
    const previous = scope.begin("owner-a");
    expect(scope.current(previous, "owner-b")).toBe(false);
    scope.invalidate();
    const next = scope.begin("owner-b");
    expect(scope.current(next, "owner-b")).toBe(true);
    expect(scope.current(previous, "owner-a")).toBe(false);
    scope.release(next);
  });

  it("closing and reopening the same account does not revive an old installation request", () => {
    const scope = new RequestScope();
    const previous = scope.begin("open:owner-a");
    scope.invalidate();
    const reopened = scope.begin("open:owner-a");
    expect(scope.current(previous, "open:owner-a")).toBe(false);
    expect(scope.current(reopened, "open:owner-a")).toBe(true);
    scope.release(reopened);
  });
});
