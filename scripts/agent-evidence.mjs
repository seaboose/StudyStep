// Source views are exact substrings. Full snapshots remain in the durable task.
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const stop = new Set(
  "a an the and or but for from with into through that this these those what which why how when where do does did is are was were be been being can could would should of in on at to as by it its their understand explain learn learning topic goal compare describe use uses using process processes".split(
    " ",
  ),
);
const terms = (text) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
      .filter((word) => !stop.has(word))
      .map((word) => word.replace(/s$/, "")),
  );
const sentenceEnd = (text) => /[.!?]["')\]]?$/.test(text.trim());

export function selectAgentEvidence(sources, task, budget = 2400) {
  const followup =
    task.level !== "foundation" || task.previousQuestions?.length;
  if (!followup) {
    let remaining = budget;
    return sources
      .map((source) => ({
        ...source,
        passages: source.passages.flatMap((passage) => {
          if (remaining < 12) return [];
          let text = passage.text;
          if (text.length > remaining) {
            const prefix = text.slice(0, remaining);
            const ending = [...prefix.matchAll(/[.!?]["')\]]?(?=\s|$)/gu)].at(
              -1,
            );
            if (!ending) return [];
            text = prefix.slice(0, ending.index + ending[0].length);
          }
          remaining -= text.length;
          return [{ ...passage, text }];
        }),
      }))
      .filter((source) => source.passages.length);
  }

  const wanted = terms(task.topic + " " + task.goal);
  const weak = terms(
    (task.learningSignals || [])
      .filter((signal) => signal.outcome !== "correct")
      .map((signal) => signal.question)
      .join(" "),
  );
  const previous = (task.previousQuestions || []).map(terms);
  const windows = [];
  for (const [sourceIndex, source] of sources.entries()) {
    if (source.role !== "material") continue;
    for (const [passageIndex, passage] of source.passages.entries()) {
      const segments = [...segmenter.segment(passage.text)];
      const startsInsideSentence =
        passageIndex > 0 &&
        !sentenceEnd(source.passages[passageIndex - 1].text);
      for (
        let index = startsInsideSentence ? 1 : 0;
        index < segments.length;
        index++
      ) {
        const segment = segments[index];
        if (
          !sentenceEnd(segment.segment) ||
          segment.segment.trim().length < 12 ||
          segment.segment.trim().length > 580
        )
          continue;
        let end = segment.index + segment.segment.length;
        // Preserve adjacent context when it fits, rather than stitching disjoint sentences.
        if (
          index + 1 < segments.length &&
          sentenceEnd(segments[index + 1].segment) &&
          end + segments[index + 1].segment.length - segment.index <= 580
        )
          end += segments[index + 1].segment.length;
        const text = passage.text.slice(segment.index, end).trim();
        const words = terms(text);
        const relevance = [...wanted].filter((word) => words.has(word)).length;
        const repeated = Math.max(
          0,
          ...previous.map(
            (question) =>
              [...question].filter((word) => words.has(word)).length /
              Math.max(1, question.size),
          ),
        );
        const relationships = (
          text.match(
            /\b(because|therefore|whereas|unlike|depends|convert\w*|absor\w*|releas\w*|produc\w*|reduc\w*|increas\w*|decreas\w*|energy|reaction\w*|instead|stored|requires?)\b/gi,
          ) || []
        ).length;
        const score =
          relevance * 3 +
          [...weak].filter((word) => words.has(word)).length * 2 +
          Math.min(relationships, 4) * 0.6 -
          repeated * 5;
        windows.push({ sourceIndex, passageIndex, text, score, relevance });
      }
    }
  }
  windows.sort(
    (a, b) =>
      b.score - a.score ||
      a.sourceIndex - b.sourceIndex ||
      a.passageIndex - b.passageIndex,
  );
  let remaining = budget;
  const chosen = new Map();
  for (const candidate of windows) {
    const key = `${candidate.sourceIndex}:${candidate.passageIndex}`;
    if (chosen.has(key) || candidate.text.length > remaining) continue;
    // If relevant evidence exists, don't spend the context on unrelated research results.
    if (!candidate.relevance && windows.some((window) => window.relevance > 0))
      continue;
    chosen.set(key, candidate.text);
    remaining -= candidate.text.length;
  }
  return sources
    .map((source, sourceIndex) => ({
      ...source,
      passages: source.passages.flatMap((passage, passageIndex) => {
        const text = chosen.get(`${sourceIndex}:${passageIndex}`);
        return text ? [{ ...passage, text }] : [];
      }),
    }))
    .filter((source) => source.passages.length);
}
