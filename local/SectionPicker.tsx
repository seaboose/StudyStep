import { useEffect, useState } from "react";
import { totalText, type Source } from "../lib/study";
import { GENERATION_LIMIT } from "../lib/selection";
export default function SectionPicker({
  sources,
  selected,
  onChange,
  disabled,
}: {
  sources: Source[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [filter, setFilter] = useState(""),
    [expanded, setExpanded] = useState(false);
  const chosen = new Set(selected),
    all = sources.flatMap((s) => s.passages);
  const size = all
    .filter((p) => chosen.has(p.id))
    .reduce((n, p) => n + p.text.length, 0);
  useEffect(() => {
    if (size > GENERATION_LIMIT) setExpanded(true);
  }, [size]);
  function toggle(ids: string[]) {
    const next = new Set(selected);
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChange([...next]);
  }
  return (
    <details
      className="section-picker"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>
        Choose sections · {selected.length} of {all.length} selected
      </summary>
      <p>
        Choose pages or passages. Your selection saves with this workspace; full
        uploads stay available. Saving a new study set replaces the current one.
      </p>
      <p role="status" className={size > GENERATION_LIMIT ? "local-error" : ""}>
        {size.toLocaleString()} / {GENERATION_LIMIT.toLocaleString()} characters
        selected · {(totalText(sources) - size).toLocaleString()} left out
      </p>
      <label className="local-field">
        <span>Find a section</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search source names, page labels, or text"
        />
      </label>
      <div className="local-row">
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => onChange(all.map((p) => p.id))}
        >
          Select all
        </button>
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => onChange([])}
        >
          Clear selection
        </button>
      </div>
      {sources.map((s) => {
        const passages = s.passages.filter((p) =>
          `${s.name} ${p.label} ${p.text}`
            .toLowerCase()
            .includes(filter.toLowerCase()),
        );
        if (!passages.length) return null;
        return (
          <fieldset key={s.id} disabled={disabled}>
            <legend>
              {s.name}
              {s.role === "assignment" ? " · assigned guide" : ""}
            </legend>
            <button
              className="text-button"
              onClick={() => toggle(passages.map((p) => p.id))}
            >
              {passages.every((p) => chosen.has(p.id)) ? "Deselect" : "Select"}{" "}
              shown sections
            </button>
            {passages.map((p) => (
              <div className="section-choice" key={p.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={() => toggle([p.id])}
                  />
                  <strong>{p.label}</strong>
                  <span>{p.text.length.toLocaleString()} characters</span>
                </label>
                <details>
                  <summary>Read section</summary>
                  <p>{p.text}</p>
                </details>
              </div>
            ))}
          </fieldset>
        );
      })}
    </details>
  );
}
