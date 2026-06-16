import { AGG_FUNCTIONS, DATE_INTERVALS, COERCIBLE_FNS, HAVING_OPERATORS } from './constants.js';
import { toNumber, normalizeGroupBy } from './helpers.js';

class QueryBuilder {
  // Accepts either the whole Sequelize namespace (recommended: init(Sequelize)) or a bare
  // Op (legacy: init(Op) — build() only). When the namespace is passed, the helpers needed
  // by buildAggregation/buildSearch (fn, col, literal, where) are pulled off it.
  static init (sequelizeOrOp, helpers = {}) {
    if (!sequelizeOrOp) {
      throw new Error('Sequelize Operators are required');
    }
    const isNamespace = !!sequelizeOrOp.Op;
    const source = isNamespace ? sequelizeOrOp : helpers;

    QueryBuilder.Op = isNamespace ? sequelizeOrOp.Op : sequelizeOrOp;
    QueryBuilder.fn = source.fn;
    QueryBuilder.col = source.col;
    QueryBuilder.literal = source.literal;
    QueryBuilder.where = source.where;

    return this;
  }

  static getSequelizeOpByString (name) {
    // TODO adjacent all and any col contained contains endsWith iRegexp is like match noExtendLeft noExtendRight
    //  notIRegexp notRegexp placeholder regexp startsWith strictLeft strictRight substring values
    switch (name) {
      case 'eq':
        return QueryBuilder.Op.eq;
      case 'ne':
        return QueryBuilder.Op.ne;
      case 'or':
        return QueryBuilder.Op.or;
      case 'gt':
        return QueryBuilder.Op.gt;
      case 'gte':
        return QueryBuilder.Op.gte;
      case 'lt':
        return QueryBuilder.Op.lt;
      case 'lte':
        return QueryBuilder.Op.lte;
      case 'in':
        return QueryBuilder.Op.in;
      case 'not':
        return QueryBuilder.Op.not;
      case 'notIn':
        return QueryBuilder.Op.notIn;
      case 'overlap':
        return QueryBuilder.Op.overlap;
      case 'like':
        return QueryBuilder.Op.like;
      case 'notLike':
        return QueryBuilder.Op.notLike;
      case 'iLike':
        return QueryBuilder.Op.iLike;
      case 'notILike':
        return QueryBuilder.Op.notILike;
      case 'between':
        return QueryBuilder.Op.between;
      case 'notBetween':
        return QueryBuilder.Op.notBetween;
      case 'is':
        return QueryBuilder.Op.is;
      default:
        return undefined;
    }
  }

  static buildWhereClause (key, value) {
    // Only undefined/null map to IS NULL — empty string, 0 and false are real equality
    // predicates (a plain `if (!value)` would mis-coerce them to IS NULL).
    if (value === undefined || value === null) {
      return null;
    }
    if (Array.isArray(value)) {
      return { [QueryBuilder.Op.in]: value };
    }

    if (typeof value === 'object') {
      const objectQuery = [];
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        const sequelizeOp = QueryBuilder.getSequelizeOpByString(nestedKey);
        if (sequelizeOp) {
          // or/not take sub-PREDICATES, not a scalar — recurse so a nested operator
          // object ({ or: { gt: 1 } }) builds real clauses instead of stringifying to
          // '[object Object]'. Scalars and plain value-arrays pass through untouched.
          const operand = (nestedKey === 'or' || nestedKey === 'not')
            ? QueryBuilder.buildLogicalOperand(nestedValue)
            : nestedValue;
          objectQuery.push({ [sequelizeOp]: operand });
        } else {
          objectQuery.push({ [nestedKey]: QueryBuilder.buildWhereClause(nestedKey, nestedValue) });
        }
      }

      return { [QueryBuilder.Op.and]: objectQuery };
    }

    return { [QueryBuilder.Op.eq]: value };
  }

  // Build the operand of an or/not operator. An array maps each element (objects become
  // predicates, scalars stay scalars); a bare object becomes a single predicate. This
  // keeps `{ or: [60, 130] }` as `[60, 130]` while turning `{ or: { gt: 1 } }` into a
  // real clause instead of letting Sequelize stringify the raw object.
  static buildLogicalOperand (value) {
    const toPredicate = (v) =>
      (v !== null && typeof v === 'object') ? QueryBuilder.buildWhereClause(null, v) : v;
    return Array.isArray(value) ? value.map(toPredicate) : toPredicate(value);
  }

  // TODO better handle object type and operator
  static getWhereQuery (params) {
    const filters = params.filters;
    if (!filters) {
      return {};
    }

    const where = {};

    Object.entries(filters).forEach(([key, value]) => {
      where[key] = QueryBuilder.buildWhereClause(key, value);
    });

    return where;
  }

  // sort: [{ field1: 'DESC' }, { field2: 'ASC' }];
  static getOrderQuery (params) {
    const sort = params.sort;
    if (!sort) {
      return null;
    }
    if (!Array.isArray(sort)) {
      throw new Error('sort must be an array of { field: direction } objects');
    }
    const order = [];
    sort.forEach((item) => {
      Object.entries(item).forEach(([key, value]) => {
        if (typeof value !== 'string' || !/^(asc|desc)$/i.test(value)) {
          throw new Error(`sort direction for "${key}" must be 'ASC' or 'DESC'`);
        }
        order.push([key, value.toUpperCase()]);
      });
    });
    return order;
  }

  // Parse a paging value (from/size). parseInt would silently corrupt floats ('2.9' -> 2)
  // and scientific notation (1e21 -> 1), so use Number + an integer check.
  static toPagingInt (value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  }

  // from: 0;
  static getOffsetQuery (params, defaultOffset = 0) {
    return QueryBuilder.toPagingInt(params.from, defaultOffset);
  }

  // size: 100;
  static getLimitQuery (params, defaultLimit = 100) {
    return QueryBuilder.toPagingInt(params.size, defaultLimit);
  }

  // attributes: ['id', 'name', 'email'];
  static getAttributesQuery (params) {
    return params.attributes || undefined;
  }

  static build (params) {
    return {
      attributes: QueryBuilder.getAttributesQuery(params),
      where: QueryBuilder.getWhereQuery(params),
      order: QueryBuilder.getOrderQuery(params),
      limit: QueryBuilder.getLimitQuery(params),
      offset: QueryBuilder.getOffsetQuery(params)
    };
  }

  // ---------------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------------

  static assertAggregationReady () {
    if (!QueryBuilder.fn || !QueryBuilder.col || !QueryBuilder.literal || !QueryBuilder.where) {
      throw new Error('Aggregation requires Sequelize helpers — call QueryBuilder.init(Sequelize)');
    }
  }

  // Resolve an attribute name to its real DB column via the optional fieldMap.
  // kuuliza stays schema-agnostic: a caller whose Sequelize model uses `field:`
  // mapping (e.g. underscored snake_case columns) passes { attr: dbColumn } so the
  // identifiers wrapped in col() target the real column instead of the camelCase
  // attribute. Plain groupBy dimensions are NOT resolved here — they ride Sequelize's
  // own attribute->field mapping (bare string in SELECT + GROUP BY by output alias).
  static resolveField (fieldMap, field) {
    const mapped = fieldMap && fieldMap[field];
    // Only a non-empty string is a usable column; ignore numbers/''/0 (which would
    // emit col(123) or silently fall through) and fall back to the attribute name.
    return (typeof mapped === 'string' && mapped) ? mapped : field;
  }

  // metric spec: 'count' (shorthand -> COUNT(*)) | { fn, field }
  // Returns { entry: [expr, alias], expr } — expr is cached so HAVING can reuse it.
  static buildMetric (alias, spec, fieldMap) {
    const { fn, col, literal } = QueryBuilder;
    const normalized = typeof spec === 'string' ? { fn: spec } : (spec || {});
    const fnName = normalized.fn;
    const field = normalized.field;
    const column = field && QueryBuilder.resolveField(fieldMap, field);

    let expr;
    if (fnName === 'count') {
      expr = field ? fn('COUNT', col(column)) : fn('COUNT', literal('*'));
    } else if (fnName === 'countDistinct') {
      if (!field) {
        throw new Error(`Aggregate "${alias}": countDistinct requires a field`);
      }
      expr = fn('COUNT', fn('DISTINCT', col(column)));
    } else {
      const sqlFn = AGG_FUNCTIONS[fnName];
      if (!sqlFn) {
        throw new Error(`Unsupported aggregate function: ${fnName}`);
      }
      if (!field) {
        throw new Error(`Aggregate "${alias}": ${fnName} requires a field`);
      }
      expr = fn(sqlFn, col(column));
    }

    return { entry: [expr, alias], expr };
  }

  // groupBy entry: 'field' (plain column) | { field, interval, timezone? } (date bucket)
  // Returns { attribute, group, name } — name is the output column / collision key.
  // The date-bucket col() is resolved through fieldMap; the output alias stays the
  // attribute name so callers keep camelCase row keys.
  static buildDimension (dim, fieldMap) {
    const { fn, col } = QueryBuilder;
    if (typeof dim === 'string') {
      return { attribute: dim, group: dim, name: dim };
    }

    const { field, interval, timezone = 'UTC' } = dim || {};
    if (!field) {
      throw new Error('groupBy dimension requires a field');
    }
    if (!DATE_INTERVALS.has(interval)) {
      throw new Error(`Unsupported date interval: ${interval}. Use one of: ${[...DATE_INTERVALS].join(', ')}`);
    }

    // 3-arg DATE_TRUNC pins buckets to an explicit timezone (default UTC) so boundaries
    // are deterministic regardless of the DB session's TimeZone. Requires PostgreSQL 14+.
    const expr = fn('DATE_TRUNC', interval, col(QueryBuilder.resolveField(fieldMap, field)), timezone);
    return { attribute: [expr, field], group: expr, name: field };
  }

  // having: { alias: { gte: 10, ... } } -> sequelize.where(metricExpr, Op.gte, 10) clauses.
  static buildHaving (having, exprByAlias) {
    if (!having) {
      return null;
    }
    const { Op, where } = QueryBuilder;
    const clauses = [];

    Object.entries(having).forEach(([alias, predicate]) => {
      const expr = exprByAlias[alias];
      if (!expr) {
        throw new Error(`having references unknown metric "${alias}"`);
      }
      if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
        throw new Error(`having predicate for "${alias}" must be an object like { gte: 10 }`);
      }
      Object.entries(predicate).forEach(([op, value]) => {
        if (!HAVING_OPERATORS.has(op)) {
          throw new Error(`Unsupported having operator: ${op}`);
        }
        clauses.push(where(expr, QueryBuilder.getSequelizeOpByString(op), value));
      });
    });

    if (clauses.length === 0) {
      return null;
    }
    if (clauses.length === 1) {
      return clauses[0];
    }
    return { [Op.and]: clauses };
  }

  static buildAggregation (params) {
    QueryBuilder.assertAggregationReady();

    const fieldMap = params.fieldMap;
    const dims = normalizeGroupBy(params.groupBy).map((d) => QueryBuilder.buildDimension(d, fieldMap));
    const dimNames = new Set(dims.map((d) => d.name));
    // Two dimensions sharing an output name (e.g. a plain field and a date bucket on the
    // same field) would emit duplicate "... AS x" columns and silently overwrite each
    // other under raw:true. Reject it rather than lose data.
    if (dimNames.size !== dims.length) {
      throw new Error('groupBy dimensions collide on an output name — each must be unique');
    }

    const exprByAlias = {};
    const metricEntries = Object.entries(params.metrics || {}).map(([alias, spec]) => {
      if (dimNames.has(alias)) {
        throw new Error(`Metric alias "${alias}" collides with a groupBy field`);
      }
      const { entry, expr } = QueryBuilder.buildMetric(alias, spec, fieldMap);
      exprByAlias[alias] = expr;
      return entry;
    });

    if (dims.length === 0 && (params.from !== undefined || params.size !== undefined)) {
      throw new Error('from/size require groupBy — a global aggregation returns a single row');
    }

    if (params.sort) {
      params.sort.forEach((item) => {
        Object.keys(item).forEach((key) => {
          if (!dimNames.has(key) && !exprByAlias[key]) {
            throw new Error(`Cannot sort by "${key}" — not a groupBy field or a metric`);
          }
        });
      });
    }

    const result = {
      attributes: [...dims.map((d) => d.attribute), ...metricEntries],
      where: QueryBuilder.getWhereQuery(params),
      order: QueryBuilder.getOrderQuery(params),
      raw: true,
      subQuery: false
    };

    // Paging is OPT-IN over groups: apply limit/offset only when the caller asks.
    // A bare aggregation returns EVERY group — a default limit would silently
    // truncate faceted counts (e.g. per-status totals for a page of requests).
    if (params.size !== undefined) {
      result.limit = QueryBuilder.getLimitQuery(params);
    }
    if (params.from !== undefined) {
      result.offset = QueryBuilder.getOffsetQuery(params);
    }

    if (dims.length) {
      result.group = dims.map((d) => d.group);
    }

    const having = QueryBuilder.buildHaving(params.having, exprByAlias);
    if (having) {
      result.having = having;
    }

    return result;
  }

  // Post-query helper: coerce metric columns (count/countDistinct/sum/avg) from Postgres
  // strings to JS Numbers. Dimensions, date buckets and min/max are left untouched.
  // Note: JS numbers lose precision above 2^53 — opt-in via coerceNumbers for that reason.
  static coerceAggregation (rows, params) {
    const metrics = (params && params.metrics) || {};
    const numericAliases = Object.entries(metrics)
      .filter(([, spec]) => COERCIBLE_FNS.has(typeof spec === 'string' ? spec : spec.fn))
      .map(([alias]) => alias);

    if (numericAliases.length === 0) {
      return rows;
    }

    return rows.map((row) => {
      const out = { ...row };
      numericAliases.forEach((alias) => {
        if (out[alias] !== undefined && out[alias] !== null) {
          out[alias] = Number(out[alias]);
        }
      });
      return out;
    });
  }

  // ---------------------------------------------------------------------------
  // Faceted search
  // ---------------------------------------------------------------------------

  // Disjunctive facets drop their OWN filter so their counts show what would match if the
  // value were toggled; every other facet (and the hits query) keeps it.
  static buildFacetWhere (field, facet, params) {
    const filters = { ...(params.filters || {}) };
    if (facet.disjunctive) {
      delete filters[field];
    }
    return QueryBuilder.getWhereQuery({ ...params, filters });
  }

  // facets: { field: { type: 'terms' | 'stats', disjunctive?, limit? } }
  // Returns SPECS only: { hits, count, facets:[{ name, type, options }] }. The controller
  // executes them (Promise.all) and feeds the rows to assembleSearch().
  static buildSearch (params) {
    QueryBuilder.assertAggregationReady();
    const { fn, col, literal } = QueryBuilder;

    const fieldMap = params.fieldMap;
    const facets = Object.entries(params.facets || {}).map(([field, rawFacet]) => {
      const facet = rawFacet || {};
      const type = facet.type || 'terms';
      const disjunctive = facet.disjunctive !== undefined ? facet.disjunctive : type === 'terms';
      // buildFacetWhere keys on the attribute name (the filters key + Sequelize Op
      // mapping), so it takes the raw field, not the resolved column.
      const where = QueryBuilder.buildFacetWhere(field, { disjunctive }, params);
      const column = QueryBuilder.resolveField(fieldMap, field);

      let options;
      if (type === 'stats') {
        options = {
          attributes: [
            [fn('MIN', col(column)), 'min'],
            [fn('MAX', col(column)), 'max'],
            [fn('AVG', col(column)), 'avg'],
            [fn('COUNT', literal('*')), 'count']
          ],
          where,
          raw: true,
          subQuery: false
        };
      } else if (type === 'terms') {
        options = {
          attributes: [
            [col(column), 'value'],
            [fn('COUNT', literal('*')), 'count']
          ],
          where,
          group: [column],
          order: [[fn('COUNT', literal('*')), 'DESC']],
          limit: facet.limit !== undefined ? facet.limit : 10,
          raw: true,
          subQuery: false
        };
      } else {
        throw new Error(`Unsupported facet type: ${type}`);
      }

      return { name: field, type, options };
    });

    return {
      hits: QueryBuilder.build(params),
      count: { where: QueryBuilder.getWhereQuery(params) },
      facets
    };
  }

  // Post-query helper: assemble the stable response envelope from executed rows.
  // facetResults: [{ name, type, rows }] (zip buildSearch().facets with their findAll rows).
  static assembleSearch ({ hits, total, facetResults }) {
    const response = { hits, total };
    const facets = {};
    const stats = {};

    (facetResults || []).forEach(({ name, type, rows }) => {
      if (type === 'stats') {
        const row = (rows && rows[0]) || {};
        stats[name] = {
          min: toNumber(row.min),
          max: toNumber(row.max),
          avg: toNumber(row.avg),
          count: toNumber(row.count)
        };
      } else {
        facets[name] = (rows || []).map((r) => ({
          value: r.value,
          count: toNumber(r.count)
        }));
      }
    });

    if (Object.keys(facets).length) {
      response.facets = facets;
    }
    if (Object.keys(stats).length) {
      response.stats = stats;
    }
    return response;
  }
}

export default QueryBuilder;
