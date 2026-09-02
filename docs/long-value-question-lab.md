# Long-value question UX lab

## Scope and assumptions

This lab began as a respondent-UI experiment and remains isolated at `/labs/long-values`, using synthetic “expedition charter” values unrelated to any client or real survey. The production implementation now adopts only the **Info-button popover** treatment for `draggableranking` questions. The other four treatments remain lab-only and are not author-configurable.

The experiment assumes respondents need a short, scannable label while definitions may range from one sentence to several paragraphs. A definition is supporting information, not the answer value. Opening supporting information must therefore never select, rank, drag, or submit a choice.

## Experimental SurveyJS data shape

The lab and production browser runtimes register one optional custom property on SurveyJS `itemvalue` objects:

```json
{
  "value": "machine-stable-calm-iteration",
  "text": "Calm iteration",
  "definition": "A literal-text explanation that may contain line breaks."
}
```

- `value` is the stable machine value saved in survey answers.
- `text` is the short respondent-facing label.
- `definition` is an optional plain-text SurveyJS `itemvalue` property. Newlines represent paragraph breaks. It is rendered as React text, never as HTML.

`definition` is deliberately additive and namespaced by its location on a choice rather than encoded into `value` or `text`. SurveyJS preserves registered item-value properties during model serialization. Production supports this field only on `draggableranking.choices`, uses English literal strings, exposes a multiline Survey Creator editor, validates bounded content in the API, and stores only `value` in answers. No presentation-variant field is stored in survey JSON.

For a ranking with any nonblank definition, every choice must persist an explicit, unique, canonical string `value` and a nonempty string `text`. Limits are 100 choices per ranking, 1,000 definition-enabled choices per survey, 128 characters/512 UTF-8 bytes for values, 240 characters/1,024 bytes for labels, 10,000 characters/40,960 bytes per definition, and 250,000 characters/512 KiB across definitions. Fast Entry is disabled because it cannot preserve multiline per-choice metadata.

## Variants

The first variant is the fixed production treatment. Variants 2–5 remain comparison artifacts in the lab.

1. **Info-button popover (selected for production)** — one transient explanation at a time; hover targets only the explicit information control, while focus and activation provide equivalent access. Compact and intentional, but the small discovery point may be missed.
2. **Whole-row popover** — the same accessible popover with the entire value row as its hover target. Easier to discover, but more prone to incidental activation while scanning.
3. **Expandable cards** — explicit, independently expandable definitions remain in context. Strong for reading and comparison, with high vertical cost.
4. **Detail panel** — a synchronized, persistent reading region follows the last previewed value. Dense lists remain scannable; the relationship may be less obvious on narrow screens.
5. **Glossary preview** — a searchable modal glossary supports up-front study and targeted previews while keeping the task compact. It introduces mode switching and memory load.

Each treatment is applied to the existing custom draggable Q-sort/ranking workflow and to a SurveyJS radiogroup rendered through the same custom-question host pattern. Answers remain owned by a real `survey-core` `Model`.

## Evaluation questions

- Can people discover definitions without being told where to look?
- Can they compare several nuanced values without losing their place or answer state?
- At 320 CSS pixels and 200% zoom, is reading, ranking, and closing content comfortable?
- Are focus order, announcements, state names, and Escape/outside-close behavior understandable?
- Does touch exploration conflict with drag, and do action buttons remain an adequate non-drag alternative?
- How much authoring guidance and renderer complexity would each treatment require?
- Should definitions be localized fields, structured blocks, or intentionally limited plain text in a production schema?
