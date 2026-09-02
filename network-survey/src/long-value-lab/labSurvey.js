export const SYNTHETIC_VALUES = [
  {
    value: 'charter-calm-iteration-v1',
    text: 'Calm iteration',
    definition: 'Make progress through small, reversible steps rather than dramatic leaps. A calm iteration leaves enough attention to notice what changed and to adjust without blame.',
  },
  {
    value: 'charter-brave-specificity-v1',
    text: 'Brave specificity',
    definition: 'Name the concrete tension, constraint, or uncertainty instead of hiding it behind agreeable generalities.',
  },
  {
    value: 'charter-generous-friction-v1',
    text: 'Generous friction',
    definition: 'Challenge an idea in a way that helps its author improve it.\n\nThis includes explaining the concern, showing relevant evidence, and remaining open to being wrong. It excludes performative agreement and personal criticism.',
  },
  {
    value: 'charter-legible-decisions-v1',
    text: 'Legible decisions',
    definition: 'Record what was decided, by whom, and why, using language that a person outside the room can understand six months later.',
  },
  {
    value: 'charter-useful-quiet-v1',
    text: 'Useful quiet',
    definition: 'Protect intervals with no meetings, alerts, or expectation of immediate response so that complex thinking has room to develop.',
  },
  {
    value: 'charter-stewardship-v1',
    text: 'Borrowed-tool stewardship',
    definition: 'Treat shared tools, spaces, data, and attention as things temporarily entrusted to us. Improve them when practical; at minimum, return them understandable and usable.',
  },
  {
    value: 'charter-curious-handoffs-v1',
    text: 'Curious handoffs',
    definition: 'A handoff is a conversation, not a file transfer. The sender explains assumptions and unfinished edges; the receiver asks questions and confirms what success means.\n\nNeither person treats uncertainty as evidence of incompetence.',
  },
  {
    value: 'charter-humane-pace-v1',
    text: 'Humane pace',
    definition: 'Plan work at a rate that people can sustain while maintaining judgment, health, and relationships. Genuine emergencies may demand a sprint, but repeated emergencies are treated as a system problem rather than a virtue.',
  },
  {
    value: 'charter-evidence-with-empathy-v1',
    text: 'Evidence with empathy',
    definition: 'Use observations and measures to learn, while remembering that a metric is an incomplete description of people and their circumstances.',
  },
  {
    value: 'charter-permeable-plans-v1',
    text: 'Permeable plans',
    definition: 'Make plans clear enough to coordinate around and porous enough to admit new evidence. A changed plan should explain what was learned, not pretend the original uncertainty never existed.',
  },
  {
    value: 'charter-unflashy-reliability-v1',
    text: 'Unflashy reliability',
    definition: 'Prefer a promise kept repeatedly over a heroic rescue that makes the same failure likely next week.',
  },
  {
    value: 'charter-boundary-craft-v1',
    text: 'Boundary craft',
    definition: 'Set, communicate, and revisit boundaries around ownership, availability, privacy, and decision rights. Good boundaries reduce guessing; they are not walls against collaboration.\n\nWhen boundaries conflict, surface the conflict early and negotiate it explicitly.',
  },
  {
    value: 'charter-many-sized-voices-v1',
    text: 'Many-sized voices',
    definition: 'Design participation so that quick speakers, reflective writers, newcomers, experts, remote participants, and people using assistive technology all have credible ways to shape the outcome.',
  },
  {
    value: 'charter-literal-safety-v1',
    text: 'Literal safety <demo>',
    definition: '<img src=x onerror="alert(\'synthetic\')"> is deliberately displayed as text.\n\nAReallyLongUnbrokenSyntheticTokenForTestingReflowAtHighZoom_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz_should_wrap_instead_of_expanding_the_page.',
  },
  {
    value: 'charter-repair-over-polish-v1',
    text: 'Repair over polish',
    definition: 'When trust or a process breaks, prioritize acknowledging impact, restoring function, and changing the conditions that produced the break. A polished explanation without repair is not completion.',
  },
  {
    value: 'charter-questions-before-speed-v1',
    text: 'Questions before speed',
    definition: 'Spend a small amount of time confirming the problem and the people affected before optimizing how quickly a solution can be delivered.',
  },
];

export const LONG_VALUE_SURVEY_JSON = {
  showQuestionNumbers: false,
  elements: [
    {
      type: 'draggableranking',
      name: 'expedition_priorities',
      title: 'Build an expedition charter: rank up to five principles',
      description: 'Synthetic exercise. Drag values into the ranked area, or use Rank and Unrank. Information controls never change the ranking.',
      maxSelectedChoices: 5,
      choices: SYNTHETIC_VALUES,
    },
    {
      type: 'radiogroup',
      name: 'expedition_anchor',
      title: 'Choose one principle as the charter anchor',
      description: 'This second question tests whether the same definition pattern generalizes to a standard SurveyJS choice question.',
      choices: SYNTHETIC_VALUES,
    },
  ],
};
