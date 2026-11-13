import test from "node:test";
import assert from "node:assert/strict";
import { buildAnswerCandidates } from "../scripts/answer-candidates.mjs";
const task = {
  topic: "Photosynthesis",
  goal: "Explain light energy conversion and water splitting in plants.",
};
const evidence = [
  {
    evidenceId: "E1",
    role: "material",
    quote:
      "Plants release dioxygen during water splitting. Light energy becomes chemical energy that supports cell metabolism.",
  },
  {
    evidenceId: "E2",
    role: "material",
    quote:
      "Sugars are synthesized during the Calvin cycle. Atmospheric carbon dioxide provides carbon atoms.",
  },
];

test("answer menu entries are original complete-word source substrings with bound references", () => {
  const menu = buildAnswerCandidates(evidence, task);
  assert.ok(menu.some((item) => item.text === "water splitting"));
  assert.ok(menu.some((item) => item.text === "chemical energy"));
  assert.ok(menu.some((item) => item.text === "Calvin cycle"));
  assert.ok(!menu.some((item) => item.text === "oxygen"));
  for (const item of menu) {
    assert.ok(
      evidence
        .find((source) => source.evidenceId === item.evidenceId)
        .quote.includes(item.text),
    );
    assert.ok(item.text.length <= 60 && item.text.split(/\s+/).length <= 5);
  }
  assert.equal(menu.length, new Set(menu.map((item) => item.id)).size);
});

test("answer menu bounds context and preserves source diversity without crossing punctuation", () => {
  const menu = buildAnswerCandidates(evidence, task, 700);
  assert.ok(Buffer.byteLength(JSON.stringify(menu)) <= 700);
  assert.equal(new Set(menu.map((item) => item.evidenceId)).size, 2);
  assert.ok(!menu.some((item) => /splitting\. Light/.test(item.text)));
  assert.deepEqual(
    buildAnswerCandidates([{ ...evidence[0], role: "assignment" }], task),
    [],
  );
  assert.deepEqual(buildAnswerCandidates(evidence, task, 1), []);
});

test("answer menu retains complete concepts with interior function words", () => {
  const physics = {
    topic: "Physics",
    goal: "Understand rate of change and the law of conservation of energy.",
  };
  const sources = [
    {
      evidenceId: "E1",
      role: "material",
      quote: "A rate of change is a mathematical quantity.",
    },
    {
      evidenceId: "E2",
      role: "material",
      quote:
        "The law of conservation of energy describes a physical principle.",
    },
  ];
  const menu = buildAnswerCandidates(sources, physics);
  for (const phrase of [
    "rate of change",
    "conservation of energy",
    "law of conservation of energy",
  ])
    assert.ok(
      menu.some((item) => item.text === phrase),
      `Missing complete concept: ${phrase}`,
    );
  for (const item of menu) {
    assert.ok(
      sources
        .find((source) => source.evidenceId === item.evidenceId)
        .quote.includes(item.text),
    );
    assert.ok(
      !/^(?:a|an|the|of)\b|\b(?:a|an|the|of)$/i.test(item.text),
      "Function words must remain inside a phrase",
    );
    assert.ok(item.text.length <= 60 && item.text.split(/\s+/).length <= 5);
  }
});

test("interior connectors do not bridge a verb or punctuation boundary", () => {
  const sources = [
    {
      evidenceId: "E1",
      role: "material",
      quote:
        "Rate of change supports motion. Conservation of energy converts power; transfer of, energy occurs.",
    },
  ];
  const menu = buildAnswerCandidates(sources, {
    topic: "Physics",
    goal: "Study rate of change, conservation of energy, and transfer of energy.",
  });
  assert.ok(menu.some((item) => item.text === "Rate of change"));
  assert.ok(menu.some((item) => item.text === "Conservation of energy"));
  assert.ok(
    !menu.some((item) => /\b(?:supports|converts)\b|[.;,]/i.test(item.text)),
  );
  assert.ok(!menu.some((item) => item.text === "transfer of energy"));
  assert.ok(!menu.some((item) => /\bof$/i.test(item.text)));
});

const relationshipEvidence = [
  {
    evidenceId: "E1",
    role: "material",
    quote:
      "Oxygenic photosynthesis releases oxygen as a byproduct of water splitting.",
  },
  {
    evidenceId: "E2",
    role: "material",
    quote: "Plants convert light energy into chemical energy.",
  },
];

for (const level of ["explain", "apply"])
  test(`${level} answer menus include complete relationships alongside short concepts`, () => {
    const menu = buildAnswerCandidates(relationshipEvidence, {
      ...task,
      level,
    });
    for (const phrase of [
      "releases oxygen as a byproduct of water splitting",
      "convert light energy into chemical energy",
      "water splitting",
      "chemical energy",
    ])
      assert.ok(
        menu.some((item) => item.text === phrase),
        `Missing ${phrase}`,
      );
    for (const item of menu) {
      assert.ok(item.text.length <= 100);
      assert.ok(
        relationshipEvidence
          .find((source) => source.evidenceId === item.evidenceId)
          .quote.includes(item.text),
      );
    }
  });

test("foundation menus keep the short-concept contract", () => {
  const menu = buildAnswerCandidates(relationshipEvidence, {
    ...task,
    level: "foundation",
  });
  assert.ok(!menu.some((item) => /^(?:releases|convert)\b/.test(item.text)));
  assert.ok(
    menu.every(
      (item) => item.text.length <= 60 && item.text.split(/\s+/).length <= 5,
    ),
  );
});

test("relationships preserve qualifiers, negation and internal punctuation exactly", () => {
  const sources = [
    {
      evidenceId: "E1",
      role: "material",
      quote:
        "Plants convert light energy—typically from sunlight—into chemical energy.",
    },
    {
      evidenceId: "E2",
      role: "material",
      quote: "Plants absorb red light, especially at dawn, to produce sugars.",
    },
    {
      evidenceId: "E3",
      role: "material",
      quote:
        "Some organisms may not release oxygen as a byproduct of water splitting.",
    },
  ];
  const menu = buildAnswerCandidates(sources, { ...task, level: "explain" });
  for (const phrase of [
    "convert light energy—typically from sunlight—into chemical energy",
    "absorb red light, especially at dawn, to produce sugars",
    "may not release oxygen as a byproduct of water splitting",
  ])
    assert.ok(
      menu.some((item) => item.text === phrase),
      `Missing qualified relationship: ${phrase}`,
    );
  assert.ok(
    !menu.some((item) => /^release oxygen as a byproduct/.test(item.text)),
    "Do not remove modality or negation",
  );
  assert.ok(
    !menu.some((item) => item.text === "produce sugars"),
    "Do not treat the infinitive tail as an independent clause",
  );
});

test("long and clipped clauses are omitted rather than shortened into unsupported relationships", () => {
  const sources = [
    {
      evidenceId: "E1",
      role: "material",
      quote:
        "Plants convert light energy into chemical energy under carefully controlled laboratory conditions with specified humidity, temperature, pressure, and atmospheric composition.",
    },
    {
      evidenceId: "E2",
      role: "material",
      quote: "Plants convert light energy into chemical energy",
    },
    {
      evidenceId: "E3",
      role: "material",
      quote: "Plants convert light energy into chemical energy by.",
    },
  ];
  const menu = buildAnswerCandidates(sources, { ...task, level: "apply" });
  assert.ok(menu.length > 0, "Short concepts can still be selected");
  assert.ok(
    !menu.some((item) => /^convert\b/.test(item.text)),
    "Do not clip a condition, accept an unfinished tail, or end with a preposition",
  );
});

test("relational menus respect clause boundaries and retain balanced source allocation", () => {
  const sources = [
    {
      evidenceId: "E1",
      role: "material",
      quote:
        "Plants convert light energy into chemical energy; algae release oxygen through water splitting.",
    },
    {
      evidenceId: "E2",
      role: "material",
      quote:
        "Organisms—when they absorb light—release oxygen through water splitting.",
    },
  ];
  const menu = buildAnswerCandidates(sources, { ...task, level: "apply" }, 700);
  assert.ok(Buffer.byteLength(JSON.stringify(menu)) <= 700);
  assert.ok(menu.length <= 48);
  assert.equal(new Set(menu.map((item) => item.evidenceId)).size, 2);
  assert.ok(
    menu.some(
      (item) => item.text === "convert light energy into chemical energy",
    ),
  );
  assert.ok(
    !menu.some((item) => item.text.includes(";")),
    "Do not join independent clauses",
  );
  assert.ok(
    !menu.some((item) => item.text.startsWith("absorb light—")),
    "Do not start inside a parenthetical qualifier",
  );
  for (const item of menu)
    assert.ok(
      sources
        .find((source) => source.evidenceId === item.evidenceId)
        .quote.includes(item.text),
    );
});
