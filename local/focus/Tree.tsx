import { SPECIES } from "../../lib/focus";

// Legacy species IDs preserve existing history and unlocks.
// Patterns celebrate saved focus time without making a claim about mastery.
export default function LearningPattern({
  species = "oak",
  progress = 1,
  small = false,
}: {
  species?: string;
  progress?: number;
  small?: boolean;
}) {
  const color =
    SPECIES.find((design) => design.id === species)?.color ||
    SPECIES[0].color;
  const completion = Math.max(0, Math.min(1, progress));
  return (
    <svg
      className={`garden-tree learning-pattern${small ? " small" : ""}`}
      viewBox="0 0 260 250"
      aria-hidden="true"
    >
      <g fill="none" stroke="#26414c" strokeWidth="1">
        <path d="m30 77 26-34 49-18m96 24 29 38-8 52M47 166l13 24 39 10m79-3 32-20" />
        <circle cx="130" cy="118" r="86" strokeDasharray="1 10" />
      </g>
      <g fill={color} opacity=".65">
        <circle cx="30" cy="77" r="2" />
        <circle cx="56" cy="43" r="3" />
        <circle cx="105" cy="25" r="2" />
        <circle cx="201" cy="49" r="2.5" />
        <circle cx="230" cy="87" r="2" />
        <circle cx="222" cy="139" r="3" />
        <circle cx="47" cy="166" r="2" />
        <circle cx="60" cy="190" r="2.5" />
        <circle cx="99" cy="200" r="2" />
        <circle cx="178" cy="197" r="2" />
        <circle cx="210" cy="177" r="2.5" />
      </g>
      <circle cx="130" cy="118" r="70" fill="#0b141e" stroke="#26414c" />
      <circle
        cx="130"
        cy="118"
        r="70"
        fill="none"
        stroke={color}
        strokeWidth="3"
        pathLength="100"
        strokeDasharray={`${completion * 100} 100`}
        transform="rotate(-90 130 118)"
      />
      <g
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {species === "cherry" ? (
          <>
            <ellipse cx="130" cy="118" rx="46" ry="21" transform="rotate(-30 130 118)" opacity=".65" />
            <ellipse cx="130" cy="118" rx="46" ry="21" transform="rotate(55 130 118)" opacity=".35" />
            <circle cx="130" cy="118" r="12" fill={color} fillOpacity=".12" />
            <circle cx="166" cy="91" r="5" fill={color} />
            <circle cx="110" cy="81" r="3" fill={color} />
          </>
        ) : species === "pine" ? (
          <>
            <path d="m94 137 20-51 35 20 20 43-41 12-34-24 55-31-21 55" opacity=".55" />
            <circle cx="94" cy="137" r="5" fill={color} fillOpacity=".15" />
            <circle cx="114" cy="86" r="4" fill={color} />
            <circle cx="149" cy="106" r="6" fill={color} fillOpacity=".15" />
            <circle cx="169" cy="149" r="4" fill={color} />
            <circle cx="128" cy="161" r="4" fill={color} />
          </>
        ) : (
          <>
            <path
              d="m130 78 11 29 29 11-29 11-11 29-11-29-29-11 29-11z"
              fill={color}
              fillOpacity=".09"
            />
            <path d="m165 76 4 10 10 4-10 4-4 10-4-10-10-4 10-4z" strokeWidth="1.5" />
            <circle cx="96" cy="155" r="3" fill={color} />
            <circle cx="90" cy="87" r="2" fill={color} />
          </>
        )}
      </g>
      <rect
        x="60"
        y="211"
        width="140"
        height="22"
        rx="4"
        fill="#101923"
        stroke="#26414c"
      />
      {Array.from({ length: 10 }, (_, index) => (
        <rect
          key={index}
          x={69 + index * 12.5}
          y="218"
          width="9"
          height="8"
          rx="1"
          fill={index < Math.ceil(completion * 10) ? color : "#26414c"}
          opacity={index < Math.ceil(completion * 10) ? 0.9 : 0.5}
        />
      ))}
    </svg>
  );
}
