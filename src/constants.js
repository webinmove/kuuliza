// Whitelisted aggregate functions (DSL name -> SQL function). countDistinct is handled
// specially (nested DISTINCT). Null-prototype so a user-supplied fn name can never
// resolve a Object.prototype member ('constructor', 'toString', …) and bypass the
// whitelist into invalid SQL.
export const AGG_FUNCTIONS = Object.assign(Object.create(null), {
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX'
});

// Allowed DATE_TRUNC intervals for date-bucket dimensions.
export const DATE_INTERVALS = new Set(['hour', 'day', 'week', 'month', 'quarter', 'year']);

// Metric functions whose string output (Postgres returns aggregates as strings under
// raw:true) is safe to coerce to a JS Number. min/max are excluded — type-ambiguous.
export const COERCIBLE_FNS = new Set(['count', 'countDistinct', 'sum', 'avg']);

// Operators allowed in a HAVING predicate — comparisons only. WHERE-only operators
// (is/like/overlap/or/…) are meaningless or invalid against an aggregate and would
// surface as a late Postgres error, so they are rejected up front.
export const HAVING_OPERATORS = new Set([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'in', 'notIn'
]);
