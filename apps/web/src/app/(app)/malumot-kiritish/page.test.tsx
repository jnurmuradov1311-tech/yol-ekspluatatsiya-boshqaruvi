import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), reload: vi.fn(), options: {
  roads: [{ id: "road-1", code: "D001", name: "Halqa yo‘li", lengthM: 3000, divisionName: "1-bo‘lim" }, { id: "road-2", code: "D002", name: "Ikkinchi yo‘l", lengthM: 3000, divisionName: "1-bo‘lim" }],
  roadElements: [{ id: "stop-1", roadId: "road-1", elementType: "BUS_STOP", name: "Avtobus bekati", chainageStartM: 1200, chainageEndM: null, attributes: {} }],
  defectTypes: [{ id: "stop-dirty", name: "Bekat ifloslangan", code: "field.stop.dirty", unit: "unit" }],
  workTopics: [], measurementUnits: [{ value: "unit", label: "dona" }, { value: "m2", label: "kvadrat metr" }],
} }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { permissions: ["system.all"] } }), useHasPermission: () => true }));
vi.mock("@/lib/api/client", () => ({ api: { submitInspection: mocks.submit, manualInspectionOptions: () => undefined, manualInspections: () => undefined } }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: (_fetcher: unknown, key: string) => ({ data: key === "manual-inspection-options" ? mocks.options : { items: [], total: 0 }, loading: false, error: null, reload: mocks.reload }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.submit.mockResolvedValue({ id: "inspection-1" }); });
afterEach(cleanup);

describe("inventory-backed inspection form", () => {
  it("requires the element, caps its quantity and sends its identity to the server", async () => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Nuqson turi"), { target: { value: "stop-dirty" } });
    expect(screen.getByRole("button", { name: "Qoralamani saqlash" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Yo‘l elementi"), { target: { value: "stop-1" } });
    expect(screen.getByLabelText("Lokatsiya")).toHaveValue(1200);
    const quantity = screen.getByLabelText(/O‘lchangan nuqson hajmi/);
    expect(quantity).toHaveAttribute("max", "1");
    expect(quantity).toHaveAttribute("step", "1");
    fireEvent.change(screen.getByLabelText("Aniqlangan nuqson"), { target: { value: "Bekatda chiqindi bor" } });
    fireEvent.change(screen.getByLabelText("Ko‘rik sanasi"), { target: { value: "2026-09-27" } });
    fireEvent.change(quantity, { target: { value: "10" } });
    fireEvent.submit(quantity.closest("form")!);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("1 dona");
    fireEvent.change(quantity, { target: { value: "1" } });
    fireEvent.submit(quantity.closest("form")!);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0]![0]).toMatchObject({ roadId: "road-1", roadElementId: "stop-1", chainageStartM: "1200", exactQuantity: "1", unit: "unit" });
  });
  it("clears a selected element and location when changing the road", () => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Nuqson turi"), { target: { value: "stop-dirty" } });
    fireEvent.change(screen.getByLabelText("Yo‘l elementi"), { target: { value: "stop-1" } });
    fireEvent.change(screen.getByLabelText("Biriktirilgan yo‘l"), { target: { value: "road-2" } });
    expect(screen.getByLabelText("Yo‘l elementi")).toHaveValue("");
    expect(screen.getByLabelText("Lokatsiya")).toHaveValue(null);
    expect(screen.queryByRole("option", { name: /Avtobus bekati/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Qoralamani saqlash" })).toBeDisabled();
  });
});
