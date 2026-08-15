import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./ui";

describe("Button", () => {
  it("busy holatda disabled=false berilgan bo‘lsa ham takroriy bosishni bloklaydi", () => {
    render(<Button busy disabled={false}>Saqlash</Button>);

    const button = screen.getByRole("button", { name: "Saqlash" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
