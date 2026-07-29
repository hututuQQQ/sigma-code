# Sigma Code brand icons

`sigma-code-mark.png` is the canonical artwork for every downstream icon. Its
provenance and update procedure are recorded in `SIGMA_BRAND_SOURCE.md`.

Run `vp run icons:export` from the repository root to regenerate the tracked
desktop, mobile, web, Windows, macOS, and Linux assets. Run
`vp run icons:check` to verify them without changing files.

The `dev/app-icon.icon`, `nightly/app-icon.icon`, and `prod/app-icon.icon`
projects now contain a single `Assets/sigma-code-mark.png` layer. The generator
also refreshes that layer. Legacy output filenames such as
`black-ios-1024.png` and `t3-black-web-favicon.ico` are retained only to keep
the downstream patch small; their contents are Sigma Code artwork.

Do not edit generated PNG, ICO, or ICNS files directly.
