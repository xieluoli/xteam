import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createLandingDict } from "../i18n/dictionary";
import { LandingHero } from "./landing-hero";
import { LandingFooter } from "./landing-footer";

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));
vi.mock("../utils/use-dashboard-cta", () => ({ useDashboardCtaHref: () => "/login" }));
vi.mock("../i18n", async () => ({
  ...await vi.importActual("../i18n"),
  useLocale: () => ({ t: createLandingDict("en", true), locale: "en", setLocale: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));

describe("web-only landing entrypoints", () => {
  it("opens the web login without offering native downloads in the hero", () => {
    render(<LandingHero />);
    expect(screen.getByRole("link", { name: "Open app" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("keeps footer navigation on surviving pages", () => {
    render(<LandingFooter />);
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute("href", "/docs");
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });
});
