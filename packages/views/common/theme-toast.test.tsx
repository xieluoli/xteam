import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Toaster } from "@multica/ui/components/ui/sonner";

const appearance = vi.hoisted(() => ({ resolvedTheme: "japan-blues" }));
vi.mock("next-themes", () => ({ useTheme: () => appearance }));
vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme: string }) => <output>{theme}</output>,
}));

describe("toast appearance", () => {
  it.each([["japan-blues", "light"], ["dark", "dark"], ["light", "light"], ["system", "system"]])("uses a supported toast mode for %s", (selected, mode) => {
    appearance.resolvedTheme = selected;
    render(<Toaster />);
    expect(screen.getByRole("status")).toHaveTextContent(mode);
  });
});
