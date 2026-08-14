import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Filter } from "lucide-react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  FixedTagCombobox,
  type FixedTagComboboxOption,
} from "./FixedTagCombobox";

const options: FixedTagComboboxOption[] = [
  {
    id: "th06",
    label: "东方红魔乡",
    searchText: "东方红魔乡 TH06 2002 hmx",
    title: "东方红魔乡",
    subtitle: "TH06 · 2002",
  },
  {
    id: "th07",
    label: "东方妖妖梦",
    searchText: "东方妖妖梦 TH07 2003 yym",
    title: "东方妖妖梦",
    subtitle: "TH07 · 2003",
  },
];

function Harness({ initial = [] }: { initial?: string[] }) {
  const [selected, setSelected] = useState(initial);
  return (
    <FixedTagCombobox
      ariaLabel="筛选作品"
      icon={Filter}
      onSelectedIdsChange={setSelected}
      options={options}
      placeholder="输入作品"
      selectedIds={selected}
      inputWidth={320}
    />
  );
}

describe("FixedTagCombobox", () => {
  it("opens on focus and inserts a dynamic Paper tag", async () => {
    const { container } = render(<Harness />);
    const input = screen.getByRole("combobox", { name: "筛选作品" });
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();

    await userEvent.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(
      container.querySelector(".fixed-tag-combobox-focus-border"),
    ).toBeTruthy();

    await userEvent.type(input, "红魔乡");
    expect(screen.getByRole("listbox")).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: /东方红魔乡/ }));

    const tag = container.querySelector(
      ".fixed-tag-combobox-tag",
    ) as HTMLElement;
    expect(tag.dataset.paperVariant).toBe("tinted");
    expect(tag.textContent).toContain("TH06 · 2002");
    expect(tag.closest(".fixed-tag-combobox-tag-slot")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "清除" })).toBeTruthy();
    await userEvent.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("removes individual tags and clears query plus selections", async () => {
    const { container } = render(<Harness initial={["th06", "th07"]} />);
    await userEvent.click(
      screen.getByRole("button", { name: "移除东方红魔乡" }),
    );
    expect(container.querySelectorAll(".fixed-tag-combobox-tag")).toHaveLength(
      1,
    );
    expect(
      container.querySelector(".fixed-tag-combobox-tag")?.textContent,
    ).toContain("东方妖妖梦");

    const input = screen.getByRole("combobox", { name: "筛选作品" });
    await userEvent.type(input, "红");
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(container.querySelectorAll(".fixed-tag-combobox-tag")).toHaveLength(
      0,
    );
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("reports shadows on both clipped edges of the horizontal tag strip", () => {
    const { container } = render(<Harness initial={["th06", "th07"]} />);
    const viewport = container.querySelector(
      ".fixed-tag-combobox-viewport",
    ) as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 600 },
    });
    viewport.scrollLeft = 240;
    fireEvent.scroll(viewport);

    expect(
      container
        .querySelector(".fixed-tag-scroll-shadow-left")
        ?.getAttribute("data-visible"),
    ).toBe("true");
    expect(
      container
        .querySelector(".fixed-tag-scroll-shadow-right")
        ?.getAttribute("data-visible"),
    ).toBe("true");
  });
});
