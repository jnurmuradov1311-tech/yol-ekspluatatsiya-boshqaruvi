import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ login: mocks.login, ready: true, user: null }),
}));

describe("login TOTP flow", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.replace.mockReset();
  });

  it("requests and submits a six digit authenticator code", async () => {
    const operator = userEvent.setup();
    mocks.login
      .mockResolvedValueOnce({ mfaRequired: true })
      .mockResolvedValueOnce({ mfaRequired: false });
    render(<LoginPage />);

    await operator.type(screen.getByLabelText("Elektron pochta"), "mfa@example.uz");
    await operator.type(screen.getByLabelText("Parol"), "secret");
    await operator.click(screen.getByRole("button", { name: "Kirish" }));

    const authenticator = await screen.findByRole("textbox", { name: /Autentifikator kodi/ });
    await operator.type(authenticator, "123456");
    await operator.click(screen.getByRole("button", { name: "Kodni tasdiqlash" }));

    await waitFor(() => expect(mocks.login).toHaveBeenLastCalledWith("mfa@example.uz", "secret", "123456"));
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });
});
