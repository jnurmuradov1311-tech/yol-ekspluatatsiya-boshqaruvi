"use client";

import { useId, useState } from "react";
import { matchesSearch } from "@/lib/search";
import type { ManualInspectionOptions } from "@/lib/api/types";

type DefectType = NonNullable<ManualInspectionOptions["defectTypes"]>[number];

export function DefectTypePicker({ options, value, onChange }: { options: DefectType[]; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = options.filter((option) => matchesSearch(query, option.name, option.code));
  function choose(option: DefectType) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  }
  return <div className="field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label className="field__label" htmlFor={id}>Nuqson turi</label>
    <input id={id} className="input" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined} autoComplete="off" placeholder="Masalan, chuqur, yoriq yoki belgi" value={selected && !open ? selected.name : query} required onFocus={() => { setOpen(true); setQuery(selected?.name ?? query); setActive(0); }} onChange={(event) => { setQuery(event.target.value); onChange(""); setOpen(true); setActive(0); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((current) => Math.min(current + 1, matches.length - 1)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(0, current - 1)); }
      if (event.key === "Enter" && open) { event.preventDefault(); if (matches[active]) choose(matches[active]); }
      if (event.key === "Escape") { setOpen(false); setQuery(""); }
    }} />
    {open ? <div role="listbox" id={`${id}-list`} aria-label="Nuqson turlari" style={{ maxHeight: 240, overflowY: "auto" }}>
      {matches.map((option, index) => <button className="button button--secondary" type="button" role="option" id={`${id}-${option.id}`} aria-selected={option.id === value} key={option.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4, outline: index === active ? "2px solid currentColor" : undefined, outlineOffset: -2 }}>{option.name}</button>)}
      {!matches.length ? <p role="status">Nuqson topilmadi. Boshqa so‘z bilan qidiring.</p> : null}
    </div> : null}
  </div>;
}
