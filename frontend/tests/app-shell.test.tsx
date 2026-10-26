import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppHeader } from "@/components/app-header";

describe("app shell", () => {
  it("renders the product name and primary navigation", () => {
    render(<AppHeader />);

    expect(
      screen.getByRole("link", { name: /autoprofileml/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Datasets" })).toBeInTheDocument();
  });
});
