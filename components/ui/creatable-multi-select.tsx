"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CreatableMultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}

const normalizeKey = (value: string) => value.trim().toLowerCase();

export function CreatableMultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select values...",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  className,
}: CreatableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const normalizedOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const option of options) {
      const trimmed = option.trim();
      if (!trimmed) continue;
      const key = normalizeKey(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(trimmed);
    }

    return deduped;
  }, [options]);

  const selectedKeys = React.useMemo(
    () => new Set(selected.map((value) => normalizeKey(value))),
    [selected]
  );

  const toggleValue = (value: string) => {
    const valueKey = normalizeKey(value);
    const isSelected = selected.some((selectedValue) => normalizeKey(selectedValue) === valueKey);

    if (isSelected) {
      onChange(selected.filter((selectedValue) => normalizeKey(selectedValue) !== valueKey));
      return;
    }

    onChange([...selected, value]);
  };

  const trimmedQuery = query.trim();
  const canCreate =
    trimmedQuery.length > 0 &&
    !normalizedOptions.some((option) => normalizeKey(option) === normalizeKey(trimmedQuery));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
        >
          {selected.length > 0 ? selected.join(", ") : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {canCreate && (
                <CommandItem
                  value={`create-${trimmedQuery}`}
                  onSelect={() => {
                    toggleValue(trimmedQuery);
                    setQuery("");
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create "{trimmedQuery}"
                </CommandItem>
              )}
              {normalizedOptions.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => toggleValue(option)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedKeys.has(normalizeKey(option)) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
