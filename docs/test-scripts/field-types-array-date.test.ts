// array + date field types. Existing types must convert exactly as before.
//   cd backend && npx tsx ../docs/test-scripts/field-types-array-date.test.ts
import { execFileSync } from 'node:child_process'
import { buildItem } from '../../backend/src/modules/apis/design/build-response.ts'
import { convertValue, listItems, parseDate, PATTERNS } from '../../backend/src/modules/apis/design/convert.ts'
import type { StoredDesign } from '../../backend/src/modules/apis/design/design.schemas.ts'
import { candidateTypes, suggestType } from '../../backend/src/modules/apis/design/value-checks.ts'
import { typeHintFor } from '../../backend/src/modules/jivox/feed-schemas.ts'
import { matchesType } from '../../backend/src/modules/apis/testing/testing.service.ts'

let pass = 0
let fail = 0
const eq = (name: string, got: unknown, expected: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(got)}\n   exp ${JSON.stringify(expected)}`}`)
}

const cell = 'vivek1_respons1|price1 | hard to find locally'

eq('string keeps pipes as one text value', convertValue('string', cell), { ok: true, value: cell })
eq('int still a number', convertValue('int', '10'), { ok: true, value: 10 })
eq('int rejects a list', convertValue('int', '1|2').ok, false)
eq('float still a number', convertValue('float', '79.99'), { ok: true, value: 79.99 })
eq('boolean TRUE', convertValue('boolean', 'TRUE'), { ok: true, value: true })
eq('boolean no', convertValue('boolean', 'no'), { ok: true, value: false })
eq('image still a url', convertValue('image', 'https://cdn.example.com/a.png').ok, true)
eq('image rejects a date', convertValue('image', '2024-06-18').ok, false)

eq('array splits the consNew cell on |', convertValue('array', cell), {
  ok: true,
  value: ['vivek1_respons1', 'price1', 'hard to find locally'],
})
eq('array splits on comma when there is no pipe', listItems('smooth, great aroma, versatile'), ['smooth', 'great aroma', 'versatile'])
eq('array keeps a comma inside a pipe item', listItems('a, b|c'), ['a, b', 'c'])
eq('array one value is a one-item list', convertValue('array', 'only one'), { ok: true, value: ['only one'] })
eq('array drops empty pieces', convertValue('array', 'a | | b'), { ok: true, value: ['a', 'b'] })
eq('array of only separators does not convert', convertValue('array', ' | | ').ok, false)

eq('date as written', convertValue('date', '2024-06-18'), { ok: true, value: '2024-06-18' })
eq('date drops a time', parseDate('2024-06-18T09:15:00Z'), '2024-06-18')
eq('date drops a space time', parseDate('2024-06-18 09:15:00'), '2024-06-18')
eq('date drops a fraction and offset', parseDate('2024-06-18T09:15:00.000+05:30'), '2024-06-18')
eq('leap day 2024', parseDate('2024-02-29'), '2024-02-29')
eq('leap day 2000', parseDate('2000-02-29'), '2000-02-29')
eq('not a leap day 2023', parseDate('2023-02-29'), null)
eq('not a leap day 1900', parseDate('1900-02-29'), null)
eq('Feb 31 rejected', parseDate('2024-02-31'), null)
eq('April 31 rejected', parseDate('2024-04-31'), null)
eq('month 13 rejected', parseDate('2024-13-01'), null)
eq('string type does not turn a date into anything else', convertValue('string', '2024-06-18'), { ok: true, value: '2024-06-18' })

const stats = (over: Partial<Parameters<typeof candidateTypes>[0]>) =>
  candidateTypes({ filled: 10, int: 0, float: 0, boolean: 0, boolWords: 0, image: 0, array: 0, date: 0, ...over })
eq('text column still suggests string first', stats({}).slice(0, 1), ['string'])
eq('list column adds array after string', stats({ array: 10 }), ['string', 'array'])
eq('date column adds date after string', stats({ date: 10 }), ['string', 'date'])
eq('number column unchanged', stats({ int: 10, float: 10 }), ['int', 'float', 'string'])
eq('hint string still wins when array also fits', suggestType(['string', 'array'], 'string'), 'string')
eq('hint int still wins', suggestType(['int', 'float', 'string'], 'int'), 'int')
eq('old hints unchanged', [typeHintFor('review', 'cons'), typeHintFor('review', 'submission_date'), typeHintFor('review', 'is_active'), typeHintFor('review', 'author_location')], ['string', 'string', 'boolean', 'string'])

const design = (type: 'string' | 'array' | 'date', sourceColumn: string): StoredDesign => ({
  idField: { responseKey: 'reviewId' },
  fields: [{
    jivoxColumn: 'cons',
    sourceColumn,
    responseKey: 'cons',
    type,
    typeInContract: true,
    default: '',
    onMismatch: 'send',
    onEmpty: 'empty_string',
  }],
})
const row = { externalId: '1', data: { consNew: cell, submissionDate: '2024-06-18T09:15:00Z', title: 'Review_title1' } }
eq('API item sends consNew as an array', buildItem(row, design('array', 'consNew'), 'id').item.cons, ['vivek1_respons1', 'price1', 'hard to find locally'])
eq('API item sends a date as YYYY-MM-DD', buildItem(row, design('date', 'submissionDate'), 'id').item.cons, '2024-06-18')
eq('string field in the same row is not split', buildItem(row, design('string', 'title'), 'id').item.cons, 'Review_title1')
eq('matchesType accepts the array we send', matchesType('array', ['price', 'hard to find locally']), true)
eq('matchesType rejects an array for string', matchesType('string', ['price']), false)
eq('matchesType accepts the date we send', matchesType('date', '2024-06-18'), true)
eq('matchesType rejects Feb 31', matchesType('date', '2024-02-31'), false)
eq('matchesType int unchanged', matchesType('int', 10), true)

// The SQL used to count rows must agree with convertValue, or the Design tab warns about rows we can send.
const samples = [
  cell, 'smooth, great aroma, versatile', 'only one', 'a | | b', ' | | ', 'hello', '1,2',
  '2024-06-18', '2024-06-18T09:15:00Z', '2024-06-18 09:15:00', '2024-02-29', '2000-02-29',
  '2023-02-29', '1900-02-29', '2024-02-31', '2024-04-31', '2024-13-01', 'not-a-date', '10', 'TRUE',
]
const sql = `
SELECT v,
  ((SELECT count(*)::int FROM unnest(string_to_array(v, CASE WHEN strpos(v, '|') > 0 THEN '|' ELSE ',' END)) AS part WHERE btrim(part) <> '')) >= 1 AS as_array,
    CASE WHEN v ~ $pat$${PATTERNS.date}$pat$ THEN (
      substring(v from 9 for 2)::int <= CASE substring(v from 6 for 2)
        WHEN '02' THEN CASE WHEN (substring(v from 1 for 4)::int % 4 = 0 AND substring(v from 1 for 4)::int % 100 <> 0) OR (substring(v from 1 for 4)::int % 400 = 0) THEN 29 ELSE 28 END
        WHEN '04' THEN 30 WHEN '06' THEN 30 WHEN '09' THEN 30 WHEN '11' THEN 30
        ELSE 31 END
    ) ELSE false END AS as_date
FROM unnest(ARRAY[${samples.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')}]::text[]) AS v
`
try {
  const out = execFileSync('psql', ['-d', 'postgres', '-tA', '-F', '\t', '-c', sql], { encoding: 'utf8' })
  for (const line of out.trim().split('\n')) {
    const [v, asArray, asDate] = line.split('\t')
    const arrayOk = convertValue('array', v).ok
    const dateOk = convertValue('date', v).ok
    eq(`sql array agrees: ${v}`, asArray === 't', arrayOk)
    eq(`sql date agrees: ${v}`, asDate === 't', dateOk)
  }
} catch (error) {
  fail++
  console.log(`✘ sql check did not run\n   ${error instanceof Error ? error.message.split('\n')[0] : error}`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
