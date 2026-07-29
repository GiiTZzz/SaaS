import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { checkDispatchAccess } from "../src/lib/auth";

const originalToken = process.env.DISPECR_DISPATCH_TOKEN;
const originalEnv = process.env.NODE_ENV;

// NODE_ENV is typed read-only; these tests need to drive both branches.
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (originalToken === undefined) delete process.env.DISPECR_DISPATCH_TOKEN;
  else process.env.DISPECR_DISPATCH_TOKEN = originalToken;
  env.NODE_ENV = originalEnv;
});

describe("dispatch access", () => {
  it("accepts the configured token", () => {
    process.env.DISPECR_DISPATCH_TOKEN = "s3cret";
    assert.equal(checkDispatchAccess("s3cret").ok, true);
  });

  it("rejects a wrong token", () => {
    process.env.DISPECR_DISPATCH_TOKEN = "s3cret";
    assert.equal(checkDispatchAccess("wrong!").ok, false);
  });

  it("rejects a token that is merely a prefix of the real one", () => {
    process.env.DISPECR_DISPATCH_TOKEN = "s3cret";
    assert.equal(checkDispatchAccess("s3c").ok, false);
  });

  it("rejects a missing token", () => {
    process.env.DISPECR_DISPATCH_TOKEN = "s3cret";
    assert.equal(checkDispatchAccess(undefined).ok, false);
    assert.equal(checkDispatchAccess(null).ok, false);
    assert.equal(checkDispatchAccess("").ok, false);
  });

  it("stays open in development when no token is configured", () => {
    delete process.env.DISPECR_DISPATCH_TOKEN;
    env.NODE_ENV = "development";
    assert.equal(checkDispatchAccess(undefined).ok, true);
  });

  it("locks itself in production when no token is configured", () => {
    // Failing closed matters here: the dispatch side exposes customer names,
    // phone numbers and addresses.
    delete process.env.DISPECR_DISPATCH_TOKEN;
    env.NODE_ENV = "production";
    const result = checkDispatchAccess(undefined);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /DISPECR_DISPATCH_TOKEN/);
  });
});
