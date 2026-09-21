import assert from "node:assert/strict";
import test from "node:test";
import { PostizRequestError } from "../postiz/postiz.client";
import { isLengthRejection } from "./length-rejection";

test("recognizes X error code 186 as a length rejection", () => {
  const error = new PostizRequestError(
    400,
    '{"errors":[{"code":186,"message":"Tweet needs to be a bit shorter."}]}',
  );
  assert.equal(isLengthRejection(error), true);
});

test("recognizes plain-text length complaints", () => {
  assert.equal(
    isLengthRejection(new PostizRequestError(400, "post content is too long")),
    true,
  );
});

test("does not treat unrelated 4xx failures as length rejections", () => {
  assert.equal(
    isLengthRejection(
      new PostizRequestError(401, '{"errors":[{"code":32,"message":"Could not authenticate you"}]}'),
    ),
    false,
  );
});

test("ignores server errors and non-Postiz failures", () => {
  assert.equal(
    isLengthRejection(new PostizRequestError(503, "too long upstream timeout")),
    false,
  );
  assert.equal(isLengthRejection(new Error("postiz 400")), false);
});
