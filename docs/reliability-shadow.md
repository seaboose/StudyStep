# Checking a timing rule on saved drafts

A before/after question has a verifiable answer when the passage gives two state-to-destination mappings and says exactly when the route locks. The reviewer can compute the state at that event and check the options. It leaves other questions to the ordinary review path.

The read-only shadow command takes a saved comparison bundle and reports aggregate counts. It makes zero model calls, caps the input at 2 MB and the replay at 100 drafts, and writes no study data. On one pre-repair capture it examined 11 drafts, confirmed four, flagged two, and found five outside the rule. On the repaired capture it confirmed all 12. The second corpus reuses this narrow rule family; its result does not establish that arbitrary temporal reasoning is solved.

Run `node scripts/shadow-timing.mjs PATH_TO_BUNDLE` after building. Draft content stays local.
