# Survey definition limitations

## Nested SurveyJS content (current)

Nested SurveyJS questions, panels, dynamic panels, and pages are unsupported. Survey definitions must place every question directly in the top-level `elements` array. The API rejects nested definitions before persistence with an actionable error; the dashboard displays that save error. This is intentional until nested question storage, editing, validation, and results handling are designed end-to-end.

## Question CSV `Required`

For legacy CSV files without a `Required` column, every imported question remains required. When the column is present, only `true` (case-insensitive) means required; blank and other values mean optional. CSV export always writes explicit `true` or `false` values so requiredness round-trips without ambiguity.
