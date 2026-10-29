const normal = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
const completePhrase = (source, text) => {
  const phrase = normal(text).replace(/[.!?]$/, "");
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(normal(source));
};
const supportedText = (text, citations) =>
  citations.some((c) => completePhrase(c.quote, text));
const choiceText = (s) =>
  normal(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const containsChoice = (text, choice) =>
  !!choice && ` ${text} `.includes(` ${choice} `);
export function qualityProblems(guide) {
  const problems = [];
  function check(label, text, max, sentence = false) {
    if (text.length > max)
      problems.push(`${label}: use at most ${max} characters.`);
    if (/\bE\d+\b/.test(text))
      problems.push(`${label}: remove internal evidence codes.`);
    if (/\b(?:and|or|but|because|so|which|that|the)$/i.test(text.trim()))
      problems.push(`${label}: the text appears cut off.`);
    if (
      sentence &&
      (!/[.!?]["”')\]]?$/.test(text.trim()) ||
        /\b(?:and|or|but|because|so|which|that|the)[.!?]?$/i.test(text.trim()))
    )
      problems.push(`${label}: write a short complete sentence.`);
  }
  for (const u of guide.units) {
    check(u.title + " explanation", u.explanation, 600);
    check(u.title + " detail", u.detail, 600);
    if (
      !supportedText(u.explanation, u.citations) ||
      !supportedText(u.detail, u.citations)
    )
      problems.push(
        `${u.title}: study explanations must use the cited source text.`,
      );
    check("Recall question", u.recallPrompt, 240, true);
    check("Recall answer", u.recallAnswer, 300);
    u.keyPoints.forEach((p) => check("Key point", p, 180));
    if (!supportedText(u.recallAnswer, u.citations))
      problems.push(
        `${u.title}: the reference answer must be an exact phrase from a cited excerpt.`,
      );
    if (u.example || u.misconception)
      problems.push(
        `${u.title}: leave optional examples and misconceptions empty.`,
      );
  }
  for (const q of guide.questions) {
    check("Question", q.prompt, 240, true);
    check("Hint", q.hint, 160);
    q.options.forEach((o, i) => {
      check(`Option ${i + 1}`, o.text, 160);
      check(`Option ${i + 1} explanation`, o.explanation, 180, true);
    });
    if (
      q.options.some(
        (o) =>
          q.citations.some((c) => normal(c.quote).includes(normal(o.text))) &&
          !supportedText(o.text, q.citations),
      )
    )
      problems.push(
        `${q.id}: an option ends inside a source word. Use a complete phrase.`,
      );
    const choices = q.options.map((o) => choiceText(o.text));
    if (
      choices.some((a, i) =>
        choices.some(
          (b, j) => i !== j && (containsChoice(a, b) || containsChoice(b, a)),
        ),
      )
    )
      problems.push(
        `${q.id}: choices overlap or differ only in punctuation/articles. Use clearly distinct alternatives.`,
      );
    if (q.hint && containsChoice(choiceText(q.hint), choices[q.correctIndex]))
      problems.push(`${q.id}: the hint reveals the answer.`);
    if (!supportedText(q.options[q.correctIndex].text, q.citations))
      problems.push(
        `${q.id}: the correct option must be an exact phrase from a cited excerpt.`,
      );
  }
  return problems;
}
export function reviewItems(guide) {
  return [
    ...guide.units.map((u, i) => ({
      id: `unit-${i}`,
      type: "study topic",
      content: {
        explanation: u.explanation,
        detail: u.detail,
        keyPoints: u.keyPoints,
        recallPrompt: u.recallPrompt,
        recallAnswer: u.recallAnswer,
      },
      evidence: u.citations.map((c) => c.quote),
    })),
    ...guide.questions.map((q, i) => ({
      id: `question-${i}`,
      type: "multiple-choice question",
      expectedAnswer: q.correctIndex,
      content: { prompt: q.prompt, options: q.options.map((o) => o.text) },
      evidence: q.citations.map((c) => c.quote),
    })),
  ];
}
export const reviewSchema = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: {
            type: "string",
            enum: ["supported", "unsupported", "uncertain"],
          },
          answerIndex: { type: "integer", minimum: -1, maximum: 3 },
          reason: { type: "string", maxLength: 300 },
        },
        required: ["id", "verdict", "answerIndex", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["checks"],
  additionalProperties: false,
};
export function reviewRequestSchema(items) {
  const item = structuredClone(reviewSchema.properties.checks.items);
  delete item.properties.id;
  item.required = item.required.filter((k) => k !== "id");
  const schemaFor = (i) => {
    const result = structuredClone(item);
    if (i.expectedAnswer !== undefined) {
      const options = Object.fromEntries(
        i.content.options.map((_, n) => [
          String(n),
          {
            type: "object",
            properties: {
              verdict: {
                type: "string",
                enum: ["answers", "does_not_answer", "uncertain"],
              },
              reason: { type: "string", minLength: 1, maxLength: 180 },
            },
            required: ["verdict", "reason"],
            additionalProperties: false,
          },
        ]),
      );
      result.properties.optionChecks = {
        type: "object",
        properties: options,
        required: Object.keys(options),
        additionalProperties: false,
      };
      result.properties.supportingQuote = { type: "string", maxLength: 600 };
      result.required.push("optionChecks", "supportingQuote");
    }
    return result;
  };
  return {
    type: "object",
    properties: {
      checks: {
        type: "object",
        properties: Object.fromEntries(items.map((i) => [i.id, schemaFor(i)])),
        required: items.map((i) => i.id),
        additionalProperties: false,
      },
    },
    required: ["checks"],
    additionalProperties: false,
  };
}
export function validateReview(result, items) {
  if (
    result?.checks &&
    !Array.isArray(result.checks) &&
    typeof result.checks === "object"
  )
    result = {
      checks: Object.entries(result.checks).map(([id, value]) => ({
        ...value,
        id,
      })),
    };
  if (!Array.isArray(result?.checks) || result.checks.length !== items.length)
    throw Error("The evidence review did not check every topic and question.");
  const seen = new Set();
  const problems = [];
  for (const c of result.checks) {
    const item = items.find((i) => i.id === c.id);
    if (
      !item ||
      seen.has(c.id) ||
      !["supported", "unsupported", "uncertain"].includes(c.verdict) ||
      typeof c.reason !== "string" ||
      !Number.isInteger(c.answerIndex)
    )
      throw Error("The evidence review returned an incomplete result.");
    seen.add(c.id);
    if (c.verdict !== "supported")
      problems.push(`${c.id}: ${c.reason || "Source support is uncertain."}`);
    if (item.expectedAnswer === undefined) continue;
    const keys = item.content.options.map((_, i) => String(i));
    if (
      !c.optionChecks ||
      Object.keys(c.optionChecks).length !== keys.length ||
      keys.some(
        (k) =>
          !["answers", "does_not_answer", "uncertain"].includes(
            c.optionChecks[k]?.verdict,
          ) || !c.optionChecks[k]?.reason?.trim(),
      )
    )
      throw Error("The evidence review did not evaluate every answer choice.");
    const answers = keys.filter((k) => c.optionChecks[k].verdict === "answers");
    if (
      keys.some((k) => c.optionChecks[k].verdict === "uncertain") ||
      answers.length !== 1 ||
      Number(answers[0]) !== c.answerIndex ||
      c.answerIndex !== item.expectedAnswer
    )
      problems.push(
        `${c.id}: answer choices are ambiguous or the independent answer disagrees with the key.`,
      );
    if (
      typeof c.supportingQuote !== "string" ||
      c.supportingQuote.trim().length < 12 ||
      !item.evidence.some((e) => normal(e).includes(normal(c.supportingQuote)))
    )
      problems.push(
        `${c.id}: the answer check did not provide an exact supporting source excerpt.`,
      );
    else if (
      !completePhrase(
        c.supportingQuote,
        item.content.options[item.expectedAnswer],
      )
    )
      problems.push(
        `${c.id}: the supporting quote does not contain the reference answer.`,
      );
  }
  return problems;
}
export function limitGenerationSchema(schema) {
  const s = structuredClone(schema),
    u = s.properties.units.items.properties,
    q = s.properties.questions.items.properties;
  for (const [key, max] of Object.entries({
    title: 140,
    objective: 200,
    explanation: 400,
    detail: 400,
    recallPrompt: 240,
    recallAnswer: 300,
    example: 0,
    misconception: 0,
  }))
    u[key].maxLength = max;
  u.keyPoints.items.maxLength = 180;
  q.prompt.maxLength = 240;
  q.hint.maxLength = 160;
  q.options.items.properties.text.maxLength = 160;
  q.options.items.properties.explanation.maxLength = 180;
  return s;
}
export function compactGenerationSchema() {
  const str = (maxLength) => ({ type: "string", minLength: 1, maxLength });
  const obj = (properties) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  return obj({
    title: str(140),
    topics: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: obj({
        title: str(140),
        question: str(240),
        answer: str(100),
        distractors: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: str(100),
        },
        citations: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: obj({ evidenceId: str(30) }),
        },
      }),
    },
    gaps: { type: "array", maxItems: 4, items: str(300) },
  });
}
export function assembleDraft(raw, catalogue) {
  if (raw.topics) {
    // Structural IDs, answer keys and feedback are application-owned, not guessed by the model.
    raw = {
      title: raw.title,
      gaps: raw.gaps,
      units: raw.topics.map((t, i) => ({
        id: `topic-${i + 1}`,
        title: t.title,
        recallPrompt: t.question,
        recallAnswer: t.answer,
        citations: t.citations,
      })),
      questions: raw.topics.map((t, i) => {
        const options = t.distractors.map((text) => ({ text }));
        const correctIndex =
          [...t.question].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
        options.splice(correctIndex, 0, { text: t.answer });
        return {
          id: `question-${i + 1}`,
          unitId: `topic-${i + 1}`,
          prompt: t.question,
          options,
          correctIndex,
          hint: t.hint,
          citations: t.citations,
        };
      }),
    };
  }
  const refs = (item) =>
    (item.citations || []).map((c) => {
      const evidence = catalogue.get(c.evidenceId);
      if (!evidence)
        throw Error(
          "The local model selected an unknown source excerpt. Try again.",
        );
      return { passageId: evidence.passageId, quote: evidence.quote };
    });
  return {
    title: raw.title,
    units: (raw.units || []).map((u) => {
      const citations = refs(u),
        explanation = citations[0]?.quote || "",
        detail = citations[1]?.quote || explanation;
      const points = citations
        .flatMap((c) => c.quote.match(/[^.!?]+[.!?]/g) || [])
        .map((p) => p.trim())
        .filter((p) => p.length >= 12 && p.length <= 180);
      return {
        id: u.id,
        title: u.title,
        objective: "Read the source excerpt, then answer the recall question.",
        explanation,
        detail,
        keyPoints: [...new Set(points)].slice(0, 3).length
          ? [...new Set(points)].slice(0, 3)
          : [u.recallAnswer],
        example: "",
        misconception: "",
        recallPrompt: u.recallPrompt,
        recallAnswer: u.recallAnswer,
        citations,
      };
    }),
    questions: (raw.questions || []).map((q) => {
      const answer = (q.options?.[q.correctIndex]?.text || "").replace(
        /[.!?]+$/,
        "",
      );
      return {
        id: q.id,
        unitId: q.unitId,
        prompt: q.prompt,
        options: (q.options || []).map((o, i) => ({
          text: o.text,
          explanation:
            i === q.correctIndex
              ? `Source answer for this question: “${answer}”.`
              : `Compare this choice with the source answer: “${answer}”.`,
        })),
        correctIndex: q.correctIndex,
        hint: "Think of the fact stated in the source section.",
        citations: refs(q),
      };
    }),
    gaps: raw.gaps || [],
  };
}
