# Mobile survey review harness

A local-only visual harness is available for reviewing the respondent survey at phone/tablet sizes. It uses fixture data and never contacts the API or stores responses.

## Run

From the repository root:

```sh
npm --prefix network-survey run dev
```

Open one of these URLs:

- `http://localhost:3002/?mobileHarness=1&viewport=320`
- `http://localhost:3002/?mobileHarness=1&viewport=375`
- `http://localhost:3002/?mobileHarness=1&viewport=768`

The page also includes buttons to switch between the three frames.

## What to capture

For each frame, capture:

1. Initial view, including the header and instructions.
2. A tagbox opened after searching, plus selected long names and removal controls.
3. The ranking question, including available and ranked options.
4. Required-field validation after attempting completion with empty required questions.
5. Completion view.

For the most faithful header behavior, also test the URL in Chrome/Firefox responsive device mode and on a physical phone: the current production header uses user-agent detection in addition to layout width.

## Scope

The harness is only enabled in Vite development mode when `mobileHarness=1` is in the URL. Production respondent survey behavior is unchanged.
