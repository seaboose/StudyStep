# StudyStep 0.3.2

The regular desktop product is a personal learning workspace: explore a topic,
import material, build a study set, and practice with source-linked cards and
questions. The focus collection includes Spark, Orbit, and Constellation designs;
the study journal records effort. Existing focus data remains compatible.

## Source provenance

The source was recovered from the public 0.3.1 baseline, shared interface source,
and the preserved regular 0.3.2 application. The later development-only learning
agent implementation is outside this release.

The recovered build reproduces the preserved product's five generated JavaScript
and CSS assets and seven compiled server modules byte for byte. Explicit Tailwind
utility inclusion keeps the released stylesheet reproducible in clean checkouts.
The Electron entry point and server scripts match the preserved product.

| Product asset | SHA-256 |
| --- | --- |
| `index-Bq9uu-Hj.js` | `86e00bb99f0b15b892214fe0bbcfee198ee084c2267986547d5b471f92ada19f` |
| `index-BxRKo9NB.css` | `5e1050f14db05eb7214eec6588e5b56a4d21217ab1b79530712798a4a4ef4f21` |

The Windows download preserves the complete regular 0.3.2 application. It does
not contain a study profile or model weights. The ZIP's SHA-256 is supplied beside
the download. Keep all extracted files together.

## Validation

- TypeScript checking and production build passed.
- All 58 logic tests passed: 11 core and 47 local workflow regression tests.
- Desktop checks passed for imports, answer reveal and rating, focus pause,
  renderer isolation, and persistence after restart.
- Theme checks passed for legacy focus data, design unlocks, timer navigation,
  and layouts at 1440, 820, and 700 pixels.

Automated generation tests use controlled fixtures. This release check did not
run a real model or assess the factual accuracy of generated study content.
