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

Initialize the builder once with Sequelize's `Op`, then call `build()` anywhere.

```js
import { Op } from 'sequelize';
import QueryBuilder from '@webinmove/kuuliza';

QueryBuilder.init(Op);

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
- `or` — OR condition

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
