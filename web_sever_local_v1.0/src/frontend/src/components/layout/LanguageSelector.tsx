import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

import type { Language } from "../../shared/types";

interface LanguageSelectorProps {
  language: Language;
  label: string;
  onLanguageChange: (language: Language) => void;
}

export default function LanguageSelector(props: LanguageSelectorProps) {
  const options: Array<{ value: Language; label: string; description: string }> = [
    { value: "zh", label: "中文", description: "简体中文" },
    { value: "en", label: "English", description: "English" },
  ];
  const active = options.find((item) => item.value === props.language) ?? options[0];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="language-trigger language-trigger-text" aria-label={props.label}>
          <span>{active.label}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="language-menu" align="end" sideOffset={8}>
          <DropdownMenu.Label className="language-menu-label">{props.label}</DropdownMenu.Label>
          {options.map((item) => (
            <DropdownMenu.Item
              key={item.value}
              className="language-menu-item"
              onSelect={() => props.onLanguageChange(item.value)}
            >
              <span className="language-menu-item-text">
                <strong>{item.label}</strong>
                <em>{item.description}</em>
              </span>
              {props.language === item.value ? <Check size={15} aria-hidden="true" /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
