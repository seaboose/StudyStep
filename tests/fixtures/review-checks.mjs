// Deterministic protocol fixture, not an AI accuracy evaluation.
export const approvedChecks = (items) =>
  items.map((i) => ({
    id: i.id,
    verdict: "supported",
    answerIndex: i.type === "multiple-choice question" ? 0 : -1,
    reason: "Supported by the supplied source.",
    ...(i.type === "multiple-choice question"
      ? {
          optionChecks: Object.fromEntries(
            i.content.options.map((_, n) => [
              String(n),
              {
                verdict: n === 0 ? "answers" : "does_not_answer",
                reason:
                  n === 0
                    ? "Directly answers the question."
                    : "Describes a different fact.",
              },
            ]),
          ),
          supportingQuote: i.evidence[0],
        }
      : {}),
  }));
