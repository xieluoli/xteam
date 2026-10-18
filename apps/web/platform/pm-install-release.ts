import { z } from "zod";

const skillNames = ["cn-commit", "pmspec-apply", "pmspec-explore", "pmspec-init", "pmspec-propose", "pmspec-review"];
const publishedPmRelease = z.object({
  url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password &&
      !url.search && !url.hash && /^\/xieluoli\/xteam\/releases\/download\/[^/]+\/[^/]+\.tar\.gz$/.test(url.pathname);
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.string().min(1),
  instructions: z.string().min(1),
  skillNames: z.array(z.string()).refine(names => names.length === skillNames.length && skillNames.every(name => names.includes(name))),
});

/** No publication config means no working-looking links to nonexistent assets. */
export function readPmInstallRelease(value: string | undefined) {
  if (!value) return undefined;
  try {
    const result = publishedPmRelease.safeParse(JSON.parse(value));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
