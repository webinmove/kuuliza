// Whitelisted aggregate functions (DSL name -> SQL function). countDistinct is handled
// specially (nested DISTINCT). Function names are NEVER taken from user input.
export const AGG_FUNCTIONS = {
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX'
};

// Allowed DATE_TRUNC intervals for date-bucket dimensions.
export const DATE_INTERVALS = new Set(['hour', 'day', 'week', 'month', 'quarter', 'year']);

// Metric functions whose string output (Postgres returns aggregates as strings under
// raw:true) is safe to coerce to a JS Number. min/max are excluded — type-ambiguous.
export const COERCIBLE_FNS = new Set(['count', 'countDistinct', 'sum', 'avg']);
