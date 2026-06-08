import { AGG_FUNCTIONS, DATE_INTERVALS, COERCIBLE_FNS } from './constants.js';
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
          objectQuery.push({ [sequelizeOp]: nestedValue });
        } else {
          objectQuery.push({ [nestedKey]: QueryBuilder.buildWhereClause(nestedKey, nestedValue) });
        }
      }

      return { [QueryBuilder.Op.and]: objectQuery };
    }

    return { [QueryBuilder.Op.eq]: value };
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
    const order = [];
    sort.forEach((item) => {
      Object.entries(item).forEach(([key, value]) => {
        order.push([key, value.toUpperCase()]);
      });
    });
    return order;
  }

  // from: 0;
  static getOffsetQuery (params, defaultOffset = 0) {
    const offset = parseInt(params.from, 10);
    return Number.isInteger(offset) && offset >= 0 ? offset : defaultOffset;
  }

  // size: 100;
  static getLimitQuery (params, defaultLimit = 100) {
    const limit = parseInt(params.size, 10);
    return Number.isInteger(limit) && limit >= 0 ? limit : defaultLimit;
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

  // metric spec: 'count' (shorthand -> COUNT(*)) | { fn, field }
  // Returns { entry: [expr, alias], expr } — expr is cached so HAVING can reuse it.
  static buildMetric (alias, spec) {
    const { fn, col, literal } = QueryBuilder;
    const normalized = typeof spec === 'string' ? { fn: spec } : (spec || {});
    const fnName = normalized.fn;
    const field = normalized.field;

    let expr;
    if (fnName === 'count') {
      expr = field ? fn('COUNT', col(field)) : fn('COUNT', literal('*'));
    } else if (fnName === 'countDistinct') {
      if (!field) {
        throw new Error(`Aggregate "${alias}": countDistinct requires a field`);
      }
      expr = fn('COUNT', fn('DISTINCT', col(field)));
    } else {
      const sqlFn = AGG_FUNCTIONS[fnName];
      if (!sqlFn) {
        throw new Error(`Unsupported aggregate function: ${fnName}`);
      }
      if (!field) {
        throw new Error(`Aggregate "${alias}": ${fnName} requires a field`);
      }
      expr = fn(sqlFn, col(field));
    }

    return { entry: [expr, alias], expr };
  }

  // groupBy entry: 'field' (plain column) | { field, interval } (date bucket)
  // Returns { attribute, group, name } — name is the output column / collision key.
  static buildDimension (dim) {
    const { fn, col } = QueryBuilder;
    if (typeof dim === 'string') {
      return { attribute: dim, group: dim, name: dim };
    }

    const { field, interval } = dim || {};
    if (!field) {
      throw new Error('groupBy dimension requires a field');
    }
    if (!DATE_INTERVALS.has(interval)) {
      throw new Error(`Unsupported date interval: ${interval}. Use one of: ${[...DATE_INTERVALS].join(', ')}`);
    }

    const expr = fn('DATE_TRUNC', interval, col(field));
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
      Object.entries(predicate).forEach(([op, value]) => {
        const sequelizeOp = QueryBuilder.getSequelizeOpByString(op);
        if (!sequelizeOp) {
          throw new Error(`Unsupported having operator: ${op}`);
        }
        clauses.push(where(expr, sequelizeOp, value));
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

    const dims = normalizeGroupBy(params.groupBy).map((d) => QueryBuilder.buildDimension(d));
    const dimNames = new Set(dims.map((d) => d.name));

    const exprByAlias = {};
    const metricEntries = Object.entries(params.metrics || {}).map(([alias, spec]) => {
      if (dimNames.has(alias)) {
        throw new Error(`Metric alias "${alias}" collides with a groupBy field`);
      }
      const { entry, expr } = QueryBuilder.buildMetric(alias, spec);
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
      subQuery: false,
      limit: QueryBuilder.getLimitQuery(params),
      offset: QueryBuilder.getOffsetQuery(params)
    };

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

    const facets = Object.entries(params.facets || {}).map(([field, rawFacet]) => {
      const facet = rawFacet || {};
      const type = facet.type || 'terms';
      const disjunctive = facet.disjunctive !== undefined ? facet.disjunctive : type === 'terms';
      const where = QueryBuilder.buildFacetWhere(field, { disjunctive }, params);

      let options;
      if (type === 'stats') {
        options = {
          attributes: [
            [fn('MIN', col(field)), 'min'],
            [fn('MAX', col(field)), 'max'],
            [fn('AVG', col(field)), 'avg'],
            [fn('COUNT', literal('*')), 'count']
          ],
          where,
          raw: true,
          subQuery: false
        };
      } else if (type === 'terms') {
        options = {
          attributes: [
            [col(field), 'value'],
            [fn('COUNT', literal('*')), 'count']
          ],
          where,
          group: [field],
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
