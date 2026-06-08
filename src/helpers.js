// Coerce a Postgres-stringified value to a Number, leaving non-numeric values (and
// null/undefined) untouched.
export const toNumber = (value) => {
  if (value === undefined || value === null) {
    return value;
  }
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
};

// Normalize a groupBy param (single value, array, or absent) to an array.
export const normalizeGroupBy = (groupBy) => {
  if (groupBy === undefined || groupBy === null) {
    return [];
  }
  return Array.isArray(groupBy) ? groupBy : [groupBy];
};
