# Changelog

All notable changes to `@webinmove/kuuliza` are documented here. This project
adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - Unreleased

### Added

- **Aggregations** — `buildAggregation(params)` builds a grouped `findAll` options
  object (`raw: true`, `subQuery: false`) from `filters` / `groupBy` / `metrics` /
  `having` / `sort`. Supports `count`, `countDistinct`, `sum`, `avg`, `min`, `max`,
  date-bucket dimensions (`{ field, interval }`), and metric-alias `having` / `sort`.
  `coerceAggregation(rows, params)` casts string metrics to numbers.
- **Faceted search** — `buildSearch(params)` returns hits/count/facet specs (no
  execution); `assembleSearch(...)` builds the stable `{ hits, total, facets, stats }`
  envelope. `terms` (disjunctive) and `stats` facet types.
- **`fieldMap`** on `buildAggregation` and `buildSearch` — `{ attribute: dbColumn }`
  so `col()` targets the real column on `underscored` (snake_case) Sequelize models.
  Applies to metric targets, date-bucket dimensions, and facet fields; plain `groupBy`
  dimensions are mapped by Sequelize itself.
- **Date-bucket `timezone`** — `{ field, interval, timezone }` (default `'UTC'`).
  `DATE_TRUNC` is emitted with an explicit timezone so buckets are deterministic
  regardless of the DB session timezone. Requires PostgreSQL 14+.
- `QueryBuilder.init(Sequelize)` (whole namespace) enables aggregation/search; legacy
  `init(Op)` keeps `build()` working.

### Changed

- **Aggregation paging is opt-in.** `buildAggregation` applies `limit`/`offset` only
  when `size`/`from` are provided; a bare aggregation returns **every** group instead
  of defaulting to 100. (`build()` keeps its default limit of 100 for list queries.)

### Fixed / hardened

- `or` / `not` operands that are nested operator objects (`{ or: { gt: 1 } }`) now
  build real predicates instead of stringifying to `'[object Object]'`.
- Invalid `sort` shapes throw a clear error (non-array `sort`, non-`ASC`/`DESC`
  direction) instead of a raw `TypeError`.
- `from` / `size` use `Number` + integer validation; non-integers fall back to the
  default rather than being silently corrupted by `parseInt` (`2.9 → 2`, `1e21 → 1`).
- The aggregate-function whitelist is a null-prototype object, so a user-supplied
  function name can no longer resolve an `Object.prototype` member
  (`constructor`, `toString`, …) and escape into invalid SQL.
- `having` predicates must be objects and may use comparison operators only; non-object
  predicates and WHERE-only operators are rejected up front.
- Duplicate `groupBy` output names are rejected (they silently overwrote each other
  under `raw: true`).
- Non-string `fieldMap` values are ignored (fall back to the attribute name).

## [1.0.0]

- Initial release: `build(params)` — filters, sort, paging, attributes.
