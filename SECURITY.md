# Security

StudyStep is a single-user desktop application, not a network service. Do not expose its local server or Ollama port to other machines.

The renderer runs with Node integration disabled, context isolation enabled, and Electron sandboxing enabled. External navigation is restricted. The local API validates host, origin, content type, input size, and data schemas. These controls reduce accidental exposure and browser-based cross-origin attacks; they do not protect against malware running as the same operating-system user.

Documents and generated content are untrusted input. Source quotations and answer structure are checked before saving generated material. Semantic review is fallible and is not a security boundary against prompt injection. No model-generated commands are executed.

Study files and exports may contain private or copyrighted material. Do not attach them to public issues. Share only a minimal synthetic reproduction. Report a security issue privately through GitHub's security advisory mechanism when available; otherwise open an issue asking for a private contact route without publishing exploit details or private data.

Unsigned desktop builds and optional model runtimes have separate update lifecycles. Keep dependencies and your local runtime current. No automatic updater or telemetry service is included.

## Data and generation limits

One active workspace supports up to 10 source files, 20 MB per file, 200 PDF pages, and 80,000 extracted text characters in total. Generation accepts selected excerpts up to 12,000 characters. Scanned PDFs need text recognition in another tool. There is no account sync or multi-user service.

Generation sends selected text to Ollama at `127.0.0.1:11434`; cloud-tagged and remote models are rejected. Wikipedia search sends the query to Wikipedia, not source documents. Setup requires dependency and optional model downloads; manual study needs no hosted account or paid API.

Study-set backups, review exports, and focus exports are separate. Close StudyStep and copy its entire data folder for a complete backup. StudyStep does not encrypt local files; use operating-system access controls and disk encryption. Review ratings and the included example set do not establish learning outcomes or exam coverage.

## Dependency review

The October 2026 release upgrades PDF.js to 6.4.299, beyond the affected versions in [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j). Desktop tests exercise text extraction from PDF and DOCX fixtures.

The production dependency audit still reports [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) in `mammoth → argparse → sprintf-js`, with no published patch. StudyStep imports Mammoth's browser bundle, which contains neither argparse nor sprintf-js; the affected command-line parser is not shipped in the portable app. Source installations include that dependency, so this remains tracked rather than being described as a clean audit. Do not invoke Mammoth's CLI on untrusted format strings.
