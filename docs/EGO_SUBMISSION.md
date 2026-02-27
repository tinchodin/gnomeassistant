# extensions.gnome.org Submission Guide

This document is a release checklist for submitting `gnomeassistant@tinchodin.uy` to extensions.gnome.org (e.g.o).

## 1. Review Compliance (GJS Guidelines)

Reference:
`https://gjs.guide/extensions/review-guidelines/review-guidelines.html`

Current project status:

- Metadata is present and structured for review (`uuid`, `name`, `description`, `shell-version`, `url`, `settings-schema`).
- No external executable commands are used.
- No `eval()`/dynamic code loading is used.
- Resources are cleaned on destroy/disable (signals and managed GLib sources).
- Preferences are implemented with GTK/Libadwaita in `prefs.js`.
- Licensing information is included in `LICENSE`.

## 2. Build Upload Bundle

From the extension root:

```bash
./scripts/pack-for-ego.sh
```

Output:

- `dist/gnomeassistant@tinchodin.uy.shell-extension.zip`

This script compiles schemas and validates required files in the generated ZIP.

## 3. Local Validation Before Upload

Run these checks:

```bash
gnome-extensions disable gnomeassistant@tinchodin.uy
gnome-extensions enable gnomeassistant@tinchodin.uy
journalctl /usr/bin/gnome-shell -f
```

Verify:

- Extension enables without errors.
- Quick Settings controls render correctly.
- Preferences open correctly.
- Home Assistant requests work as expected.
- Separator toggle and home-launch button behave correctly.

## 4. Upload to e.g.o

CLI upload option:

```bash
gnome-extensions upload --accept-tos dist/gnomeassistant@tinchodin.uy.shell-extension.zip
```

You can also provide credentials non-interactively:

```bash
gnome-extensions upload \
  --user "<EGO_USERNAME>" \
  --password-file "<PATH_TO_PASSWORD_FILE_OR_->" \
  --accept-tos \
  dist/gnomeassistant@tinchodin.uy.shell-extension.zip
```

## 5. Store Listing Readiness

Prepare the listing content in advance:

- Clear short description.
- Full description with key features.
- At least one clean screenshot showing the extension in use.
- Support link/repository URL (already set in metadata).

## 6. Post-Upload

- Monitor review feedback from e.g.o.
- Address requested changes in a follow-up patch.
- Rebuild and re-upload a new ZIP version if required.
