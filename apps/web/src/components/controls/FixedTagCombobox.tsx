"use client";

import { X, type LucideIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Paper } from "../Paper";

export type FixedTagComboboxOption = {
  id: string;
  label: string;
  searchText: string;
  subtitle: ReactNode;
  title: ReactNode;
};

const MINIMUM_POPUP_WIDTH = 320;

export function FixedTagCombobox({
  ariaLabel,
  clearLabel = "清除",
  emptyMessage = "没有匹配的标签",
  icon: Icon,
  onSelectedIdsChange,
  options,
  placeholder,
  selectedIds,
  inputWidth = MINIMUM_POPUP_WIDTH,
}: {
  ariaLabel: string;
  clearLabel?: string;
  emptyMessage?: string;
  icon: LucideIcon;
  onSelectedIdsChange: (ids: string[]) => void;
  options: readonly FixedTagComboboxOption[];
  placeholder: string;
  selectedIds: readonly string[];
  inputWidth?: number;
}) {
  const reservedInputWidth = Math.max(inputWidth, MINIMUM_POPUP_WIDTH);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputSlotRef = useRef<HTMLLabelElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const optionsById = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options],
  );
  const selectedOptions = useMemo(
    () =>
      selectedIds
        .map((id) => optionsById.get(id))
        .filter((option): option is FixedTagComboboxOption => Boolean(option)),
    [optionsById, selectedIds],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = useMemo(() => {
    const selected = new Set(selectedIds);
    return options.filter(
      (option) =>
        !selected.has(option.id) &&
        (!normalizedQuery ||
          option.searchText.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, options, selectedIds]);
  const popupOpen = open;
  const hasValue = selectedIds.length > 0 || query.length > 0;

  const updateScrollEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const next = {
      left: viewport.scrollLeft > 1,
      right: viewport.scrollLeft < maximum - 1,
    };
    setScrollEdges((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next,
    );
  }, []);

  const updatePopupAnchor = useCallback(() => {
    const root = rootRef.current;
    const inputSlot = inputSlotRef.current;
    if (!root || !inputSlot) return;
    const rootRect = root.getBoundingClientRect();
    const inputRect = inputSlot.getBoundingClientRect();
    const popupWidth = Math.min(reservedInputWidth, rootRect.width);
    const maximumLeft = Math.max(0, rootRect.width - popupWidth);
    const desiredLeft = inputRect.left - rootRect.left;
    const popupLeft = Math.min(Math.max(0, desiredLeft), maximumLeft);
    root.style.setProperty("--fixed-tag-popup-left", `${popupLeft}px`);
    root.style.setProperty("--fixed-tag-popup-width", `${popupWidth}px`);
  }, [reservedInputWidth]);

  const revealInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (viewport) viewport.scrollLeft = viewport.scrollWidth;
      updateScrollEdges();
      updatePopupAnchor();
      inputRef.current?.focus();
    });
  }, [updatePopupAnchor, updateScrollEdges]);

  useLayoutEffect(() => {
    updatePopupAnchor();
    updateScrollEdges();
    const root = rootRef.current;
    const viewport = viewportRef.current;
    const inputSlot = inputSlotRef.current;
    if (!root || !viewport || !inputSlot) return;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updatePopupAnchor();
            updateScrollEdges();
          });
    observer?.observe(root);
    observer?.observe(viewport);
    observer?.observe(inputSlot);
    window.addEventListener("resize", updatePopupAnchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePopupAnchor);
    };
  }, [updatePopupAnchor, updateScrollEdges]);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, []);

  const selectOption = (option: FixedTagComboboxOption) => {
    onSelectedIdsChange([...selectedIds, option.id]);
    setQuery("");
    setOpen(false);
    revealInput();
  };

  const removeOption = (id: string) => {
    onSelectedIdsChange(selectedIds.filter((selectedId) => selectedId !== id));
    revealInput();
  };

  const clear = () => {
    setQuery("");
    setOpen(false);
    onSelectedIdsChange([]);
    revealInput();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && query.length === 0 && selectedIds.length) {
      event.preventDefault();
      removeOption(selectedIds[selectedIds.length - 1]);
      return;
    }
    if (!popupOpen || filteredOptions.length === 0) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filteredOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) =>
          (index - 1 + filteredOptions.length) % filteredOptions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex] ?? filteredOptions[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const handleViewportScroll = () => {
    updateScrollEdges();
    updatePopupAnchor();
  };

  return (
    <div
      className="fixed-tag-combobox"
      ref={rootRef}
      style={
        {
          "--fixed-tag-input-width": `${reservedInputWidth}px`,
        } as CSSProperties
      }
    >
      <Paper
        animateOnMount={false}
        as="div"
        className="fixed-tag-combobox-control"
        foldSize={12}
        sticker={false}
        variant="plain"
      >
        <span className="fixed-tag-combobox-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        {selectedOptions.length ? <TagSeparator /> : null}
        <div
          className="fixed-tag-combobox-viewport"
          onScroll={handleViewportScroll}
          ref={viewportRef}
        >
          <div
            className="fixed-tag-combobox-track"
            data-has-tags={selectedOptions.length ? "true" : "false"}
            role="list"
          >
            {selectedOptions.map((option, index) => (
              <Fragment key={option.id}>
                {index > 0 ? <TagSeparator /> : null}
                <SelectedTag option={option} onRemove={removeOption} />
              </Fragment>
            ))}
            {selectedOptions.length ? <TagSeparator /> : null}
            <label className="fixed-tag-combobox-entry" ref={inputSlotRef}>
              <span className="sr-only">{ariaLabel}</span>
              <input
                ref={inputRef}
                aria-activedescendant={
                  popupOpen && filteredOptions[activeIndex]
                    ? `${listboxId}-${filteredOptions[activeIndex].id}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-expanded={popupOpen}
                aria-label={ariaLabel}
                autoComplete="off"
                className="fixed-tag-combobox-input"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onClick={() => setOpen(true)}
                onFocus={() => {
                  setOpen(true);
                  revealInput();
                }}
                onKeyDown={handleKeyDown}
                placeholder={selectedOptions.length ? "继续输入…" : placeholder}
                role="combobox"
                value={query}
              />
            </label>
          </div>
        </div>
        <span
          className="fixed-tag-scroll-shadow fixed-tag-scroll-shadow-left"
          data-visible={scrollEdges.left ? "true" : "false"}
          aria-hidden="true"
        />
        <span
          className="fixed-tag-scroll-shadow fixed-tag-scroll-shadow-right"
          data-clear-visible={hasValue ? "true" : "false"}
          data-visible={scrollEdges.right ? "true" : "false"}
          aria-hidden="true"
        />
        {hasValue ? (
          <>
            <TagSeparator />
            <Paper
              animateOnMount={false}
              as="button"
              className="fixed-tag-combobox-clear"
              folded={false}
              onClick={clear}
              sticker={false}
              variant="plain"
            >
              {clearLabel}
            </Paper>
          </>
        ) : null}
        <span className="fixed-tag-combobox-focus-border" aria-hidden="true" />
      </Paper>
      <TagPopup
        activeIndex={activeIndex}
        emptyMessage={emptyMessage}
        listboxId={listboxId}
        onSelect={selectOption}
        open={popupOpen}
        options={filteredOptions}
      />
    </div>
  );
}

function SelectedTag({
  onRemove,
  option,
}: {
  onRemove: (id: string) => void;
  option: FixedTagComboboxOption;
}) {
  return (
    <span className="fixed-tag-combobox-tag-slot" role="listitem">
      <Paper
        animateOnMount={false}
        as="div"
        className="fixed-tag-combobox-tag"
        foldSize={10}
        sticker={false}
        variant="tinted"
      >
        <TagCopy option={option} />
        <button
          aria-label={`移除${option.label}`}
          className="fixed-tag-combobox-remove"
          onClick={() => onRemove(option.id)}
          title={`移除${option.label}`}
          type="button"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </Paper>
    </span>
  );
}

function TagPopup({
  activeIndex,
  emptyMessage,
  listboxId,
  onSelect,
  open,
  options,
}: {
  activeIndex: number;
  emptyMessage: string;
  listboxId: string;
  onSelect: (option: FixedTagComboboxOption) => void;
  open: boolean;
  options: readonly FixedTagComboboxOption[];
}) {
  if (!open) return null;

  return (
    <div className="fixed-tag-combobox-popup-layer">
      <Paper
        animateOnMount={false}
        as="div"
        className="fixed-tag-combobox-popup"
        folded={false}
        sticker={false}
        unfoldOnHover={false}
        variant="plain"
      >
        <div
          className="fixed-tag-combobox-options"
          id={listboxId}
          onMouseDown={(event) => event.preventDefault()}
          role="listbox"
        >
          {options.length ? (
            options.map((option, index) => (
              <button
                aria-selected="false"
                className="fixed-tag-combobox-option"
                data-active={index === activeIndex ? "true" : "false"}
                id={`${listboxId}-${option.id}`}
                key={option.id}
                onClick={() => onSelect(option)}
                role="option"
                type="button"
              >
                <TagCopy option={option} />
              </button>
            ))
          ) : (
            <div className="fixed-tag-combobox-empty">{emptyMessage}</div>
          )}
        </div>
      </Paper>
    </div>
  );
}

function TagCopy({ option }: { option: FixedTagComboboxOption }) {
  return (
    <span className="fixed-tag-combobox-copy">
      <strong>{option.title}</strong>
      <small>{option.subtitle}</small>
    </span>
  );
}

function TagSeparator() {
  return <span className="fixed-tag-combobox-separator" aria-hidden="true" />;
}
