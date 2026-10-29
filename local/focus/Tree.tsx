import { SPECIES } from "../../lib/focus";

export default function Tree({
  species = "oak",
  progress = 1,
  small = false,
}: {
  species?: string;
  progress?: number;
  small?: boolean;
}) {
  const color =
    SPECIES.find((s) => s.id === species)?.color || SPECIES[0].color;
  const scale = 0.42 + Math.max(0, Math.min(1, progress)) * 0.58;
  return (
    <svg
      className={small ? "garden-tree small" : "garden-tree"}
      viewBox="0 0 260 250"
      aria-hidden="true"
    >
      <ellipse cx="130" cy="224" rx="72" ry="13" fill="#dce7d4" />
      <g transform={`translate(130 222) scale(${scale}) translate(-130 -222)`}>
        <path d="M125 220 127 110h8l3 110" fill="#8a7255" />
        <path
          d="m130 172-36-29m40 12 30-30"
          stroke="#8a7255"
          strokeWidth="7"
          strokeLinecap="round"
        />
        {species === "pine" ? (
          <>
            <path d="m130 32 62 100H68z" fill={color} />
            <path d="m130 83 78 105H52z" fill={color} />
            <path d="m130 32 10 100H68z" fill="#fff" opacity=".08" />
          </>
        ) : (
          <>
            <circle cx="93" cy="115" r="45" fill={color} />
            <circle cx="166" cy="115" r="44" fill={color} />
            <circle cx="131" cy="77" r="53" fill={color} />
            <ellipse cx="132" cy="126" rx="53" ry="39" fill={color} />
            <ellipse
              cx="113"
              cy="67"
              rx="25"
              ry="20"
              fill="#fff"
              opacity=".12"
            />
            {species === "cherry" && (
              <g fill="#f7dce5">
                <circle cx="85" cy="102" r="6" />
                <circle cx="143" cy="57" r="7" />
                <circle cx="172" cy="122" r="6" />
                <circle cx="120" cy="125" r="6" />
              </g>
            )}
          </>
        )}
      </g>
      <path
        d="m65 224-3-11m6 11 5-7m112 7 2-10m-5 10-5-6"
        stroke="#94ab7d"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
