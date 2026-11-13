import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAdvancedDraft,
  generateAgentDraft,
  validateTransferAssessment,
} from "../scripts/advanced-generation.mjs";

const quote =
  "Plants release dioxygen during water splitting. Chlorophyll captures light energy. During photosynthesis, light energy becomes chemical energy that supports cell metabolism.";
const source = {
  id: "87c4bdbe-5019-4e88-876e-af710d8838c7",
  name: "Plant mechanisms",
  type: "notes",
  role: "material",
  passages: [{ id: "plant-mechanisms", label: "Mechanisms", text: quote }],
  warnings: [],
  pageCount: 0,
  addedAt: "2026-10-29T00:00:00.000Z",
  fingerprint: "advanced-fixture",
};
const task = {
  topic: "Photosynthesis",
  goal: "Explain the mechanism of oxygen release and the conversion of energy in plants.",
  level: "explain",
  previousQuestions: [],
};
const candidate = (answerPhrase, changes = {}) => ({
  evidenceId: "E1",
  answerPhrase,
  learningObjective: `Explain the relationship involving ${answerPhrase}.`,
  ...changes,
});
const candidates = () => ({
  candidates: [candidate("water splitting"), candidate("chemical energy")],
  gaps: [],
});
const questions = {
  "water splitting":
    "Which mechanism explains why dioxygen can be released during photosynthesis?",
  "chemical energy":
    "How does the form of energy change when photosynthesis captures sunlight?",
  "cell metabolism": "How does converted energy support a plant's cells?",
};
const observations = {
  "water splitting": "dioxygen is released during photosynthesis",
  "chemical energy": "captured light supports cell metabolism",
  "cell metabolism": "plant cells can use converted energy",
};
const misconceptions = {
  "water splitting":
    "Dioxygen release during photosynthesis comes from cloud movement",
  "chemical energy": "Photosynthesis converts light into sound energy",
  "cell metabolism":
    "Converted energy supports rock formation rather than cell activity",
};
const allAnswers = Object.keys(questions);
function writeQuestion(answer, level = "explain") {
  assert.ok(questions[answer], `Unexpected fixture answer: ${answer}`);
  return {
    title: `Explain ${answer}`,
    ...(level === "foundation"
      ? { question: questions[answer] }
      : level === "apply"
        ? { misconception: misconceptions[answer] }
        : { observation: observations[answer] }),
    distractors:
      answer === "chemical energy"
        ? ["sound energy", "gravitational energy"]
        : ["rock formation", "cloud movement"],
  };
}
const assessment = (changes = {}) => ({
  cognitiveOperation: "causal_explanation",
  operationRationale:
    "The learner connects an observed result to the source's stated mechanism.",
  scenarioEssential: false,
  matchesGoal: true,
  appropriateChallenge: true,
  newQuestion: "new",
  premisesSupported: true,
  reason:
    "The question asks for a supported relationship within the assigned goal.",
  ...changes,
});
const transferAssessment = (changes = {}) => ({
  answerFitReason:
    "The selected answer preserves the subject and relationship asked about.",
  answerFitsQuestion: true,
  challengeReason:
    "The learner explains the stated mechanism rather than naming a fact.",
  cognitiveOperation: "causal_explanation",
  changedCondition: "",
  scenarioEssential: false,
  noveltyReason: "This tests a relationship not asked in the prior questions.",
  newQuestion: "new",
  ...changes,
});
function approved(items) {
  return {
    checks: Object.fromEntries(
      items.map((item) => {
        const check = {
          verdict: "supported",
          answerIndex: -1,
          reason: "The cited passage supports the item.",
        };
        if (item.type === "multiple-choice question") {
          const correct = item.content.options.findIndex((option) =>
            allAnswers.includes(option),
          );
          assert.ok(correct >= 0, JSON.stringify(item));
          Object.assign(check, {
            answerIndex: correct,
            supportingQuote: item.evidence[0],
            optionChecks: Object.fromEntries(
              item.content.options.map((_, index) => [
                String(index),
                {
                  verdict: index === correct ? "answers" : "does_not_answer",
                  reason:
                    index === correct
                      ? "This is the relationship stated in the source."
                      : "This choice does not explain the stated relationship.",
                },
              ]),
            ),
            assessment: assessment(),
          });
        }
        return [item.id, check];
      }),
    ),
  };
}
function model({
  extract = candidates,
  author,
  review = approved,
  transfer = () => transferAssessment(),
  beforeRequest,
} = {}) {
  const calls = {
    extraction: [],
    author: [],
    review: [],
    transfer: [],
    all: [],
  };
  return {
    calls,
    fetcher: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(init.body),
        input = JSON.parse(body.messages[1].content);
      const request = { body, input };
      calls.all.push(request);
      if (beforeRequest) await beforeRequest(request, calls);
      let value;
      if (body.format.properties.candidates) {
        calls.extraction.push(request);
        value = await extract(calls.extraction.length, request);
        // Fixture shorthand names desired source phrases; the actual provider
        // contract can return only application-owned candidate IDs.
        value = {
          ...value,
          candidates: value.candidates.map((candidate) => {
            if (candidate.candidateId) return candidate;
            const selected = input.answerCandidates.find(
              (item) =>
                item.text.toLowerCase() ===
                  candidate.answerPhrase?.toLowerCase() &&
                item.evidenceId === candidate.evidenceId,
            );
            return {
              candidateId: selected?.id || "invented",
              learningObjective: candidate.learningObjective,
            };
          }),
        };
      } else if (body.format.properties.checks) {
        calls.review.push(request);
        value = await review(input.items, calls.review.length, request);
      } else if (body.format.properties.answerFitsQuestion) {
        calls.transfer.push(request);
        value = await transfer(input, calls.transfer.length, request);
      } else {
        calls.author.push(request);
        value = author
          ? await author(calls.author.length, request)
          : writeQuestion(input.candidate.answer, input.task.level);
      }
      return Response.json({
        done: true,
        message: { content: JSON.stringify(value) },
      });
    },
  };
}
const generate = (localModel, options = {}) =>
  generateAdvancedDraft(
    [source],
    "fixture-model",
    options.signal || new AbortController().signal,
    localModel.fetcher,
    () => {},
    { task, ...options, signal: undefined },
  );

test("advanced generation fixes validated source answers and independently reviews two distinct questions", async () => {
  const localModel = model();
  const result = await generate(localModel);
  assert.deepEqual(result.reviewProblems, []);
  assert.equal(result.draft.units.length, 2);
  assert.equal(result.draft.questions.length, 2);
  assert.ok(
    result.draft.units.every(
      (unit) => unit.title === `${task.topic}: causal practice`,
    ),
  );
  assert.deepEqual(
    result.draft.units.map((unit) => unit.recallAnswer),
    ["water splitting", "chemical energy"],
  );
  assert.equal(new Set(result.draft.units.map((unit) => unit.id)).size, 2);
  assert.equal(
    new Set(result.draft.questions.map((question) => question.id)).size,
    2,
  );
  assert.ok(
    result.draft.questions.every((question) =>
      result.draft.units.some((unit) => unit.id === question.unitId),
    ),
  );
  assert.equal(localModel.calls.extraction.length, 1);
  const selection = localModel.calls.extraction[0];
  assert.equal(
    selection.body.format.properties.candidates.items.properties.answerPhrase,
    undefined,
  );
  assert.deepEqual(
    selection.body.format.properties.candidates.items.properties.candidateId
      .enum,
    selection.input.answerCandidates.map((item) => item.id),
  );
  assert.equal(localModel.calls.author.length, 2);
  assert.equal(localModel.calls.review.length, 2);
  assert.equal(localModel.calls.transfer.length, 2);
  assert.equal(localModel.calls.all.length, 7);
  assert.deepEqual(
    localModel.calls.all.map(({ body }) =>
      body.format.properties.candidates
        ? "extract"
        : body.format.properties.checks
          ? "review"
          : body.format.properties.answerFitsQuestion
            ? "transfer"
            : "author",
    ),
    ["extract", "author", "review", "transfer", "author", "review", "transfer"],
  );
  for (const request of localModel.calls.transfer) {
    assert.ok(allAnswers.includes(request.input.answer));
    assert.equal(request.body.format.additionalProperties, false);
    assert.deepEqual(
      request.body.format.required.slice().sort(),
      Object.keys(transferAssessment()).sort(),
    );
  }
  for (const request of localModel.calls.author) {
    assert.deepEqual(Object.keys(request.body.format.properties).sort(), [
      "distractors",
      "observation",
      "title",
    ]);
    assert.equal(request.body.format.additionalProperties, false);
    assert.ok(allAnswers.includes(request.input.candidate.answer));
    assert.equal(request.body.format.properties.observation.maxLength, 120);
  }
  for (const request of localModel.calls.review) {
    assert.ok(!JSON.stringify(request.input).includes('"correctIndex"'));
    assert.ok(!JSON.stringify(request.input).includes('"expectedAnswer"'));
    assert.ok(!JSON.stringify(request.input).includes('"recallAnswer"'));
    const question = request.input.items.find(
      (item) => item.type === "multiple-choice question",
    );
    const shape = request.body.format.properties.checks.properties[question.id];
    assert.equal(shape.properties.assessment.additionalProperties, false);
    assert.deepEqual(
      shape.properties.assessment.required.slice().sort(),
      Object.keys(assessment()).sort(),
    );
    assert.ok(question.evidence.every((text) => quote.includes(text)));
  }
  assert.deepEqual(
    result.draft.questions.map((question) => question.prompt),
    [
      `Which source excerpt best explains why ${observations["water splitting"]}?`,
      `Which source excerpt best explains why ${observations["chemical energy"]}?`,
    ],
  );
});

test("application uses an app-owned correction stem and quotes the learner misconception", async () => {
  const localModel = model({
    review: (items) => {
      const result = approved(items);
      for (const item of items)
        result.checks[item.id].assessment = assessment({
          cognitiveOperation: "application",
          scenarioEssential: true,
        });
      return result;
    },
    transfer: () =>
      transferAssessment({
        cognitiveOperation: "application",
        changedCondition:
          "The learner has replaced the cited mechanism with a conflicting explanation.",
        scenarioEssential: true,
      }),
  });
  const result = await generate(localModel, {
    task: { ...task, level: "apply" },
  });
  assert.equal(result.draft.units.length, 2);
  assert.ok(
    result.draft.units.every(
      (unit) => unit.title === `${task.topic}: diagnostic practice`,
    ),
  );
  assert.deepEqual(
    result.draft.questions.map((question) => question.prompt),
    [
      `A learner claims: “${misconceptions["water splitting"]}”. Which source excerpt best corrects their reasoning?`,
      `A learner claims: “${misconceptions["chemical energy"]}”. Which source excerpt best corrects their reasoning?`,
    ],
  );
  for (const request of localModel.calls.author) {
    assert.deepEqual(Object.keys(request.body.format.properties).sort(), [
      "distractors",
      "misconception",
      "title",
    ]);
    assert.equal(request.body.format.properties.misconception.maxLength, 130);
    assert.equal(request.body.format.properties.question, undefined);
  }
  assert.equal(localModel.calls.review.length, 2);
  assert.equal(localModel.calls.transfer.length, 2);
});

test("application rejects a claim that gives away the key by repeating its words", async () => {
  const localModel = model({
    author: (_attempt, request) => ({
      ...writeQuestion(request.input.candidate.answer, "apply"),
      misconception: `It cannot involve ${request.input.candidate.answer}`,
    }),
  });
  await assert.rejects(
    () => generate(localModel, { task: { ...task, level: "apply" } }),
    /Rephrase the situation/,
  );
  assert.equal(localModel.calls.review.length, 0);
});

test("the causal stem hides an answer-bearing cause while preserving the observed result and source", async () => {
  const localModel = model({
    author: (_call, request) => ({
      ...writeQuestion(request.input.candidate.answer, "explain"),
      observation:
        request.input.candidate.answer === "water splitting"
          ? "Plants normally release dioxygen as a byproduct of water splitting."
          : "Plant cells receive usable energy",
    }),
  });
  const result = await generate(localModel);
  assert.equal(
    result.draft.questions[0].prompt,
    "Which source excerpt best explains why Plants normally release dioxygen?",
  );
  assert.equal(result.draft.units[0].recallAnswer, "water splitting");
  assert.equal(result.draft.questions[0].citations[0].quote, quote);
  assert.equal(localModel.calls.author.length, 2);
  assert.equal(localModel.calls.transfer.length, 2);
});

test("explanation observations trim terminal sentence marks before the app adds its question stem", async () => {
  const localModel = model({
    author: (_attempt, request) => ({
      ...writeQuestion(request.input.candidate.answer),
      observation: `${observations[request.input.candidate.answer]}.!?`,
    }),
  });
  const result = await generate(localModel);
  assert.deepEqual(
    result.draft.questions.map((question) => question.prompt),
    [
      `Which source excerpt best explains why ${observations["water splitting"]}?`,
      `Which source excerpt best explains why ${observations["chemical energy"]}?`,
    ],
  );
});

test("advanced writer contracts reject question overrides and wrong or oversized scaffold fields", async () => {
  for (const level of ["explain", "apply"]) {
    const field = level === "explain" ? "observation" : "misconception";
    const otherField = level === "explain" ? "misconception" : "observation";
    for (const changes of [
      { question: "Can the model replace the application-owned question?" },
      { [field]: "" },
      { [field]: "x".repeat(level === "explain" ? 121 : 131) },
      { [otherField]: "An unrequested field" },
    ]) {
      const localModel = model({
        author: (_attempt, request) => ({
          ...writeQuestion(request.input.candidate.answer, level),
          ...changes,
        }),
      });
      await assert.rejects(() =>
        generate(localModel, { task: { ...task, level } }),
      );
      assert.equal(localModel.calls.review.length, 0);
      assert.equal(localModel.calls.transfer.length, 0);
      assert.ok(localModel.calls.author.length <= 3);
    }
  }
});

test("explanation observations cannot reveal the fixed mechanism by exact answer text or reordered content words", async () => {
  for (const observation of [
    (answer) => `the observation is ${answer.toUpperCase()}`,
    (answer) =>
      `the result involves ${answer.split(" ").reverse().join(" and ")}`,
  ]) {
    const localModel = model({
      author: (_attempt, request) => ({
        ...writeQuestion(request.input.candidate.answer),
        observation: observation(request.input.candidate.answer),
      }),
    });
    await assert.rejects(
      () => generate(localModel),
      /State only the observed result; omit the mechanism/,
    );
    assert.equal(localModel.calls.author.length, 3);
    assert.equal(localModel.calls.review.length, 0);
    assert.equal(localModel.calls.transfer.length, 0);
    assert.ok(
      localModel.calls.author[1].input.fixTheseProblems.some((message) =>
        message.includes("omit the mechanism"),
      ),
    );
  }
});

test("candidate extraction rejects bad identifiers, paraphrases and partial words while retaining exact valid candidates", async () => {
  const localModel = model({
    extract: () => ({
      candidates: [
        candidate("water splitting", { evidenceId: "invented" }),
        candidate("oxygen"),
        candidate("turning sunlight into fuel"),
        candidate("chemical energy that"),
        candidate("WATER SPLITTING"),
        candidate("chemical energy"),
      ],
      gaps: [],
    }),
  });
  const result = await generate(localModel);
  assert.equal(localModel.calls.extraction.length, 1);
  assert.deepEqual(
    result.draft.units.map((unit) => unit.recallAnswer),
    ["water splitting", "chemical energy"],
  );
  assert.ok(
    result.draft.units.every((unit) =>
      unit.citations.every(
        (citation) => citation.passageId === source.passages[0].id,
      ),
    ),
  );
});

test("a long-source key-point fallback cannot expose the selected answer to the blind reviewer", async () => {
  const longQuote =
    "Plants release dioxygen during water splitting, while chlorophyll captures light energy and photosynthesis converts this input into chemical energy that supports cell metabolism throughout the plant's ordinary biological activities.";
  assert.ok(longQuote.length > 180 && longQuote.length < 500);
  const longSource = {
    ...source,
    passages: [{ ...source.passages[0], text: longQuote }],
  };
  const localModel = model();
  const result = await generateAdvancedDraft(
    [longSource],
    "fixture-model",
    new AbortController().signal,
    localModel.fetcher,
    () => {},
    { task },
  );
  assert.ok(
    result.draft.units.every((unit) =>
      unit.keyPoints.includes(unit.recallAnswer),
    ),
  );
  for (const request of localModel.calls.review) {
    const study = request.input.items.find(
      (item) => item.type === "study topic",
    );
    assert.equal(
      study,
      undefined,
      "source-extract cards cannot leak the key through a duplicate review item",
    );
    assert.equal(request.input.items.length, 1);
  }
});

test("two failed extraction attempts cannot invent an answer or proceed to question writing", async () => {
  const localModel = model({
    extract: () => ({
      candidates: [
        candidate("oxygen"),
        candidate("chemical energy", { evidenceId: "missing" }),
      ],
      gaps: [],
    }),
  });
  await assert.rejects(() => generate(localModel));
  assert.equal(localModel.calls.extraction.length, 2);
  assert.equal(localModel.calls.author.length, 0);
  assert.equal(localModel.calls.review.length, 0);
});

test("the writer cannot replace a fixed answer or citation through extra fields", async () => {
  const localModel = model({
    author: (_attempt, request) => ({
      ...writeQuestion(request.input.candidate.answer),
      answer: "invented answer",
      citations: [{ evidenceId: "invented" }],
    }),
  });
  await assert.rejects(() => generate(localModel));
  assert.ok(localModel.calls.author.length <= 3);
  assert.equal(localModel.calls.review.length, 0);
});

test("advanced review rejects an independently selected key that disagrees with the fixed source answer", async () => {
  const localModel = model({
    review: (items) => {
      const result = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      )) {
        const check = result.checks[item.id];
        check.answerIndex =
          (check.answerIndex + 1) % item.content.options.length;
        for (const [index, option] of Object.entries(check.optionChecks))
          option.verdict =
            Number(index) === check.answerIndex ? "answers" : "does_not_answer";
      }
      return result;
    },
  });
  await assert.rejects(() => generate(localModel));
  assert.ok(localModel.calls.review.length > 0);
  assert.ok(localModel.calls.author.length <= 3);
  assert.equal(localModel.calls.transfer.length, 0);
});

test("advanced review requires goal relevance, real challenge, novelty and supported premises", async () => {
  for (const rejected of [
    "matchesGoal",
    "appropriateChallenge",
    "newQuestion",
    "premisesSupported",
  ]) {
    const localModel = model({
      review: (items) => {
        const result = approved(items);
        for (const item of items.filter(
          (item) => item.type === "multiple-choice question",
        ))
          result.checks[item.id].assessment = assessment({
            [rejected]: rejected === "newQuestion" ? "repeated" : false,
            reason: `The item fails ${rejected}.`,
          });
        return result;
      },
    });
    await assert.rejects(() => generate(localModel));
    assert.ok(localModel.calls.review.length > 0, rejected);
    assert.ok(localModel.calls.author.length <= 3, rejected);
    assert.equal(localModel.calls.transfer.length, 0, rejected);
  }
});

test("observed naming-recall approval cannot pass the explanation gate just because appropriateChallenge is true", async () => {
  const localModel = model({
    author: (_attempt, request) => ({
      ...writeQuestion(request.input.candidate.answer),
      observation:
        request.input.candidate.answer === "water splitting"
          ? "the emitted gas has a named source"
          : "the produced energy form has a name",
    }),
    review: (items) => {
      const result = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      ))
        result.checks[item.id].assessment = assessment({
          appropriateChallenge: true,
          cognitiveOperation: "recall",
          operationRationale:
            "The question only asks the learner to name a process or energy form stated in the source.",
        });
      return result;
    },
  });
  await assert.rejects(
    () => generate(localModel),
    /cognitiveOperation: explain requires.*not recall/,
  );
  assert.ok(localModel.calls.review.length > 0);
  assert.ok(
    localModel.calls.review.every((request) =>
      /Classify the ACTUAL cognitiveOperation/.test(
        request.body.messages[0].content,
      ),
    ),
  );
});

test("application rejects a scenario-only recall wrapper even when the reviewer labels it application", async () => {
  const localModel = model({
    author: (_attempt, request) => ({
      ...writeQuestion(request.input.candidate.answer, "apply"),
      misconception:
        request.input.candidate.answer === "water splitting"
          ? "A researcher watches a plant undergo photosynthesis in a laboratory"
          : "A researcher studies a greenhouse plant while photosynthesis produces energy",
    }),
    review: (items) => {
      const result = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      ))
        result.checks[item.id].assessment = assessment({
          cognitiveOperation: "application",
          appropriateChallenge: true,
          premisesSupported: true,
          scenarioEssential: false,
          operationRationale:
            "Removing the researcher or greenhouse leaves the identical factual naming question.",
        });
      return result;
    },
  });
  await assert.rejects(
    () => generate(localModel, { task: { ...task, level: "apply" } }),
    /scenarioEssential:.*not wrap fact recall/,
  );
  assert.ok(localModel.calls.review.length > 0);
});

test("operation classification enforces explanation and application while allowing foundation recall", async () => {
  for (const operation of [
    "recall",
    "causal_explanation",
    "comparison",
    "uncertain",
  ]) {
    const localModel = model({
      review: (items) => {
        const result = approved(items);
        for (const item of items.filter(
          (item) => item.type === "multiple-choice question",
        ))
          result.checks[item.id].assessment = assessment({
            cognitiveOperation: operation,
            scenarioEssential: true,
          });
        return result;
      },
    });
    await assert.rejects(
      () => generate(localModel, { task: { ...task, level: "apply" } }),
      /cognitiveOperation: apply requires application/,
    );
  }
  const foundation = model({
    review: (items) => {
      const result = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      ))
        result.checks[item.id].assessment = assessment({
          cognitiveOperation: "recall",
          scenarioEssential: false,
        });
      return result;
    },
  });
  assert.equal(
    (await generate(foundation, { task: { ...task, level: "foundation" } }))
      .draft.units.length,
    2,
  );
  const comparison = model({
    review: (items) => {
      const result = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      ))
        result.checks[item.id].assessment = assessment({
          cognitiveOperation: "comparison",
        });
      return result;
    },
  });
  assert.equal((await generate(comparison)).draft.units.length, 2);
});

test("missing or non-boolean challenge assessments fail closed", async () => {
  for (const invalid of [
    undefined,
    assessment({ appropriateChallenge: "true" }),
    assessment({ cognitiveOperation: "advanced" }),
    assessment({ cognitiveOperation: undefined }),
    assessment({ operationRationale: "" }),
    assessment({ scenarioEssential: "true" }),
    { ...assessment(), extra: true },
  ]) {
    const localModel = model({
      review: (items) => {
        const result = approved(items);
        for (const item of items.filter(
          (item) => item.type === "multiple-choice question",
        ))
          result.checks[item.id].assessment = invalid;
        return result;
      },
    });
    await assert.rejects(() => generate(localModel));
    assert.ok(localModel.calls.review.length > 0);
  }
});

test("a repeated previous question is repaired without spending an independent review on it", async () => {
  const previous = `Which source excerpt best explains why ${observations["water splitting"]}?`;
  const localModel = model({
    author: (_attempt, request) => ({
      ...writeQuestion(request.input.candidate.answer),
      observation: observations["water splitting"],
    }),
  });
  await assert.rejects(() =>
    generate(localModel, {
      task: { ...task, previousQuestions: [previous.toUpperCase()] },
    }),
  );
  assert.ok(localModel.calls.author.length <= 3);
  assert.equal(localModel.calls.review.length, 0);
});

test("an approved question is preserved when a later candidate repeatedly fails review", async () => {
  const localModel = model({
    review: (items) => {
      const result = approved(items);
      for (const item of items.filter(
        (item) => item.type === "multiple-choice question",
      )) {
        if (item.content.options.includes("chemical energy"))
          result.checks[item.id].assessment = assessment({
            premisesSupported: false,
            reason: "The proposed premise is not supported.",
          });
      }
      return result;
    },
  });
  const result = await generate(localModel);
  assert.equal(result.draft.units.length, 1);
  assert.equal(result.draft.units[0].recallAnswer, "water splitting");
  assert.equal(result.draft.questions.length, 1);
  assert.ok(result.draft.gaps.length > 0);
  assert.equal(
    localModel.calls.author.filter(
      (request) => request.input.candidate.answer === "water splitting",
    ).length,
    1,
  );
  assert.ok(
    localModel.calls.author.filter(
      (request) => request.input.candidate.answer === "chemical energy",
    ).length <= 2,
  );
});

test("an approved question is preserved when a later candidate fails the focused transfer gate", async () => {
  const localModel = model({
    transfer: (input) =>
      transferAssessment(
        input.answer === "chemical energy"
          ? {
              answerFitsQuestion: false,
              answerFitReason:
                "The selected source fragment does not answer this question's subject.",
            }
          : {},
      ),
  });
  const result = await generate(localModel);
  assert.equal(result.draft.units.length, 1);
  assert.equal(result.draft.units[0].recallAnswer, "water splitting");
  assert.equal(localModel.calls.author.length, 3);
  assert.equal(localModel.calls.review.length, 3);
  assert.equal(localModel.calls.transfer.length, 3);
  assert.equal(
    localModel.calls.author.filter(
      (request) => request.input.candidate.answer === "water splitting",
    ).length,
    1,
  );
  assert.ok(result.draft.gaps.some((gap) => /omitted|limited/i.test(gap)));
});

// Captured qwen transfer-review responses, embedded so CI never reads local
// run artifacts or treats a fixture replay as a fresh model-quality evaluation.
const recordedTransferVerdicts = [
  {
    label: "causal water-splitting explanation",
    level: "explain",
    accepted: true,
    value: {
      answerFitReason:
        "The answer directly addresses the 'why' in the question by identifying 'water splitting' as the specific process causing oxygen release, which is explicitly stated in the evidence.",
      answerFitsQuestion: true,
      challengeReason:
        "The question asks for the causal mechanism (why oxygen is released), requiring the examinee to connect the process of water splitting to the production of oxygen, rather than just recalling that oxygen is released.",
      cognitiveOperation: "causal_explanation",
      changedCondition: "",
      scenarioEssential: false,
      noveltyReason:
        "The previous questions ask about energy conversion, the specific byproduct name, and reactants. None of them ask for the causal mechanism linking water splitting to oxygen release.",
      newQuestion: "new",
    },
  },
  {
    label: "CO2 question with a sugar-synthesis answer fragment",
    level: "explain",
    accepted: false,
    value: {
      answerFitReason:
        "The answer directly addresses the question by identifying the specific process (Calvin cycle) where atmospheric CO2 is incorporated into organic compounds, matching the evidence provided.",
      answerFitsQuestion: true,
      challengeReason:
        "The question asks for the mechanism of incorporation, requiring the examinee to identify the specific phase of photosynthesis responsible for carbon fixation.",
      cognitiveOperation: "recall",
      changedCondition: "",
      scenarioEssential: false,
      noveltyReason:
        "The question tests a specific fact (the role of the Calvin cycle) that is not covered by the previous questions, which focus on energy conversion, byproducts, reactants, and oxygen release.",
      newQuestion: "new",
    },
  },
  {
    label: "if-water-splits oxygen recall wrapper",
    level: "apply",
    accepted: false,
    value: {
      answerFitReason:
        "The answer directly states that oxygen is released as a byproduct of water splitting, which matches the subject (oxygenic photosynthesis), the condition (splitting water), and the query (what substance is released).",
      answerFitsQuestion: true,
      challengeReason:
        "The question asks for a specific fact (the byproduct) based on a defined condition (oxygenic photosynthesis/water splitting). The evidence explicitly confirms this relationship. The cognitive operation is recall because the question asks 'what is produced' given a specific process, which is a direct",
      cognitiveOperation: "recall",
      changedCondition: "",
      scenarioEssential: false,
      noveltyReason:
        "The previousQuestions list includes 'What is released as a byproduct of water splitting in oxygenic photosynthesis?', which is a verbatim or near-verbatim paraphrase of the current question asking for the same fact with the same operation.",
      newQuestion: "repeated",
    },
  },
  {
    label: "if-plant-uses-sunlight carbohydrate recall wrapper",
    level: "apply",
    accepted: false,
    value: {
      answerFitReason:
        "The answer 'carbohydrates like sugars' directly addresses the question's query about the specific type of organic compound synthesized and stored, matching the evidence provided.",
      answerFitsQuestion: true,
      challengeReason:
        "The question asks for a specific outcome (the product) of a described process (photosynthesis). While the evidence states that energy is stored in 'complex compounds containing carbon', typically 'carbohydrates like sugars', the question requires identifying this specific category from the general '",
      cognitiveOperation: "recall",
      changedCondition: "",
      scenarioEssential: false,
      noveltyReason:
        "The previous question 'Which substances serve as the specific reactants that plants combine using sunlight to synthesize carbohydrates?' explicitly mentions 'synthesize carbohydrates', directly testing the same fact regarding the product of photosynthesis.",
      newQuestion: "repeated",
    },
  },
];

test("captured transfer reviews accept the causal explanation and reject subject-fragment recall and both if wrappers", () => {
  for (const entry of recordedTransferVerdicts) {
    const errors = validateTransferAssessment(entry.value, entry.level);
    assert.equal(
      errors.length === 0,
      entry.accepted,
      `${entry.label}: ${errors.join("; ")}`,
    );
  }
});

test("transfer approval requires answer fit, new material, and a substantive changed condition for application", () => {
  assert.ok(
    validateTransferAssessment(
      transferAssessment({ answerFitsQuestion: false }),
      "explain",
    ).length,
  );
  for (const newQuestion of ["repeated", "uncertain"])
    assert.ok(
      validateTransferAssessment(transferAssessment({ newQuestion }), "explain")
        .length,
    );
  const application = transferAssessment({
    cognitiveOperation: "application",
    changedCondition:
      "Water splitting is blocked while other conditions remain the same.",
    scenarioEssential: true,
  });
  assert.deepEqual(validateTransferAssessment(application, "apply"), []);
  assert.ok(
    validateTransferAssessment(
      { ...application, scenarioEssential: false },
      "apply",
    ).length,
  );
  assert.ok(
    validateTransferAssessment(
      { ...application, changedCondition: " \n " },
      "apply",
    ).length,
  );
  assert.ok(
    validateTransferAssessment(
      { ...application, cognitiveOperation: "uncertain" },
      "apply",
    ).length,
  );
});

test("missing, extra, oversized and wrong-type transfer fields cannot become approval", async () => {
  const missing = transferAssessment();
  delete missing.answerFitsQuestion;
  const invalids = [
    missing,
    { ...transferAssessment(), extra: true },
    transferAssessment({ answerFitsQuestion: "true" }),
    transferAssessment({ cognitiveOperation: "advanced" }),
    transferAssessment({ changedCondition: "x".repeat(241) }),
    transferAssessment({ challengeReason: "x".repeat(301) }),
  ];
  for (const invalid of invalids) {
    assert.throws(() => validateTransferAssessment(invalid, "explain"));
    const localModel = model({ transfer: () => invalid });
    await assert.rejects(() => generate(localModel));
    assert.equal(localModel.calls.transfer.length, 3);
    assert.equal(localModel.calls.author.length, 3);
  }
});

test("candidate and per-item retry budgets stay within eleven generation calls including transfer review", async () => {
  const localModel = model({
    extract: (attempt) =>
      attempt === 1
        ? { candidates: [candidate("oxygen")], gaps: [] }
        : candidates(),
    transfer: () =>
      transferAssessment({
        cognitiveOperation: "recall",
        challengeReason: "This is recall rather than explanation.",
      }),
  });
  await assert.rejects(() => generate(localModel));
  assert.equal(localModel.calls.extraction.length, 2);
  assert.equal(localModel.calls.author.length, 3);
  assert.equal(localModel.calls.review.length, 3);
  assert.equal(localModel.calls.transfer.length, 3);
  assert.equal(localModel.calls.all.length, 11);
});

test("abort and agent-budget failures propagate without additional attempts", async () => {
  const stopped = new AbortController();
  stopped.abort(new Error("Stop this run."));
  const untouched = model();
  await assert.rejects(() => generate(untouched, { signal: stopped.signal }));
  assert.equal(untouched.calls.all.length, 0);
  const budgetError = Object.assign(
    new Error("This task reached its 12-call limit."),
    { code: "agent_budget" },
  );
  const budget = model({
    beforeRequest: () => {
      throw budgetError;
    },
  });
  await assert.rejects(
    () => generate(budget),
    (error) => error === budgetError,
  );
  assert.equal(budget.calls.all.length, 1);
  const during = new AbortController();
  const cancelled = model({
    beforeRequest: () => {
      during.abort(new Error("Cancelled during model call."));
      during.signal.throwIfAborted();
    },
  });
  await assert.rejects(() => generate(cancelled, { signal: during.signal }));
  assert.equal(cancelled.calls.all.length, 1);
});

test("abort and budget failures during focused transfer review propagate without another model call", async () => {
  const budgetError = Object.assign(
    new Error("This task reached its 12-call limit."),
    { code: "agent_budget" },
  );
  const budget = model({
    transfer: () => {
      throw budgetError;
    },
  });
  await assert.rejects(
    () => generate(budget),
    (error) => error === budgetError,
  );
  assert.equal(budget.calls.all.length, 4);
  assert.equal(budget.calls.transfer.length, 1);
  const controller = new AbortController();
  const reason = new Error("Cancelled during transfer assessment.");
  const stopped = model({
    transfer: () => {
      controller.abort(reason);
      controller.signal.throwIfAborted();
    },
  });
  await assert.rejects(
    () => generate(stopped, { signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(stopped.calls.all.length, 4);
  assert.equal(stopped.calls.transfer.length, 1);
});

test("the dispatcher retains the foundation exact-phrase generator", async () => {
  let authorCalls = 0,
    reviewCalls = 0;
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body),
      input = JSON.parse(body.messages[1].content);
    assert.equal(body.format.properties.candidates, undefined);
    let value;
    if (body.format.properties.checks) {
      reviewCalls++;
      value = approved(input.items);
      for (const check of Object.values(value.checks)) delete check.assessment;
    } else {
      authorCalls++;
      assert.equal(body.format.properties.topics.type, "array");
      value = {
        title: "Water splitting",
        topics: [
          {
            title: "Water splitting",
            question: "Which mechanism releases dioxygen?",
            answerEvidenceId: "E1",
            answerPhrase: "water splitting",
            distractors: ["rock formation", "cloud movement"],
            citations: [{ evidenceId: "E1" }],
          },
        ],
        gaps: [],
      };
    }
    return Response.json({
      done: true,
      message: { content: JSON.stringify(value) },
    });
  };
  const result = await generateAgentDraft(
    [source],
    "fixture-model",
    new AbortController().signal,
    fetcher,
    () => {},
    { task: { ...task, level: "foundation" } },
  );
  assert.equal(result.draft.units[0].recallAnswer, "water splitting");
  assert.equal(authorCalls, 1);
  assert.equal(reviewCalls, 1);
});

test("foundation follow-ups use fixed candidates with novelty checks", async () => {
  const localModel = model();
  const result = await generateAgentDraft(
    [source],
    "fixture-model",
    new AbortController().signal,
    localModel.fetcher,
    () => {},
    {
      task: {
        ...task,
        level: "foundation",
        previousQuestions: ["What are chloroplasts?"],
      },
    },
  );
  assert.equal(localModel.calls.extraction.length, 1);
  assert.equal(result.draft.units.length, 2);
  assert.equal(localModel.calls.review.length, 2);
  assert.equal(localModel.calls.transfer.length, 0);
  assert.ok(
    localModel.calls.author.every(
      (request) =>
        Object.keys(request.body.format.properties).sort().join(",") ===
        "distractors,question,title",
    ),
  );
});
