// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readPmInstallRelease } from "./pm-install-release";

const release = {
  url: "https://github.com/xieluoli/xteam/releases/download/pm-v1/pm-demo.tar.gz",
  sha256: "a".repeat(64), version: "snapshot-v1", instructions: "Public PM rules",
  skillNames: ["cn-commit", "pmspec-init", "pmspec-explore", "pmspec-propose", "pmspec-apply", "pmspec-review"],
};
describe("published PM install metadata", () => {
  it("keeps Copy unavailable until a release is explicitly configured", () => {
    expect(readPmInstallRelease(undefined)).toBeUndefined();
    expect(readPmInstallRelease("{}")).toBeUndefined();
    expect(readPmInstallRelease("invalid")).toBeUndefined();
  });
  it("accepts fixed Github releases and strips unrelated private configuration", () => {
    expect(readPmInstallRelease(JSON.stringify({ ...release, token: "do-not-forward" }))).toEqual(release);
  });
  it.each([
    { url: "https://evil.invalid/archive.tar.gz" },
    { url: "https://github.com/xieluoli/xteam/releases/latest/download/pm-demo.tar.gz" },
    { url: "https://token@github.com/xieluoli/xteam/releases/download/pm-v1/pm-demo.tar.gz" },
    { url: release.url + "?token=private" },
    { sha256: "not-a-checksum" },
    { skillNames: ["pmspec-explore"] },
  ])("rejects malformed or unpinned deployment metadata: %s", change => {
    expect(readPmInstallRelease(JSON.stringify({ ...release, ...change }))).toBeUndefined();
  });
});
