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

// Future: extend the date-bucket form with `timezone`, and add a JSONB form { field, path }.
export type GroupByField = string | { field: string; interval: DateInterval };

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
  limit: number;
  offset: number;
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
