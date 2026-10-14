import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "@multica/ui/components/common/theme-provider";
import { ThemeProvider } from "./theme-provider";

vi.stubGlobal("matchMedia", () => ({
  matches: false, media: "(prefers-color-scheme: dark)",
  addListener: vi.fn(), removeListener: vi.fn(),
}));

function Appearance() {
  const { theme, themes, setTheme } = useTheme();
  return <>
    <output>{theme}</output>
    {themes.map((value) => <button key={value} onClick={() => setTheme(value)}>{value}</button>)}
  </>;
}

afterEach(() => {
  cleanup();
  localStorage.removeItem("theme");
  document.documentElement.className = "";
});

describe("web appearance", () => {
  it("adds Japan Blues without changing the system default and persists the choice", async () => {
    render(<ThemeProvider><Appearance /></ThemeProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("system");
    fireEvent.click(screen.getByRole("button", { name: "japan-blues" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("japan-blues"));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("japan-blues");
    cleanup();
    render(<ThemeProvider><Appearance /></ThemeProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("japan-blues");
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(document.documentElement).not.toHaveClass("japan-blues");
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("light"));
  });
});
