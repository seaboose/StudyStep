// A bounded menu of literal source phrases. Choosing a menu item never invents
// an answer or citation; semantic suitability remains the independent review's job.
const separators = new Set(
  "a an the and or but nor for from with into onto through that this these those what which why how when where who whom do does did is are was were be been being can could would should of in on at to as by it its their his her our your my some most such during while then than not only also very usually typically approximately around already existing necessary subsequent called known named discovered showed shows show said says say convert converts converted converting becomes become became captures capture captured releases release released releasing produces produce produced producing supports support supported supplies supply supplied incorporates incorporated synthesized synthesizes use uses used using make makes made need needs needed refers refer described consists containing contain contains".split(
    " ",
  ),
);
// Prepositions, articles and conjunctions can connect a complete noun phrase.
// They cannot start/end a candidate; verbs and other clause boundaries still stop it.
const interiorConnectors = new Set(
  "a an the and or for from with into onto through of in on at to as by".split(
    " ",
  ),
);
const words = (text) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
    (word) => !separators.has(word),
  );
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
const predicate =
  /^(?:am|is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|may|might|must|will|would|should|(?:absorb|bind|break|capture|caus|chang|convert|decreas|depend|increas|incorporat|metaboliz|produc|provid|reduc|releas|requir|stor|support|suppl|synthesiz|transform|transport|us)(?:e|es|s|ed|d|ing|ies|ied)?|become|becomes|became|contain|contains|contained)$/iu;
const predicateModifiers = new Set(
  "am is are was were be been being has have had do does did can could may might must will would should not never only also usually typically sometimes often always already still just".split(
    " ",
  ),
);
const incompleteEnd = new Set([
  ...interiorConnectors,
  ...predicateModifiers,
  ..."if unless although because that which who whose when where while than such".split(
    " ",
  ),
]);

function relationalPhrases(quote, evidenceId, goal) {
  const phrases = new Map();
  for (const sentence of sentences.segment(quote)) {
    // A semicolon or sentence terminator is an actual clause boundary. Commas
    // and dashes may carry necessary qualifiers, so never split on those.
    for (const match of sentence.segment.matchAll(/[^;]+(?:;|$)/gu)) {
      const clause = match[0];
      const ending = /[;.!?](?:["’”\)\]]*)\s*$/u.exec(clause);
      if (!ending) continue; // A clipped source tail is not a complete clause.
      const tokens = [
        ...clause
          .slice(0, ending.index)
          .matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu),
      ];
      if (!tokens.length || incompleteEnd.has(tokens.at(-1)[0].toLowerCase()))
        continue;
      for (let index = 0; index < tokens.length; index++) {
        if (!predicate.test(tokens[index][0])) continue;
        let start = index;
        // Preserve adjacent negation, modality and adverbs rather than offering
        // an unqualified suffix such as "release" from "may not release".
        while (start > 0) {
          const previous = tokens[start - 1];
          if (
            !/^\s+$/u.test(
              clause.slice(
                previous.index + previous[0].length,
                tokens[start].index,
              ),
            )
          )
            break;
          if (
            !predicateModifiers.has(previous[0].toLowerCase()) &&
            !/ly$/iu.test(previous[0])
          )
            break;
          start--;
        }
        // Infinitives and prepositional gerunds are not separate finite clauses.
        if (
          start > 0 &&
          /^(?:to|by|for|from|in|of|with)$/iu.test(tokens[start - 1][0])
        )
          continue;
        const text = clause.slice(tokens[start].index, ending.index).trimEnd();
        if (text.length > 100 || tokens.length - start < 2) continue;
        // A predicate inside a parenthetical must not produce a dangling suffix.
        if (
          [
            ["(", ")"],
            ["[", "]"],
          ].some(
            ([open, close]) =>
              text.split(open).length !== text.split(close).length,
          )
        )
          continue;
        const dashCount = (clause.slice(0, ending.index).match(/—/gu) || [])
          .length;
        if (dashCount >= 2 && (text.match(/—/gu) || []).length % 2) continue;
        const overlap = words(text).filter((word) => goal.has(word)).length;
        phrases.set(text.toLowerCase(), {
          text,
          evidenceId,
          score: overlap * 3 + 4 + Math.min(text.length, 50) / 50,
        });
      }
    }
  }
  return [...phrases.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}

export function asksForDestination(task) {
  return (
    task.level === "apply" &&
    /\b(?:where|destination|which (?:bin|outlet|channel|tray))\b/i.test(
      task.goal,
    )
  );
}

export function buildAnswerCandidates(evidence, task, maxBytes = 2800) {
  const goal = new Set(words(`${task.topic} ${task.goal}`));
  const groups = evidence
    .filter((item) => item.role !== "assignment")
    .map((item) => {
      const tokens = [
        ...item.quote.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu),
      ];
      const phrases = new Map();
      for (let start = 0; start < tokens.length; start++) {
        if (separators.has(tokens[start][0].toLowerCase())) continue;
        for (
          let length = 1;
          length <= 5 && start + length <= tokens.length;
          length++
        ) {
          const last = tokens[start + length - 1];
          const lastWord = last[0].toLowerCase();
          if (separators.has(lastWord) && !interiorConnectors.has(lastWord))
            break;
          if (length > 1) {
            const previous = tokens[start + length - 2];
            if (
              !/^\s+$/.test(
                item.quote.slice(
                  previous.index + previous[0].length,
                  last.index,
                ),
              )
            )
              break;
          }
          // Keep scanning past a connector, but emit only a content-word endpoint.
          if (separators.has(lastWord)) continue;
          const text = item.quote.slice(
            tokens[start].index,
            last.index + last[0].length,
          );
          if (text.length < 3 || text.length > 60 || /^\d+$/.test(text))
            continue;
          const content = words(text);
          const overlap = content.filter((word) => goal.has(word)).length;
          const score =
            overlap * 3 +
            (length >= 2 && length <= 3 ? 2 : 0) +
            Math.min(text.length, 25) / 50;
          const key = text.toLowerCase();
          if (!phrases.has(key))
            phrases.set(key, { text, evidenceId: item.evidenceId, score });
        }
      }
      const concepts = [...phrases.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 18);
      if (task.level !== "explain" && task.level !== "apply") return concepts;
      const relationships = relationalPhrases(
        item.quote,
        item.evidenceId,
        goal,
      );
      // Whole sentences preserve the actor and mechanism lost by predicate suffixes.
      const complete = [...sentences.segment(item.quote)]
        .map(({ segment }) => segment.trim().replace(/[.!?]$/, ""))
        .filter(
          (text) =>
            text.length <= 100 && !text.includes(";") && /\s/.test(text),
        )
        .map((text) => ({ text, evidenceId: item.evidenceId }));
      // When the source explicitly gives a mechanism, keep the whole causal claim.
      if (task.level === "explain") {
        const mechanisms = complete.filter(({ text }) =>
          /\b(?:because|prevents?|slows?|accelerates?|blocks?|interrupts?|reduces?|increases?|allows?|causes?)\b/i.test(
            text,
          ),
        );
        if (mechanisms.length) return mechanisms;
      }
      // A location prediction needs a named destination as its key.
      if (asksForDestination(task)) {
        const destinations = [
          ...item.quote.matchAll(
            /\b(?:the|a|an) ([\w-]+ (?:bin|outlet|channel|tray))\b/gi,
          ),
        ];
        if (destinations.length)
          return [...new Set(destinations.map((match) => match[1]))].map(
            (text) => ({ text, evidenceId: item.evidenceId }),
          );
      }
      // A diagnostic key must identify the stage and its behavior together.
      if (
        task.level === "apply" &&
        /\bwhich (?:stage|component|device)\b/i.test(task.goal)
      )
        return complete;
      const combined = [],
        included = new Set();
      // Keep short concepts alongside relationships within each source. The
      // outer round-robin still shares the global byte budget across sources.
      for (let index = 0; index < 18 && combined.length < 18; index++) {
        for (const candidate of [
          complete[index],
          relationships[index],
          concepts[index],
        ]) {
          if (!candidate || included.has(candidate.text.toLowerCase()))
            continue;
          included.add(candidate.text.toLowerCase());
          combined.push(candidate);
          if (combined.length === 18) break;
        }
      }
      return combined;
    });
  const menu = [];
  // Round-robin prevents one long excerpt from consuming the entire menu.
  for (let index = 0; index < 18 && menu.length < 48; index++) {
    for (const group of groups) {
      const phrase = group[index];
      if (!phrase) continue;
      const candidate = {
        id: `A${menu.length + 1}`,
        text: phrase.text,
        evidenceId: phrase.evidenceId,
      };
      if (Buffer.byteLength(JSON.stringify([...menu, candidate])) > maxBytes)
        continue;
      menu.push(candidate);
      if (menu.length >= 48) break;
    }
  }
  return menu;
}
