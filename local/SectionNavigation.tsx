import type { LucideIcon } from "lucide-react";

type Section<Id extends string> = { id: Id; label: string; icon: LucideIcon };

export default function SectionNavigation<Id extends string>({
  label,
  sections,
  current,
  onChange,
  study = false,
}: {
  label: string;
  sections: readonly Section<Id>[];
  current: Id;
  onChange: (id: Id) => void;
  study?: boolean;
}) {
  return (
    <nav aria-label={label} className="section-navigation">
      <select
        aria-label={label}
        value={current}
        onChange={(event) => {
          const section = sections[event.currentTarget.selectedIndex];
          if (section) onChange(section.id);
        }}
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.label}
          </option>
        ))}
      </select>
      {sections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={
            study
              ? id === current
                ? "nav-item selected"
                : "nav-item"
              : undefined
          }
          aria-current={id === current ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          <Icon size={study ? 19 : 17} />
          {label}
        </button>
      ))}
    </nav>
  );
}
