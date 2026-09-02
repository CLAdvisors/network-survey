# Long-value question UX lab

## Scope and assumptions

This lab is a respondent-UI experiment only. It does not call the API, submit answers, change dashboard authoring, or register its experimental schema in the normal respondent bundle. It is loaded only at `/labs/long-values` and uses synthetic “expedition charter” values that are unrelated to any client or real survey.

The experiment assumes respondents need a short, scannable label while definitions may range from one sentence to several paragraphs. A definition is supporting information, not the answer value. Opening supporting information must therefore never select, rank, drag, or submit a choice.

## Experimental SurveyJS data shape

The lab registers one optional custom property on SurveyJS `itemvalue` objects, and only when the lab chunk loads:

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

`definition` is deliberately additive and namespaced by its location on a choice rather than encoded into `value` or `text`. SurveyJS preserves registered item-value properties during model serialization. A future production proposal should still review naming, localization, authoring, API allow-listing, exports, and versioning before adopting this shape. This lab changes none of those systems.

## Variants

1. **Focus popover** — one transient explanation at a time; opens through hover, keyboard focus, or activation. A lab toggle compares explicit information-button hover with whole-value-row hover. Compact, but repeated inspection may increase effort.
2. **Expandable cards** — explicit, independently expandable definitions remain in context. Strong for reading and comparison, with high vertical cost.
3. **Detail panel** — a synchronized, persistent reading region follows the last previewed value. Dense lists remain scannable; the relationship may be less obvious on narrow screens.
4. **Glossary preview** — a searchable modal glossary supports up-front study and targeted previews while keeping the task compact. It introduces mode switching and memory load.

Each treatment is applied to the existing custom draggable Q-sort/ranking workflow and to a SurveyJS radiogroup rendered through the same custom-question host pattern. Answers remain owned by a real `survey-core` `Model`.

## Evaluation questions

- Can people discover definitions without being told where to look?
- Can they compare several nuanced values without losing their place or answer state?
- At 320 CSS pixels and 200% zoom, is reading, ranking, and closing content comfortable?
- Are focus order, announcements, state names, and Escape/outside-close behavior understandable?
- Does touch exploration conflict with drag, and do action buttons remain an adequate non-drag alternative?
- How much authoring guidance and renderer complexity would each treatment require?
- Should definitions be localized fields, structured blocks, or intentionally limited plain text in a production schema?
