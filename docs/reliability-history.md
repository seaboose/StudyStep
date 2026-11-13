# How practice corrections survive a study-set edit

A learner's answer and their own assessment of a topic are separate records. StudyStep keeps an answer when the corresponding question survives an edit unchanged. It retains a topic correction when the topic itself is unchanged. This distinction lets a learner mark a topic confident after using a hint without rewriting the attempt as independently correct.

The developer suite replays 100 histories. It varies two answers independently across five outcomes, two learner assessments, and an unchanged or edited topic. Each history passes through import, edit, serialization and workspace validation. All 100 preserved the expected attempts and assessments. The packaged test separately exercises an actual process restart and a subsequent practice round. These measurements concern record integrity, not a learning-effect estimate.
