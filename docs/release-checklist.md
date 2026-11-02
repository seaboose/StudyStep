# Release checklist

1. Work on a short `dev/<change>` branch. Keep changes focused and explain what was tested.
2. Review the staged files for local paths, credentials, editing-session material,
   private study data, model weights, and generated dependencies. Keep required licences.
3. Update `package.json` for a new version. The desktop packager reads that version.
4. Run type checking, build, tests, and the desktop smoke check. Require CI to pass.
   Preserve failed results privately and state any skipped checks.
5. Package from the reviewed source. Verify the extracted app, its version, and its
   checksums. Test a manual study journey; model-assisted behavior needs a separate model test.
6. Publish one current release using the actual publication date, concise notes,
   and checksums. Preserve superseded releases and history in a verified private archive.
7. Check the download and documentation links. Leave published assets unchanged;
   continue development on a new branch.

## Release notes

```text
StudyStep <version> — <YYYY-MM-DD>

Download the Windows ZIP, extract it, and open StudyStep.exe.
Changes: <brief summary>.
Verified: <exact tests and build identity>.
Limits: <remaining gaps; distinguish fixtures from real-model testing>.
```

Use ordinary branch and commit names. Review hosting metadata as well as files.
Do not include workstation or editing-session details in public records.
