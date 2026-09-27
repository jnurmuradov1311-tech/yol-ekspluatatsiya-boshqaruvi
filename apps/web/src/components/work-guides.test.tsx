import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkGuide, WorkGuideInput } from "@/lib/api/work-guides";

const mocks = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: { workGuides: mocks.list, addWorkGuide: mocks.add, deleteWorkGuide: mocks.remove }, ApiError: class extends Error {} }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { division: { id: "division-1" } } }) }));
import { WorkGuides } from "./work-guides";

const guide: WorkGuide = { id: "guide-1", workVariantId: "work-1", roadUnitId: "division-1", title: "Belgini o‘rnatish", kind: "DOCUMENT", sourceType: "FILE", contentType: "application/pdf", fileName: "Yoriqnoma.pdf", byteSize: 10, url: "/api/v1/work-guides/guide-1/content?roadUnitId=division-1", createdAt: "2026-09-28T00:00:00+05:00" };
let items: WorkGuide[];

beforeEach(() => {
  vi.clearAllMocks();
  items = [];
  mocks.list.mockImplementation(async () => ({ items: [...items], canManage: true }));
  mocks.add.mockImplementation(async (input: WorkGuideInput) => {
    const value: WorkGuide = { ...guide, title: input.title, kind: input.kind, sourceType: input.url ? "LINK" : "FILE", url: input.url ?? guide.url, fileName: input.file?.name ?? null };
    items = [value];
    return value;
  });
  mocks.remove.mockImplementation(async () => { items = []; return { id: "guide-1", deleted: true }; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function form() {
  render(<WorkGuides workVariantId="work-1" workName="Yo‘l belgisini o‘rnatish" />);
  await userEvent.click(await screen.findByRole("button", { name: "Biriktirish" }));
  await userEvent.type(screen.getByLabelText("Biriktirma nomi"), "Belgini o‘rnatish");
}

describe("Work instructions and videos", () => {
  it("uploads the selected file for the correct work and division, then shows the saved record", async () => {
    await form();
    const file = new File(["%PDF-1.7 test"], "Yoriqnoma.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Fayl", { exact: true }), file);
    // JSDOM required-file validity does not see user-event's FileList. Submit the real form handler.
    fireEvent.submit(screen.getByRole("button", { name: "Saqlash" }).closest("form")!);
    await screen.findByRole("button", { name: "Belgini o‘rnatish" });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith({ workVariantId: "work-1", roadUnitId: "division-1", title: "Belgini o‘rnatish", kind: "DOCUMENT", file, url: undefined });
    expect(screen.queryByLabelText("Biriktirma nomi")).not.toBeInTheDocument();
  });

  it("attaches an HTTPS video link with no stale file", async () => {
    await form();
    await userEvent.upload(screen.getByLabelText("Fayl", { exact: true }), new File(["PDF"], "old.pdf", { type: "application/pdf" }));
    await userEvent.selectOptions(screen.getByLabelText("Turi"), "VIDEO");
    await userEvent.selectOptions(screen.getByLabelText("Qanday biriktiriladi?"), "link");
    await userEvent.type(screen.getByLabelText("HTTPS havola"), "https://videos.example/guide.mp4");
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
    await screen.findByRole("button", { name: "Belgini o‘rnatish" });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith({ workVariantId: "work-1", roadUnitId: "division-1", title: "Belgini o‘rnatish", kind: "VIDEO", file: undefined, url: "https://videos.example/guide.mp4" });
  });

  it.each([false, true])("keeps a backend reader and read-only task view non-editable (readOnly=%s)", async (readOnly) => {
    items = [guide];
    mocks.list.mockResolvedValue({ items, canManage: readOnly });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WorkGuides workVariantId="work-1" readOnly={readOnly} />);
    const link = await screen.findByRole("button", { name: "Belgini o‘rnatish" });
    expect(screen.queryByRole("button", { name: "Biriktirish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /olib tashlash/ })).not.toBeInTheDocument();
    await userEvent.click(link);
    expect(open).toHaveBeenCalledWith(`${window.location.origin}${guide.url}`, "_blank", "noopener,noreferrer");
  });

  it("keeps the entered data and error visible when the API rejects saving", async () => {
    mocks.add.mockRejectedValue(new Error("Fayl serverga yuklanmadi."));
    await form();
    await userEvent.upload(screen.getByLabelText("Fayl", { exact: true }), new File(["PDF"], "Yoriqnoma.pdf", { type: "application/pdf" }));
    fireEvent.submit(screen.getByRole("button", { name: "Saqlash" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Fayl serverga yuklanmadi.");
    expect(screen.getByLabelText("Biriktirma nomi")).toHaveValue("Belgini o‘rnatish");
    expect(screen.queryByRole("button", { name: "Belgini o‘rnatish" })).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before deleting and allows keeping the file", async () => {
    items = [guide];
    render(<WorkGuides workVariantId="work-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Belgini o‘rnatishni olib tashlash" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Qoldirish" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Belgini o‘rnatishni olib tashlash" }));
    await userEvent.click(screen.getByRole("button", { name: "Olib tashlash" }));
    await screen.findByText("Bu ishga hali yo‘riqnoma biriktirilmagan.");
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("guide-1", "division-1");
  });

  it("preserves a guide when deleting fails", async () => {
    items = [guide];
    mocks.remove.mockRejectedValue(new Error("Olib tashlashga ruxsat yo‘q."));
    render(<WorkGuides workVariantId="work-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Belgini o‘rnatishni olib tashlash" }));
    await userEvent.click(screen.getByRole("button", { name: "Olib tashlash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Olib tashlashga ruxsat yo‘q.");
    expect(screen.getByRole("button", { name: "Belgini o‘rnatish" })).toBeInTheDocument();
  });

  it("rejects non-HTTPS links and file types that do not match the chosen guide kind", async () => {
    await form();
    await userEvent.selectOptions(screen.getByLabelText("Qanday biriktiriladi?"), "link");
    await userEvent.type(screen.getByLabelText("HTTPS havola"), "http://videos.example/guide.mp4");
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTPS");
    expect(mocks.add).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("Qanday biriktiriladi?"), "file");
    const file = screen.getByLabelText("Fayl", { exact: true });
    fireEvent.change(file, { target: { files: [new File(["video"], "wrong.mp4", { type: "video/mp4" })] } });
    fireEvent.submit(file.closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("PDF, JPEG, PNG yoki WebP"));
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
