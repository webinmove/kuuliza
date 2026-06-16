import { WhereOptions, Order, Fn, Col } from 'sequelize';

// --- Query -------------------------------------------------------------------

export type SortDirection = 'ASC' | 'DESC';

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | { is?: null; not?: null }
  | { eq?: unknown; ne?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown }
  | { in?: unknown[]; notIn?: unknown[] }
  | { like?: string; notLike?: string; iLike?: string; notILike?: string }
  | { between?: [unknown, unknown]; notBetween?: [unknown, unknown] }
  | { overlap?: unknown[] }
  | { or?: unknown }
  | Record<string, FilterValue>;

export interface QueryParams {
  filters?: Record<string, FilterValue>;
  sort?: Array<Record<string, SortDirection>>;
  from?: number;
  size?: number;
  attributes?: string[];
}

export interface BuiltQuery {
  attributes: string[] | undefined;
  where: WhereOptions;
  order: Order | null;
  limit: number;
  offset: number;
}

// --- Aggregation -------------------------------------------------------------

export type AggregateFn = 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';
export type DateInterval = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

// Date-bucket form takes an optional `timezone` (default 'UTC') so DATE_TRUNC boundaries
// are deterministic regardless of the DB session timezone (PostgreSQL 14+).
// Future: add a JSONB form { field, path }.
export type GroupByField =
  | string
  | { field: string; interval: DateInterval; timezone?: string };

// Future: extend the object form with `distinct` and `cast`.
export type MetricSpec = 'count' | { fn: AggregateFn; field?: string };

export type HavingPredicate = Partial<Record<
  'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'notBetween' | 'in' | 'notIn',
  unknown
>>;

export interface AggregationParams {
  filters?: Record<string, FilterValue>;
  sort?: Array<Record<string, SortDirection>>;
  from?: number;
  size?: number;
  groupBy?: GroupByField | GroupByField[];
  metrics?: Record<string, MetricSpec>;
  having?: Record<string, HavingPredicate>;
  coerceNumbers?: boolean;
  // attribute -> DB column, for models whose attributes differ from their columns
  // (e.g. `underscored` snake_case). Applied to col() in metric targets and date-bucket
  // dimensions. Plain groupBy dimensions are mapped by Sequelize itself, so they need no entry.
  fieldMap?: Record<string, string>;
}

export type AggregationAttribute = string | [Fn | Col, string];

export interface BuiltAggregation {
  attributes: AggregationAttribute[];
  where: WhereOptions;
  group?: Array<string | Fn>;
  having?: WhereOptions;
  order: Order | null;
  raw: true;
  subQuery: false;
  limit?: number;  // present only when `size` was provided — else all groups
  offset?: number; // present only when `from` was provided
}

export type AggregationRow = Record<string, unknown>;

// --- Faceted search ----------------------------------------------------------

export type FacetType = 'terms' | 'stats';

export interface FacetSpec {
  type?: FacetType;       // default 'terms'
  disjunctive?: boolean;  // default true for terms, false for stats
  limit?: number;         // terms only, default 10
}

export interface SearchParams extends QueryParams {
  facets?: Record<string, FacetSpec>;
  // attribute -> DB column for facet fields (terms value/group, stats min/max/avg).
  // The facet's response key stays the attribute name; the WHERE/disjunctive drop also
  // keys on the attribute (Sequelize maps it). See AggregationParams.fieldMap.
  fieldMap?: Record<string, string>;
}

export interface FacetQuerySpec {
  name: string;
  type: FacetType;
  options: Record<string, unknown>;
}

export interface BuiltSearch {
  hits: BuiltQuery;
  count: { where: WhereOptions };
  facets: FacetQuerySpec[];
}

export interface FacetResult {
  name: string;
  type: FacetType;
  rows: AggregationRow[];
}

export interface SearchResponse {
  hits: AggregationRow[];
  total: number;
  facets?: Record<string, Array<{ value: unknown; count: number }>>;
  stats?: Record<string, { min: unknown; max: unknown; avg: unknown; count: number }>;
}

export interface SequelizeHelpers {
  fn: typeof import('sequelize').fn;
  col: typeof import('sequelize').col;
  literal: typeof import('sequelize').literal;
  where: typeof import('sequelize').where;
}

declare class QueryBuilder {
  // Pass the whole Sequelize namespace (recommended) — enables build, buildAggregation and
  // buildSearch. Legacy init(Op[, helpers]) keeps build() working.
  static init(sequelize: typeof import('sequelize').Sequelize): typeof QueryBuilder;
  static init(Op: typeof import('sequelize').Op, helpers?: SequelizeHelpers): typeof QueryBuilder;

  static build(params: QueryParams): BuiltQuery;
  static getWhereQuery(params: QueryParams): WhereOptions;
  static getOrderQuery(params: QueryParams): Order | null;
  static getOffsetQuery(params: QueryParams, defaultOffset?: number): number;
  static getLimitQuery(params: QueryParams, defaultLimit?: number): number;
  static getAttributesQuery(params: QueryParams): string[] | undefined;

  static buildAggregation(params: AggregationParams): BuiltAggregation;
  static coerceAggregation(rows: AggregationRow[], params: AggregationParams): AggregationRow[];

  static buildSearch(params: SearchParams): BuiltSearch;
  static assembleSearch(input: { hits: AggregationRow[]; total: number; facetResults: FacetResult[] }): SearchResponse;
}

export default QueryBuilder;
