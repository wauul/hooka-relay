"use client";
import { T } from "./preferences";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Layers } from "lucide-react";
type Option = { value: string; label: string; description?: string };
export function Select({
  id,
  label,
  options,
  value,
  defaultValue,
  onChange,
  name,
  workspace = false,
}: {
  id?: string;
  label: string;
  options: Option[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  workspace?: boolean;
}) {
  const generatedId = useId();
  const listId = `${generatedId}-options`;
  const [internal, setInternal] = useState(
    defaultValue || options[0]?.value || "",
  );
  const selected = value ?? internal;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 280,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const chosen = options.find((o) => o.value === selected);
  function show() {
    if (!trigger.current || !options.length) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 16;
    const height = Math.min(280, options.length * 64 + 16);
    const above = below < Math.min(height, 160) && rect.top > below;
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: above ? Math.max(12, rect.top - height - 8) : rect.bottom + 8,
      width,
      maxHeight: above ? Math.min(height, rect.top - 20) : Math.min(280, below),
    });
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === selected),
      ),
    );
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    setInternal(option.value);
    setOpen(false);
    onChange?.(option.value);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);
  return (
    <div className="relay-select">
      {name && <input type="hidden" name={name} value={selected} />}
      <button
        id={id}
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={!options.length}
        className="select-trigger"
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={(event) => {
          if (!menu.current?.contains(event.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) show();
            else
              setActive(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (active +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        options.length) %
                      options.length,
              );
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else show();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
          else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const now = Date.now();
            search.current = {
              text:
                (now - search.current.at > 700 ? "" : search.current.text) +
                event.key.toLowerCase(),
              at: now,
            };
            const index = options.findIndex((o) =>
              o.label.toLowerCase().startsWith(search.current.text),
            );
            if (!open) show();
            if (index >= 0) setActive(index);
          }
        }}
      >
        {workspace && <Layers size={16} className="select-leading" />}
        <span className="select-value">
          {workspace ? chosen?.label || "Choose a workspace" : <T text={chosen?.label || "Choose a workspace"} />}
        </span>
        <ChevronDown
          size={15}
          className={open ? "select-chevron open" : "select-chevron"}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            aria-label={label}
            className="select-menu"
            style={{ position: "fixed", ...position }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === selected}
                className={`select-option ${index === active ? "active" : ""}`}
                onPointerMove={() => setActive(index)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(index)}
              >
                <div className="select-option-text">
                  <span>{workspace ? option.label : <T text={option.label} />}</span>
                  {option.description && <small>{option.description}</small>}
                </div>
                {option.value === selected && <Check size={16} />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
