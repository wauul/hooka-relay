"use client";

import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type Props = { id?: string; name?: string; label: string; value?: string; onChange?: (value: string) => void };
const pad = (value: number) => String(value).padStart(2, "0");
const localValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const displayValue = (value: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Select date and time";

export function DateTimePicker({ id, name, label, value, onChange }: Props) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const [internal, setInternal] = useState("");
  const current = value ?? internal;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [time, setTime] = useState("09:00");
  const root = useRef<HTMLDivElement>(null);
  const selected = current ? new Date(current) : null;
  const firstDay = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstDay + days) / 7) * 7 }, (_, index) => index - firstDay + 1);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  function choose(day: number) {
    const [hours, minutes] = time.split(":").map(Number);
    const next = new Date(month.getFullYear(), month.getMonth(), day, hours, minutes);
    const formatted = localValue(next);
    onChange?.(formatted);
    if (!onChange) setInternal(formatted);
  }
  function openPicker() {
    if (selected && !Number.isNaN(selected.getTime())) {
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
      setTime(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
    }
    setOpen(previous => !previous);
  }
  return <div className="date-time-picker" ref={root}>
    <label id={`${controlId}-label`} htmlFor={controlId}>{label}</label>
    <input type="hidden" name={name} value={current} />
    <button id={controlId} type="button" className="date-time-trigger" aria-labelledby={`${controlId}-label`} aria-expanded={open} aria-haspopup="dialog" onClick={openPicker}>
      <CalendarClock size={16} aria-hidden="true" /><span className={current ? "" : "muted"}>{displayValue(current)}</span>
    </button>
    {open && <div className="date-time-popover" role="dialog" aria-label={`${label} calendar`}>
      <div className="date-time-month"><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><strong>{month.toLocaleString(undefined, { month: "long", year: "numeric" })}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div>
      <div className="date-time-grid" role="group" aria-label={month.toLocaleString(undefined, { month: "long", year: "numeric" })}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span className="date-time-weekday" key={index}>{day}</span>)}
        {cells.map((day, index) => day > 0 && day <= days ? <button key={index} type="button" className={selected?.getFullYear() === month.getFullYear() && selected.getMonth() === month.getMonth() && selected.getDate() === day ? "selected" : ""} aria-label={new Date(month.getFullYear(), month.getMonth(), day).toLocaleDateString(undefined, { dateStyle: "full" })} aria-pressed={selected?.getFullYear() === month.getFullYear() && selected.getMonth() === month.getMonth() && selected.getDate() === day} onClick={() => choose(day)}>{day}</button> : <span key={index} />)}
      </div>
      <div className="date-time-footer"><label>Time<input type="time" value={time} onChange={event => { setTime(event.target.value); if (selected && !Number.isNaN(selected.getTime())) { const [hours, minutes] = event.target.value.split(":").map(Number); const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), hours, minutes); const formatted = localValue(next); onChange?.(formatted); if (!onChange) setInternal(formatted); } }} /></label><div className="date-time-actions"><button type="button" className="btn quiet" onClick={() => { onChange?.(""); if (!onChange) setInternal(""); setOpen(false); }}>Clear</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>Done</button></div></div>
    </div>}
  </div>;
}
