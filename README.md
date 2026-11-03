# StudyStep

A student project for turning notes into source-linked study practice. Built with
TypeScript, React, Node.js, and Electron for Windows.

**[Download for Windows](https://github.com/seaboose/StudyStep/releases/download/v0.3.2/StudyStep-0.3.2-Windows-x64.zip)** · **[Code guide](docs/code-guide.md)**

Extract the complete ZIP and open **StudyStep.exe**. Node.js is not required.
The app is unsigned.

Import PDF, DOCX, TXT, or Markdown notes, then practice with cards, questions,
scheduled review, and a focus timer. Manual study works without a model.

Explore a topic with Wikipedia search, or bring your own material. Keep one
active study workspace, practice its source-linked cards, and return to due
reviews. Focus sessions earn credits for the focus collection; the study journal
records time spent learning.

Optional local AI uses [Ollama](https://ollama.com/download): draft → source checks
→ model review → at most one revision → human review before saving.
Models are not bundled, and generated answers can still be wrong.

![Practice with the included example set](docs/study-cards.png)

[Build and test](docs/development.md) · [Security and data limits](SECURITY.md) ·
[Release checklist](docs/release-checklist.md) · [MIT license](LICENSE) · [Dependency notices](THIRD_PARTY_NOTICES.txt)

Version 0.3.2 documents the regular desktop product. See the
[release provenance](docs/release-0.3.2.md) for the source recovery and validation.
