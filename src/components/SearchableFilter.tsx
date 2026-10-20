import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type SearchableFilterOption = {
  value: string;
  label: string;
};

type SearchableFilterProps = {
  value: string;
  options: SearchableFilterOption[];
  onChange: (value: string) => void;
  allValue?: string;
  allLabel?: string;
  disabled?: boolean;
  clearOnEmpty?: boolean;
  ariaLabel?: string;
  className?: string;
};

export default function SearchableFilter({
  value,
  options,
  onChange,
  allValue = "",
  allLabel = "Tất cả",
  disabled = false,
  clearOnEmpty = true,
  ariaLabel,
  className,
}: SearchableFilterProps) {
  const listId = useId().replaceAll(":", "");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const displayValue = value === allValue ? allLabel : selectedOption?.label ?? value;
  const displayValueRef = useRef(displayValue);
  displayValueRef.current = displayValue;
  const [draft, setDraft] = useState(displayValue);
  const [open, setOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);

  useEffect(() => {
    setDraft(displayValue);
    setOpen(false);
    setHasTyped(false);
  }, [displayValue]);

  useEffect(() => {
    const closeWhenOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHasTyped(false);
        setDraft(displayValueRef.current);
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, []);

  const availableOptions = [
    { value: allValue, label: allLabel },
    ...options.filter((option) => option.value !== allValue),
  ];
  const normalizedDraft = draft.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
  const matchingOptions = hasTyped && normalizedDraft
    ? availableOptions.filter((option) => `${option.label} ${option.value}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().includes(normalizedDraft))
    : availableOptions;

  const chooseOption = (option: SearchableFilterOption) => {
    setDraft(option.label);
    setOpen(false);
    setHasTyped(false);
    onChange(option.value);
  };

  const handleChange = (nextDraft: string) => {
    setDraft(nextDraft);
    setOpen(true);
    setHasTyped(true);
    if (nextDraft === "" && clearOnEmpty) {
      if (clearOnEmpty) onChange(allValue);
      return;
    }
    const match = options.find((option) => option.label === nextDraft || option.value === nextDraft);
    if (match) chooseOption(match);
    else if (nextDraft === allLabel) chooseOption({ value: allValue, label: allLabel });
  };

  return (
    <div className="searchable-filter" ref={rootRef}>
      <input
        className={`searchable-filter-input${className ? ` ${className}` : ""}`}
        type="text"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        value={draft}
        disabled={disabled}
        placeholder={`${allLabel} · gõ để tìm`}
        onFocus={(event) => { setOpen(true); setHasTyped(false); event.currentTarget.select(); }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
            setHasTyped(false);
            setDraft(displayValueRef.current);
          }
        }}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setHasTyped(false);
            setDraft(displayValueRef.current);
          }
          if (event.key === "ArrowDown") {
            setOpen(true);
            window.setTimeout(() => rootRef.current?.querySelector<HTMLButtonElement>(".searchable-filter-options > button")?.focus(), 0);
          }
          if (event.key === "Enter" && open && matchingOptions[0]) {
            event.preventDefault();
            chooseOption(matchingOptions[0]);
          }
        }}
      />
      <button className="searchable-filter-toggle" type="button" aria-label="Hiện lựa chọn bộ lọc" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { setHasTyped(false); setOpen((current) => !current); }}><ChevronDown size={16} aria-hidden="true" /></button>
      {open && !disabled && <div className="searchable-filter-options" id={listId} role="listbox">
        {matchingOptions.length ? matchingOptions.map((option) => <button key={`${option.value}-${option.label}`} type="button" role="option" aria-selected={option.value === value} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseOption(option)}>{option.label}</button>) : <span className="searchable-filter-empty">Không có gợi ý phù hợp</span>}
      </div>}
    </div>
  );
}
