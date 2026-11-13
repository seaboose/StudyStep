# Reproducing a bad key without changing a learner's app

The maintenance rehearsal copies the timing module and swaps the before/after destinations in the copy. A Node loader redirects just that module during the regression run. The test process still exercises the ordinary key and review functions.

The seeded copy failed two of four targeted tests. After the inverse patch, all four passed. Hashes confirmed that the repaired copy matched the original module and the checkout remained unchanged. The rehearsal records both test logs and the repair in a fresh artifact directory. No production profile, model, or merge is involved.

Linux and Windows execute this developer job independently from the consumer release checks. The rehearsal demonstrates detection and repair of a known defect. It does not estimate the success rate of repairs to unseen failures.
