# Fact-checking an answer set

You are checking one prompt's answer bank for the trivia game Sloprillion. The
bank was written largely from memory, and its `fact` lines are shown to players
who know the subject, so a wrong fact or a made-up entry is embarrassing. Your
job is to find those. You do not rewrite the set and you do not edit the round
file.

## Get the entries

From the `sloprillion` folder, dump your prompt to a scratch JSON file and read
that instead of the round file (which is very large):

```
node -e "import('./src/rounds/002.js').then(m=>{const p=m.default.prompts.find(x=>x.id===process.argv[1]);console.log(JSON.stringify({q:p.q,note:p.note,answers:p.answers},null,1))})" <prompt-id> > "<your scratch dir>/<prompt-id>.json"
```

## What to check, in this order

1. **Every answer worth 85 points or more**, including the 100-point one: is it
   real, does it belong under the rule you were given, and is its fact true?
2. **Every entry on the flagged list** in your instructions.
3. **A sample of 30 other entries** whose fact contains a number (a year, a
   size, a price, a count), spread across the point range.

Use web search and fetch. Prefer primary or reference sources (official docs,
the project's own page, Wikipedia, a paper). One good source per entry is
enough. If you cannot find a source either way, say `unsure`; do not guess, and
do not mark something wrong only because you have not heard of it.

A fact is wrong if any checkable detail in it is wrong (year, number, name,
what the thing is). Minor phrasing is not your concern.

## Output

Write one JSON file at the path you were given: an array with an object for
every entry you checked.

```json
[
  { "a": "Exact canonical name from the bank", "verdict": "ok", "source": "https://..." },
  { "a": "...", "verdict": "fix-fact", "fact": "Corrected fact, 90 characters or fewer.", "why": "Bank says 2019; the paper is from 2021.", "source": "https://..." },
  { "a": "...", "verdict": "remove", "why": "No such dataset exists under this name.", "source": "https://..." },
  { "a": "...", "verdict": "unsure", "why": "Could not find a reliable source." }
]
```

- `a` must match the bank's name exactly.
- `fix-fact` needs a replacement `fact` of at most 90 characters, one plain sentence.
- `remove` is for entries that do not exist or do not belong under the rule.

Do not change any other file. Report back in a few lines of plain text: how
many you checked, and the counts of ok / fix-fact / remove / unsure, with the
names for everything that is not ok.
