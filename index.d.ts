import { Op, WhereOptions, Order } from 'sequelize';

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

declare class QueryBuilder {
  static init(Op: typeof import('sequelize').Op): typeof QueryBuilder;
  static build(params: QueryParams): BuiltQuery;
  static getWhereQuery(params: QueryParams): WhereOptions;
  static getOrderQuery(params: QueryParams): Order | null;
  static getOffsetQuery(params: QueryParams, defaultOffset?: number): number;
  static getLimitQuery(params: QueryParams, defaultLimit?: number): number;
  static getAttributesQuery(params: QueryParams): string[] | undefined;
}

export default QueryBuilder;
