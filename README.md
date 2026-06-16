# Kuuliza

## Description

Kuuliza means "query" in Swahili.

This package exposes Sequelize querying abilities from a simple params object.
It is designed to be and stay simple !!!

**Here is an example:**

```js
QueryBuilder.build({
  filters: {
    assignations: { is: null },
    companyIdentifier: { not: null },
    alertShortId: 'ALERT_SHORT_ID',
    eventShortId: [
      'EVENT_SHORT_ID_1',
      'EVENT_SHORT_ID_2',
      'EVENT_SHORT_ID_3'
    ],
    indexedMeta: {
      eventType: 'EVENT_TYPE_VALUE',
      eventSeverity: ['LOW', 'HIGH']
    },
    updatedAt: {
      gte: Date.now()
    }
  },
  from: 0,
  size: 50,
  sort: [{ updatedAt: 'ASC' }]
});
```

## Usage

Initialize the builder once with `Sequelize`, then call `build()` (and
`buildAggregation()` / `buildSearch()`) anywhere.

```js
import Sequelize from 'sequelize';
import QueryBuilder from '@webinmove/kuuliza';

QueryBuilder.init(Sequelize); // pass the whole namespace — enables aggregation & search

const query = QueryBuilder.build({
  filters: {
    status: 'active',
    createdAt: { gte: Date.now() }
  },
  sort: [{ createdAt: 'DESC' }],
  from: 0,
  size: 20
});

const results = await MyModel.findAll(query);
```

> `QueryBuilder.init(Op)` still works if you only use `build()`. Aggregations and faceted
> search need the Sequelize helpers (`fn`, `col`, `literal`, `where`), so pass the whole
> namespace — `init(Sequelize)` — or the legacy `init(Op, { fn, col, literal, where })`.

### Build params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `filters` | object | no | Key/value pairs mapped to Sequelize `where` conditions |
| `sort` | array | no | Array of `{ field: 'ASC' \| 'DESC' }` objects |
| `from` | number | no | Offset (default: `0`) |
| `size` | number | no | Limit (default: `100`) |
| `attributes` | string[] | no | Columns to select |

### Filter operators

Filters support the following operators as object keys:

- `eq` `ne` — equality / inequality
- `gt` `gte` `lt` `lte` — comparisons
- `in` `notIn` — array membership
- `like` `notLike` `iLike` `notILike` — pattern matching
- `between` `notBetween` — range
- `overlap` — array overlap
- `is` `not` — null checks (use `{ is: null }` or `{ not: null }`)
- `or` — OR condition. Takes an array of values/predicates, e.g. `{ or: [60, 130] }` or
  `{ or: [{ gt: 100 }, { lt: 10 }] }`. A single nested operator object (`{ or: { gt: 1 } }`)
  is also accepted.

Nested objects (e.g. JSON columns) are supported — each key in the nested object is treated as a sub-filter.

### Output

`build()` returns a plain object ready to pass to any Sequelize finder:

```js
{
  attributes: undefined,    // or string[]
  where: { ... },           // Sequelize WhereOptions
  order: [['field', 'ASC']] // or null
  limit: 100,
  offset: 0
}
```

> **Behavior note:** filter values `''`, `0` and `false` are real equality conditions —
> only `null`/`undefined` mean `IS NULL`.

## Aggregations

`buildAggregation()` turns a params object into a grouped `findAll` options object
(`raw: true`, `subQuery: false`). It reuses `filters`, `sort`, `from` and `size`, and
leaves `build()` untouched.

```js
const options = QueryBuilder.buildAggregation({
  filters: { archived: false },
  groupBy: { field: 'createdAt', interval: 'month' }, // 'field' | { field, interval } | [ …mix ]
  metrics: {
    count: 'count',                       // shorthand → COUNT(*)
    revenue: { fn: 'sum', field: 'amount' },
    avgAmount: { fn: 'avg', field: 'amount' }
  },
  having: { count: { gte: 10 } },         // filter buckets — keyed by metric alias
  sort: [{ count: 'DESC' }]               // order by a metric alias or a groupBy field
});

const rows = await MyModel.findAll(options);
// rows: [ { createdAt: <Date>, count: '42', revenue: '15000.50', avgAmount: '357.15' }, … ]
```

| Field | Description |
| --- | --- |
| `groupBy` | A field name, a date bucket `{ field, interval }`, or an array of either. Omit it for global stats (a single row). |
| `metrics` | Object of `alias → spec`. Each alias becomes the output column. Spec is `'count'` or `{ fn, field }`. |
| `having` | Object of `alias → { operator: value }`, e.g. `{ count: { gte: 10 } }`. |
| `sort` | `[{ field-or-alias: 'ASC'/'DESC' }]`. Sorting by a metric alias gives you top‑N buckets. |
| `from` / `size` | Offset / limit **over groups** (rejected when there is no `groupBy`). |

- **Aggregate functions:** `count`, `countDistinct`, `sum`, `avg`, `min`, `max`. `count`
  with no `field` is `COUNT(*)`; the others require a `field`.
- **Date intervals:** `hour`, `day`, `week`, `month`, `quarter`, `year`. The date-bucket
  form takes an optional `timezone` (`{ field, interval, timezone }`, default `'UTC'`) so
  `DATE_TRUNC` boundaries are deterministic regardless of the DB session timezone —
  requires PostgreSQL 14+.
- **Numbers come back as strings** (Postgres returns aggregates as strings under `raw`).
  Pass them through `coerceAggregation()` to turn `count`/`sum`/`avg` into JS numbers
  (`min`/`max` are left untouched — they are type‑ambiguous):

  ```js
  const rows = QueryBuilder.coerceAggregation(await MyModel.findAll(options), params);
  ```
- `size` limits the number of **groups returned**, not the query cost — it is not DoS
  protection.

### `fieldMap` — snake_case / `underscored` models

kuuliza wraps metric targets and date-bucket fields in `col()`, which emits the name
**verbatim** — it does not resolve a Sequelize model's `field:` mapping. If your model is
`underscored` (or otherwise maps camelCase attributes to snake_case columns), pass
`fieldMap: { attribute: dbColumn }` so those `col()` identifiers target the real column:

```js
// Model: { distributionRequestShortId: { field: 'distribution_request_short_id' }, ... }
const fieldMap = Object.fromEntries(
  Object.entries(Model.rawAttributes).map(([attr, def]) => [attr, def.field || attr])
);

QueryBuilder.buildAggregation({
  groupBy: { field: 'createdAt', interval: 'day' },             // bucket on created_at
  metrics: { uniq: { fn: 'countDistinct', field: 'titleId' } }, // COUNT(DISTINCT title_id)
  fieldMap                                                      // { createdAt:'created_at', titleId:'title_id', … }
});
// date-bucket rows still come back keyed by the attribute name (`createdAt`), not the column.
```

- **Plain `groupBy` dimensions need no entry** — they are emitted as bare attribute strings,
  which Sequelize maps to columns (`GROUP BY` then references the output alias).
- Only **metric fields** (`{ fn, field }`), **date-bucket fields**, and **facet fields**
  (terms value/group, stats min/max/avg) are resolved through `fieldMap`.
- `filters` and disjunctive-facet drops always key on the **attribute** name (Sequelize maps
  those), so they ignore `fieldMap`. `buildSearch()` accepts the same `fieldMap`.

## Faceted search

`buildSearch()` produces the option specs for a search with facet counts — a hits query,
a total‑count spec, and one query per facet — and returns them **without executing**. The
controller runs them in parallel and assembles the response with `assembleSearch()`.

Disjunctive facets compute their counts with **their own filter removed** (so a selected
facet still shows the other values' counts), while every other facet keeps it.

```js
const spec = QueryBuilder.buildSearch({
  filters: { brand: 'Nike', size: '42' },
  from: 0,
  size: 20,
  facets: {
    brand: { type: 'terms', disjunctive: true, limit: 10 },
    size:  { type: 'terms', disjunctive: true },
    color: { type: 'terms', disjunctive: true },
    price: { type: 'stats' }              // min / max / avg / count
  }
});

const [hits, total, ...facetRows] = await Promise.all([
  MyModel.findAll(spec.hits),
  MyModel.count(spec.count),
  ...spec.facets.map((f) => MyModel.findAll(f.options))
]);

const response = QueryBuilder.assembleSearch({
  hits,
  total,
  facetResults: spec.facets.map((f, i) => ({ name: f.name, type: f.type, rows: facetRows[i] }))
});
```

- Facet types: `terms` (value/count buckets, `disjunctive` defaults to `true`, `limit`
  defaults to `10`) and `stats` (numeric `min`/`max`/`avg`/`count`, `disjunctive` defaults
  to `false`).
- **Field validation is the consuming app's responsibility.** kuuliza is schema‑agnostic;
  it never executes a query, and field names are identifier‑escaped via `col()`. Restrict
  which fields are facetable in your controller/validator.

## Response envelope

The builder returns Sequelize options; your controller assembles the HTTP response. The
recommended envelope is **stable and additive** — every field is typed once and appears
only when the request asks for it; a field never changes type:

```js
{
  hits:    [ … ],                          // list / search rows           (array)
  total:   123,                            // matching count               (number)
  buckets: [ { …dimensions, …metrics } ],  // aggregation rows             (array)
  facets:  { brand: [ { value, count } ] },// facet distributions          (object)
  stats:   { price: { min, max, avg, count } } // numeric facet stats      (object)
}
```
