[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/longtime04/makefun-csv-1121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/longtime04/makefun-csv-1121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Faster CSV reader

A fast drop-in replacement for csv-reader 1.0.0: it answers exactly what
csv-reader returns for every input, but reads the text in one pass with
`indexOf` jumps and `slice` cuts instead of one character at a time.

## What it does

`solve.js` exports `run(input)`, which reads `{text, header}` and returns
`{columns, rows, errors}` — the header (or `null`), every other record as
an array of strings at the first record's width, and an error record for
every broken thing it met. It follows csv-reader 1.0.0's broken-row
policy exactly:

- A U+FEFF at the very start is dropped; a record ends at LF or CRLF,
  and an empty line is no record.
- Outside quotes, a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not
  doubled; `""` inside it is one quote, and each CRLF or lone CR inside
  it reads as LF. What follows the closing quote up to the next comma or
  line break is appended as it stands (`quote_junk`).
- A quote that never closes is a literal character, and the text after
  it is read again as unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay
  strings, never trimmed or converted.
- Rows are padded with `""` (`short_row`) or cut (`long_row`) to the
  first record's width. Each error is `{code, line, row}` in the order
  met, `line` the 1-based line its record starts on.

## How to run

Node 22 or later, nothing to install:

```sh
node main.ts
```

It reads `/input/cases.json` and writes `/output/answers.json`.
Outside a container, point it at local directories instead:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

`main.ts` turns V8's incremental marking off before importing
`solve.js`, the same way the house baseline runs.

## How to verify

Run it on the kit's practice set and compare with the reference answers:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
node -e "const a=require('./out/answers.json');const e=require('./practice/reference/expected.json');console.log(a.length===e.cases.length && a.every((x,i)=>JSON.stringify(x)===JSON.stringify(e.cases[i].output))?'all cases identical':'MISMATCH')"
```

## How it is fast

- The hot paths never build a field one character at a time: unquoted
  fields jump with `indexOf` to the next `,`, LF or CR and are cut out
  with `slice`; plain quoted fields jump to their closing quote the
  same way.
- Doubled quotes are handled by joining the pieces between the pairs,
  not by appending one character at a time.
- The slow, character-by-character paths (a quoted field holding a line
  break, a lone CR, junk after a closing quote, a quote that never
  closes) only run where the text actually needs them.
- Position and line stay plain locals in one function scope; nothing
  is kept from one case to the next.

## License

MIT. See [LICENSE](LICENSE).
