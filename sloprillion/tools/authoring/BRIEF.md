# Writing an answer set for Sloprillion

Sloprillion is a daily trivia game about AI, startups, computer science and big
tech. A player sees a prompt such as "A sorting algorithm", has 25 seconds to
type ONE free-text answer, and scores 10 to 100 points: the fewer players who
would think of that answer, the more it scores. The audience is tech-literate:
CS students, software engineers, ML researchers, founders.

You are writing the answer bank for one prompt. Known answers are matched
against the bank instantly. Anything the bank does not know goes to a small LLM
judge, so the bank does not have to be exhaustive, but it must cover everything
most players will actually type, and every entry in it must be right.

## What a good set looks like

- **Wide.** At least 80 answers, and a few hundred when the subject allows. The
  owner's standing instruction is that prompts need spread: many valid answers
  at very different levels of familiarity, with a real long tail.
- **Correct.** This ships to people who know the subject. A wrong entry is worse
  than a missing one. Verify closed or time-sensitive facts (valuations, deal
  prices, membership of a list, dates) with web search and fetch; never rely on
  memory for them, and never invent an entry. If a source cannot be reached,
  leave the entry out and say so in your report.
- **Bounded by a rule you can state.** Write down, in one or two sentences, what
  counts and what does not. Borderline cases are decided by that rule, and the
  rule goes in your report so the judge can be told the same thing.

## File to write

One ES module at the path you were given, in exactly this shape:

```js
export default {
  id: "sorting-algo",
  category: "CS",
  q: "A sorting algorithm",
  note: "Serious or joke",
  // optional flags: people: true | exact: true | ignore: ["sort", "sorting"]
  answers: [
    { a: "Quicksort", pts: 10, alt: ["dual pivot quicksort"], fact: "Invented by Tony Hoare in 1959." },
    { a: "Spaghetti sort", pts: 100, fact: "Cut spaghetti to length, tap the bundle on a table, pull the tallest." },
  ],
};
```

- `a`: canonical display name, properly cased and spelled.
- `pts`: integer 10 to 100. See scoring.
- `alt`: optional lowercase aliases a player would plausibly type: abbreviations,
  nicknames, former names, alternate spellings, the long form of an acronym.
- `fact`: optional, one plain sentence of at most 90 characters, true and
  checkable, no filler. Required for every answer with pts of 85 or more; add
  one elsewhere when a short fact is interesting.
- Order `answers` by `pts` ascending.

### What the matcher already does (so do not add aliases for these)

It lowercases, strips accents and punctuation, ignores spaces, and tolerates one
typo in a 5 to 8 letter answer and two in a longer one. So never add aliases
that differ only by case, punctuation, hyphens, spacing or accents, and never
add misspellings.

- `people: true`: the last word of each canonical name is also accepted on its
  own when it is unique in the set. Do not add bare surnames. Do add nicknames
  ("woz"), a first name used alone where unambiguous ("jensen"), and other name
  orders or romanisations. For names written family-name-first, choose the
  canonical order players would type and add the other order as an alias.
- `exact: true`: turns typo tolerance off. Use it when answers are short code
  identifiers or commands, where a one-letter slip is a different answer.
- `ignore: [...]`: lowercase words dropped from both the typed text and the
  answer names, so "quick sort", "quicksort" and "quick" all match "Quicksort".
  Do not add aliases that differ only by an ignored word.
- An alias must never be able to point at two answers.

### Known wrong answers (optional)

A prompt may also carry `wrong: [{ a, alt?, why }]` after `answers`: things
players are likely to type that do NOT count, each with a one-sentence reason
of at most 80 characters that the player is shown at once ("Sold to Amazon for
$970 million, just under the bar."). Use it for famous near-misses under a
threshold or rule, about 5 to 15 entries, each reason verified like a fact. A
wrong entry must not share a name or alias with a real answer.

## Scoring

`pts` estimates how rarely this audience gives the answer under a 25-second
clock. It is about familiarity, not importance.

| pts | meaning | how many |
|---|---|---|
| 10 to 24 | the first thing nearly everyone says | only 3 to 7 answers |
| 25 to 44 | well known, common | |
| 45 to 64 | known to people in the field | |
| 65 to 84 | deep cuts | |
| 85 to 99 | very few players would say it | no more than about a quarter of the set |
| 100 | the jackpot | exactly ONE |

Spread scores over the whole range and vary them within a band (not all
multiples of five). The 85 to 99 band should hold roughly 12 to 25 percent of
the set: do not park obscure answers at 84 to avoid writing their facts, since
that flattens the long tail the game is about. The jackpot should be verifiable and delightfully obscure,
yet something a real expert could plausibly recall; pick it for fun as well as
rarity, and make sure a player cannot hit it by accident through a shared
surname or a generic word. Mind the game theory: answers that are famous for
being obscure (Ronald Wayne, bogosort, ELIZA) are popular with this audience
and belong in the middle bands.

## Verify the high scorers

Every answer worth 85 points or more, including the jackpot, must be confirmed
on a page you actually fetched or a search result you actually read in this
session: that it exists under that name, that it belongs under your rule, and
that its fact is right. Obscure entries are where invented or misremembered
ones hide. If you cannot confirm one, drop it or score it lower without a
fact. Batch the work: a list page or one search often confirms many entries.

Scratch files (dumps, helper scripts) go in the operating system's temp
folder under a name with a random suffix, never in the repo; other writers
are working at the same time.

## Before you finish

Run the checker from the `sloprillion` folder and fix everything it reports:

```
node tools/check-round.mjs <path to your file>
```

It checks the shape, score range and order, the single jackpot, fact lengths,
facts on high scorers, and that no name or alias collides with another answer.

Do not create or change any file other than the one you were given.

## Report back (short, plain text, no file contents)

1. The answer count and the count per score band.
2. The rule for what counts, in one or two sentences.
3. The jackpot answer and why.
4. Sources used for verification.
5. Judgment calls, anything left out on purpose, and anything you could not verify.
6. How many of the 85+ answers you confirmed on the web, and a list headed
   "Please double-check" of entries or facts you are still unsure of (or "none").
