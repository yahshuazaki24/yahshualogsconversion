<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Conversion/validation rules live as pure functions in src/lib/converter.ts with tests beside them; UI only calls them (keeps payroll rules testable).
- Full file decoding and conversion happen in the browser; only a bounded name-masked sample is sent to server-side AI recipe detection, protecting sensitive logs.
- Resolve dates during punch extraction before grouping; source-cell identity isolates unresolved dates so failed parsing cannot pool unrelated days.
- Browser file decoding lives in src/lib/file-reader.ts with format tests; keep upload UI separate from text/workbook decoding for consistent format coverage.

- Parsing recipes are schema-validated in src/lib/recipe.ts and sample-tested before local application; server-only gateway helpers never generate payroll output.
