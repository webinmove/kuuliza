class QueryBuilder {
  static init (Op) {
    if (!Op) {
      throw new Error('Sequelize Operators are required');
    }
    QueryBuilder.Op = Op;

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
    if (!value) {
      // todo to rethink, is translated into IS NULL query, even for empty strings and arrays
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
}

export default QueryBuilder;
