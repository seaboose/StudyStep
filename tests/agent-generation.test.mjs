import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceCatalogue,
  generateLocalDraft,
  resolveTaskDraft,
} from "../scripts/local-generation.mjs";

const quote =
  "Plants release dioxygen during photosynthesis. Green chloroplasts capture sunlight to power this process.";
const source = {
  id: "cc9b407f-3a5c-44c9-a07d-f27905293f90",
  name: "Plant notes",
  type: "notes",
  role: "material",
  passages: [{ id: "p1", label: "Plants", text: quote }],
  warnings: [],
  pageCount: 0,
  addedAt: "2026-10-29T00:00:00.000Z",
  fingerprint: "plant-fixture",
};
const task = {
  topic: "Plants",
  goal: "Explain photosynthesis",
  level: "explain",
  previousQuestions: [],
};
const topic = (changes = {}) => ({
  title: "Photosynthesis gas",
  question: "What gas do plants release during photosynthesis?",
  answerEvidenceId: "E1",
  answerPhrase: "dioxygen",
  distractors: ["nitrogen", "helium"],
  citations: [{ evidenceId: "E1" }],
  ...changes,
});
const raw = (changes = {}) => ({
  title: "Plants",
  topics: [topic()],
  gaps: [],
  ...changes,
});
const catalogue = (text = quote) =>
  new Map([
    ["E1", { quote: text, passageId: "p1" }],
    ["E2", { quote: "Roots absorb water from soil.", passageId: "p2" }],
  ]);
const response = (value) =>
  Response.json({ done: true, message: { content: JSON.stringify(value) } });
function approved(items) {
  return {
    checks: Object.fromEntries(
      items.map((item) => {
        const check = {
          verdict: "supported",
          answerIndex: -1,
          reason: "The cited excerpt states the fact.",
        };
        if (item.type === "multiple-choice question") {
          const answerIndex = item.content.options.findIndex((option) =>
            ["dioxygen", "sunlight"].includes(option),
          );
          assert.ok(answerIndex >= 0);
          Object.assign(check, {
            answerIndex,
            supportingQuote: item.evidence[0],
            optionChecks: Object.fromEntries(
              item.content.options.map((_, index) => [
                String(index),
                {
                  verdict:
                    index === answerIndex ? "answers" : "does_not_answer",
                  reason:
                    index === answerIndex
                      ? "The source directly states this answer."
                      : "This alternative does not answer the question from this source.",
                },
              ]),
            ),
          });
        }
        return [item.id, check];
      }),
    ),
  };
}
function localModel(author, review = approved) {
  const authors = [],
    reviews = [];
  return {
    authors,
    reviews,
    fetcher: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(init.body),
        input = JSON.parse(body.messages[1].content);
      const request = { body, input };
      if (body.format.properties.checks) {
        reviews.push(request);
        return response(await review(input.items, reviews.length, request));
      }
      authors.push(request);
      return response(await author(authors.length, request));
    },
  };
}
const generate = (model, options = { task }) =>
  generateLocalDraft(
    [source],
    "fixture-model",
    new AbortController().signal,
    model.fetcher,
    () => {},
    options,
  );
const secondTopic = () =>
  topic({
    title: "Light capture",
    question: "What do green chloroplasts capture to power the process?",
    answerPhrase: "sunlight",
    distractors: ["sound", "wind"],
  });
const danglingTopic = () =>
  topic({
    title: "Incomplete answer",
    question: "What supplies energy to the process?",
    answerPhrase: "sunlight to",
    distractors: ["water", "soil"],
  });
const partlyValid = () =>
  raw({ topics: [topic(), secondTopic(), danglingTopic()] });

test("task phrases reconstruct original case, punctuation and whitespace without paraphrasing", () => {
  const selected = resolveTaskDraft(raw(), catalogue());
  assert.equal(selected.topics[0].answer, "dioxygen");
  assert.equal(selected.topics[0].answerEvidenceId, undefined);
  assert.equal(selected.topics[0].answerPhrase, undefined);
  const exact = "α-carbon\t  and\nwater.";
  const all = resolveTaskDraft(
    raw({ topics: [topic({ answerPhrase: " Α-CARBON and WATER. " })] }),
    catalogue(exact),
  );
  assert.equal(all.topics[0].answer, exact);
  assert.equal(
    resolveTaskDraft(
      raw({ topics: [topic({ answerPhrase: "WATER." })] }),
      catalogue(exact),
    ).topics[0].answer,
    "water.",
  );
  assert.equal(
    resolveTaskDraft(
      raw({ topics: [topic({ answerPhrase: "C++" })] }),
      catalogue("The course uses C++ for programming."),
    ).topics[0].answer,
    "C++",
  );
});

test("task phrases reject substrings, paraphrases, changed tense, malformed input and extra fields", () => {
  for (const changes of [
    { answerPhrase: "oxygen" },
    { answerPhrase: "dioxy" },
    { answerPhrase: "plants make oxygen" },
    { answerPhrase: "Plants released dioxygen" },
    { answerPhrase: "dioxygen release Plants" },
    { answerPhrase: "dioxygen sunlight" },
    { answerPhrase: "" },
    { answerPhrase: " \n\t " },
    { answerPhrase: 12 },
    { answerPhrase: null },
    { answerEvidenceId: "invented" },
    { answerStartWord: 2, answerEndWord: 3 },
  ]) {
    assert.throws(
      () => resolveTaskDraft(raw({ topics: [topic(changes)] }), catalogue()),
      (error) => {
        assert.equal(error.name, "ZodError", JSON.stringify(changes));
        assert.ok(error.issues.some((issue) => issue.path[0] === "topics"));
        return true;
      },
    );
  }
  assert.throws(
    () =>
      resolveTaskDraft(
        raw({ topics: [topic({ answer: "oxygen" })] }),
        catalogue(),
      ),
    /Unrecognized key.*answer/,
  );
  assert.throws(
    () =>
      resolveTaskDraft(
        raw({ topics: [topic({ answerPhrase: undefined })] }),
        catalogue(),
      ),
    /Required/,
  );
});

test("task phrases enforce the selected citation and 100-character limits on input and original text", () => {
  assert.throws(
    () =>
      resolveTaskDraft(
        raw({ topics: [topic({ citations: [{ evidenceId: "E2" }] })] }),
        catalogue(),
      ),
    /must also appear in citations/,
  );
  assert.throws(
    () =>
      resolveTaskDraft(
        raw({
          topics: [
            topic({
              answerEvidenceId: "E2",
              citations: [{ evidenceId: "E2" }],
              answerPhrase: "dioxygen",
            }),
          ],
        }),
        catalogue(),
      ),
    /not a complete verbatim phrase in E2/,
  );
  const hundred = "a".repeat(49) + " " + "b".repeat(50);
  const selectAll = raw({ topics: [topic({ answerPhrase: hundred })] });
  assert.equal(
    resolveTaskDraft(selectAll, catalogue(hundred)).topics[0].answer.length,
    100,
  );
  assert.throws(
    () =>
      resolveTaskDraft(
        raw({ topics: [topic({ answerPhrase: hundred + "b" })] }),
        catalogue(hundred + "b"),
      ),
    /at most 100 character/,
  );
  assert.throws(
    () => resolveTaskDraft(selectAll, catalogue(hundred.replace(" ", "  "))),
    /original selected source phrase exceeds 100 characters/,
  );
  assert.throws(
    () =>
      resolveTaskDraft(
        raw({ topics: [topic(), topic(), topic()] }),
        catalogue(),
        2,
      ),
    /at most 2/,
  );
});

test("task author schema selects exact phrases from readable evidence and reviews reconstructed answers in batches of two", async () => {
  const model = localModel(() =>
    raw({
      topics: [
        topic({ answerPhrase: "DIOXYGEN" }),
        topic({
          title: "Light capture",
          question: "What do green chloroplasts capture to power the process?",
          answerPhrase: "SUNLIGHT",
          distractors: ["sound", "wind"],
        }),
      ],
    }),
  );
  const result = await generate(model);
  const { body, input } = model.authors[0];
  const shape = body.format.properties.topics.items;
  assert.equal(shape.additionalProperties, false);
  assert.equal(shape.properties.answer, undefined);
  assert.ok(!shape.required.includes("answer"));
  assert.deepEqual(shape.properties.answerEvidenceId.enum, ["E1"]);
  assert.deepEqual(shape.properties.answerPhrase, {
    type: "string",
    minLength: 1,
    maxLength: 100,
  });
  assert.equal(shape.properties.answerStartWord, undefined);
  assert.equal(shape.properties.answerEndWord, undefined);
  assert.equal(body.format.properties.topics.maxItems, 2);
  assert.equal(input.evidence[0].quote, quote);
  assert.equal(input.evidence[0].indexedWords, undefined);
  assert.equal(input.sources[0].passages, undefined);
  assert.match(
    body.messages[0].content,
    /Do not output a literal answer field/,
  );
  assert.equal(result.draft.units[0].recallAnswer, "dioxygen");
  assert.equal(result.draft.units[1].recallAnswer, "sunlight");
  assert.deepEqual(result.reviewProblems, []);
  assert.equal(model.reviews.length, 2);
  for (const request of model.reviews) {
    assert.equal(request.input.items.length, 2);
    assert.ok(request.input.items.every((item) => !("expectedAnswer" in item)));
    assert.ok(request.input.items.every((item) => item.evidence[0] === quote));
  }
});

test("phrase and citation failures include rejected fields, quoted bad phrases and validation paths in repairs", async () => {
  const rejected = raw({ topics: [topic({ answerPhrase: "oxygen" })] });
  const wrongCitation = raw({
    topics: [topic({ citations: [{ evidenceId: "E2" }] })],
  });
  const model = localModel((attempt) =>
    attempt === 1 ? rejected : attempt === 2 ? wrongCitation : raw(),
  );
  const result = await generate(model);
  assert.equal(model.authors.length, 3);
  assert.equal(model.reviews.length, 1);
  assert.equal(
    model.authors[1].input.rejectedAttempt[0].answerPhrase,
    "oxygen",
  );
  assert.ok(
    model.authors[1].input.fixTheseProblems.some(
      (problem) =>
        problem.includes("topics.0.answerPhrase") &&
        problem.includes('"oxygen"'),
    ),
  );
  assert.deepEqual(model.authors[2].input.rejectedAttempt[0].citations, [
    { evidenceId: "E2" },
  ]);
  assert.ok(
    model.authors[2].input.fixTheseProblems.some((problem) =>
      problem.includes("topics.0.citations.0.evidenceId"),
    ),
  );
  assert.equal(result.draft.units[0].recallAnswer, "dioxygen");
});

test("task author repair cannot exceed four attempts or accept literal unsupported answers", async () => {
  const model = localModel(() =>
    raw({ topics: [topic({ answer: "oxygen" })] }),
  );
  await assert.rejects(
    () => generate(model, { task, maxAttempts: 99 }),
    /failed question or source checks.*Unrecognized key.*answer/,
  );
  assert.equal(model.authors.length, 4);
  assert.equal(model.reviews.length, 0);
  assert.equal(model.authors[3].input.rejectedAttempt[0].answer, "oxygen");
  const oneAttempt = localModel(() =>
    raw({ topics: [topic({ answerPhrase: "oxygen" })] }),
  );
  await assert.rejects(
    () => generate(oneAttempt, { task, maxAttempts: 1 }),
    /answerPhrase/,
  );
  assert.equal(oneAttempt.authors.length, 1);
});

test("task phrases retain word-boundary checks, independent choice review and resolved-answer diagnostics", async () => {
  const partialWord = localModel(() =>
    raw({ topics: [topic({ distractors: ["oxygen", "helium"] })] }),
  );
  await assert.rejects(
    () => generate(partialWord, { task, maxAttempts: 1 }),
    /ends inside a source word/,
  );
  assert.equal(partialWord.reviews.length, 0);
  const ambiguous = localModel(
    () => raw(),
    (items) => {
      const review = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      )) {
        review.checks[item.id].answerIndex = -1;
        review.checks[item.id].optionChecks["0"].verdict = "uncertain";
      }
      return review;
    },
  );
  await assert.rejects(
    () => generate(ambiguous, { task, maxAttempts: 2 }),
    /unsupported or uncertain.*ambiguous/,
  );
  assert.equal(ambiguous.authors.length, 2);
  assert.equal(ambiguous.reviews.length, 2);
  assert.equal(
    ambiguous.authors[1].input.rejectedAttempt[0].resolvedAnswer,
    "dioxygen",
  );
  assert.match(
    ambiguous.authors[1].input.repairRule,
    /question-0\/unit-0 refer to topics\[0\]/,
  );
});

test("repeated prior questions are repaired before spending calls on evidence review", async () => {
  const model = localModel((attempt) =>
    raw({
      topics: [
        attempt === 1
          ? topic()
          : topic({
              title: "Light capture",
              question: "What do chloroplasts capture to power photosynthesis?",
              answerPhrase: "sunlight",
              distractors: ["sound", "wind"],
            }),
      ],
    }),
  );
  const result = await generate(model, {
    task: { ...task, previousQuestions: [topic().question.toUpperCase()] },
  });
  assert.equal(model.authors.length, 2);
  assert.equal(model.reviews.length, 1);
  assert.ok(
    model.authors[1].input.fixTheseProblems.some((problem) =>
      problem.includes("already in the study set"),
    ),
  );
  assert.equal(result.draft.units[0].recallAnswer, "sunlight");
});

test("the last task attempt retains two valid pairs only after independent review and records the omitted coverage", async () => {
  let model;
  model = localModel(() => {
    assert.equal(model.reviews.length, 0);
    return partlyValid();
  });
  const result = await generate(model, {
    task: { ...task, level: "foundation" },
    maxAttempts: 2,
  });
  assert.equal(model.authors.length, 2);
  assert.equal(model.reviews.length, 2);
  assert.deepEqual(
    result.draft.units.map((unit) => unit.recallAnswer),
    ["dioxygen", "sunlight"],
  );
  assert.equal(result.draft.questions.length, 2);
  assert.ok(
    result.draft.questions.every((question) =>
      result.draft.units.some((unit) => unit.id === question.unitId),
    ),
  );
  assert.ok(
    result.draft.gaps.some(
      (gap) => gap.includes("failed checks") && gap.includes("omitted"),
    ),
  );
  assert.deepEqual(
    model.reviews.flatMap((review) =>
      review.input.items.map((item) => item.id),
    ),
    ["unit-0", "unit-1", "question-0", "question-1"],
  );
  assert.ok(
    model.reviews.every(
      (review) => !JSON.stringify(review.input.items).includes('"sunlight to"'),
    ),
  );
  assert.match(model.authors[0].body.messages[0].content, /1–8 words/);
  assert.match(
    model.authors[0].body.messages[0].content,
    /never cut a statement/,
  );
});

test("partial task recovery excludes prior questions and fails when no new valid pair remains", async () => {
  const model = localModel(partlyValid);
  const result = await generate(model, {
    task: {
      ...task,
      level: "foundation",
      previousQuestions: [topic().question.toUpperCase()],
    },
    maxAttempts: 1,
  });
  assert.equal(result.draft.units.length, 1);
  assert.equal(result.draft.units[0].recallAnswer, "sunlight");
  assert.equal(model.reviews.length, 1);
  const allBad = localModel(() => raw({ topics: [danglingTopic()] }));
  await assert.rejects(
    () => generate(allBad, { task, maxAttempts: 2 }),
    /incomplete, overly long, or unsupported/,
  );
  assert.equal(allBad.authors.length, 2);
  assert.equal(allBad.reviews.length, 0);
  const nothingNew = localModel(partlyValid);
  await assert.rejects(
    () =>
      generate(nothingNew, {
        task: {
          ...task,
          level: "foundation",
          previousQuestions: [topic().question, secondTopic().question],
        },
        maxAttempts: 1,
      }),
    /incomplete, overly long, or unsupported/,
  );
  assert.equal(nothingNew.reviews.length, 0);
});

test("a retained task subset still fails if independent review rejects any retained item", async () => {
  const model = localModel(partlyValid, (items) => {
    const review = approved(items);
    review.checks[items[0].id].verdict = "unsupported";
    review.checks[items[0].id].reason =
      "The retained claim is not established.";
    return review;
  });
  await assert.rejects(
    () =>
      generate(model, {
        task: { ...task, level: "foundation" },
        maxAttempts: 2,
      }),
    /evidence review found unsupported or uncertain/,
  );
  assert.equal(model.authors.length, 2);
  assert.equal(model.reviews.length, 2);
});

test("partial recovery never bypasses task schema or citation validation and never changes manual behavior", async () => {
  for (const invalid of [
    topic({ answer: "dioxygen" }),
    topic({ citations: [{ evidenceId: "invented" }] }),
    topic({ answerPhrase: "solar energy" }),
  ]) {
    const model = localModel(() =>
      raw({ topics: [topic(), secondTopic(), invalid] }),
    );
    await assert.rejects(
      () =>
        generate(model, {
          task: { ...task, level: "foundation" },
          maxAttempts: 1,
        }),
      /failed question or source checks/,
    );
    assert.equal(model.reviews.length, 0);
  }
  const manual = localModel(() => ({
    ...partlyValid(),
    topics: partlyValid().topics.map(
      ({ answerPhrase, answerEvidenceId, ...item }) => ({
        ...item,
        answer: answerPhrase,
      }),
    ),
  }));
  await assert.rejects(
    () => generate(manual, {}),
    /incomplete, overly long, or unsupported/,
  );
  assert.equal(manual.authors.length, 2);
  assert.equal(manual.reviews.length, 0);
});

test("manual generation retains literal-answer schema, original evidence and its review flow", async () => {
  const model = localModel(() => ({
    title: "Plants",
    topics: [
      {
        title: "Photosynthesis gas",
        question: topic().question,
        answer: "dioxygen",
        distractors: topic().distractors,
        citations: topic().citations,
      },
    ],
    gaps: [],
  }));
  const result = await generate(model, {});
  const { body, input } = model.authors[0];
  assert.equal(
    body.format.properties.topics.items.properties.answer.type,
    "string",
  );
  assert.equal(
    body.format.properties.topics.items.properties.answerEvidenceId,
    undefined,
  );
  assert.deepEqual(input.evidence, evidenceCatalogue([source]));
  assert.deepEqual(input.sources[0].passages, source.passages);
  assert.equal(result.draft.units[0].recallAnswer, "dioxygen");
  assert.equal(model.authors.length, 1);
  assert.equal(model.reviews.length, 1);
});
