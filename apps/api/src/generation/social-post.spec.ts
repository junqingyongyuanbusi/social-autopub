import assert from "node:assert/strict";
import test from "node:test";
import {
  composeSocialPost,
  exposureReviewLinkProblem,
  measurePlatformContent,
  platformLimit,
  publicPublishUrl,
  systemSuffix,
} from "./social-post";
import { validateForPlatform } from "./validators";

const baseItem = {
  source: "notion",
  sourceTableType: "exposure-review",
  publishLink: "https://example.com/reviews/item?source=example.com#section",
  language: "en",
  contentType: "review",
};

test("converts only the hostname .com suffix and preserves URL components", () => {
  assert.equal(
    publicPublishUrl(baseItem.publishLink),
    "https://example.me/reviews/item?source=example.com#section",
  );
});

test("uses localized CTA by article type", () => {
  assert.equal(systemSuffix(baseItem).startsWith("Full Review: "), true);
  assert.equal(
    systemSuffix({ ...baseItem, language: "zh-cn", contentType: "exposure" }).startsWith(
      "完整报告: ",
    ),
    true,
  );
});

test("reports missing and invalid links without affecting other sources", () => {
  assert.match(exposureReviewLinkProblem({ ...baseItem, publishLink: null }) ?? "", /缺失/);
  assert.match(
    exposureReviewLinkProblem({ ...baseItem, publishLink: "not a url" }) ?? "",
    /格式无效/,
  );
  assert.match(
    exposureReviewLinkProblem({
      ...baseItem,
      publishLink: "https://user:secret@example.com/report",
    }) ?? "",
    /用户名或密码/,
  )
  assert.equal(
    exposureReviewLinkProblem({ ...baseItem, sourceTableType: "news-edu", publishLink: null }),
    null,
  );
});

test("X counts short and long URLs using the same t.co transformed length", () => {
  const short = measurePlatformContent("x", "Read https://x.co/a");
  const long = measurePlatformContent(
    "x",
    "Read https://example.com/a/very/long/path/that/should/not/count/literally?query=long",
  );
  assert.equal(short, long);
});

test("validates composed CJK content and ignores URL fragments when counting hashtags", () => {
  const body = "重要なレビューです #one #two";
  const composed = composeSocialPost("x", body, {
    ...baseItem,
    language: "ja",
  });
  assert.equal(validateForPlatform("x", composed.content, body).some((p) => p.includes("hashtag")), false);
  assert.ok(composed.measuredLength > body.length);
});

test("does not count URL fragments in editable body as hashtags", () => {
  const body = "Read https://example.com/report#section #one #two";
  assert.equal(
    validateForPlatform("x", composeSocialPost("x", body, baseItem).content, body).some(
      (problem) => problem.includes("hashtag"),
    ),
    false,
  );
});

test("optimistically allows long posts for accounts that have not been probed", () => {
  const body = "界".repeat(150); // 加权 300
  assert.equal(platformLimit("x", null), 4000);
  assert.equal(
    validateForPlatform("x", body, body, null).some((problem) =>
      problem.includes("超出 X 长度限制"),
    ),
    false,
  );
});

test("keeps the 280 limit once an account is known to be free-tier", () => {
  const body = "界".repeat(150); // 加权 300
  assert.equal(platformLimit("x", 280), 280);
  assert.match(
    validateForPlatform("x", body, body, 280).join(""),
    /超出 X 长度限制（加权 \d+\/280）/,
  );
});

test("honors the account text limit for subscription accounts", () => {
  const body = "界".repeat(150); // 加权 300，低于订阅账号上限
  assert.equal(platformLimit("x", 4000), 4000);
  assert.equal(
    validateForPlatform("x", body, body, 4000).some((problem) =>
      problem.includes("超出 X 长度限制"),
    ),
    false,
  );
});
