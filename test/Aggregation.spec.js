import Sequelize, { Op } from 'sequelize';
import { expect } from 'chai';
import QueryBuilderClass from '../src/index.js';
const QueryBuilder = QueryBuilderClass.init(Sequelize);

describe('init', () => {
  afterEach(() => {
    // Restore the namespace init so other specs keep the aggregation helpers.
    QueryBuilderClass.init(Sequelize);
  });

  it('namespace init exposes the aggregation helpers', () => {
    QueryBuilderClass.init(Sequelize);
    expect(QueryBuilderClass.fn).to.be.a('function');
    expect(QueryBuilderClass.col).to.be.a('function');
    expect(QueryBuilderClass.literal).to.be.a('function');
    expect(QueryBuilderClass.where).to.be.a('function');
  });

  it('legacy init(Op) still builds but cannot aggregate', () => {
    QueryBuilderClass.init(Op);
    expect(QueryBuilderClass.fn).to.equal(undefined);
    // build() keeps working under legacy init
    expect(QueryBuilderClass.build({}).where).to.deep.equal({});
    expect(() => QueryBuilderClass.buildAggregation({ groupBy: 'status', metrics: { count: 'count' } }))
      .to.throw(/init\(Sequelize\)/);
  });

  it('legacy init(Op, helpers) restores aggregation support', () => {
    QueryBuilderClass.init(Op, Sequelize);
    expect(QueryBuilderClass.fn).to.be.a('function');
  });
});

describe('buildAggregation', () => {
  it('count grouped by status', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' }
    });

    expect(result.group).to.deep.equal(['status']);
    expect(result.raw).to.equal(true);
    expect(result.subQuery).to.equal(false);
    expect(result.attributes[0]).to.equal('status');

    const [countExpr, alias] = result.attributes[1];
    expect(alias).to.equal('count');
    expect(countExpr.fn).to.equal('COUNT');
    expect(countExpr.args[0].val).to.equal('*'); // COUNT(*)
  });

  it('multiple metrics keep their alias as the output key', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: {
        count: 'count',
        avgAmount: { fn: 'avg', field: 'amount' },
        maxAmount: { fn: 'max', field: 'amount' }
      }
    });

    const aliases = result.attributes.slice(1).map((a) => a[1]);
    expect(aliases).to.deep.equal(['count', 'avgAmount', 'maxAmount']);

    expect(result.attributes[2][0].fn).to.equal('AVG');
    expect(result.attributes[2][0].args[0].col).to.equal('amount');
    expect(result.attributes[3][0].fn).to.equal('MAX');
  });

  it('multi-field group-by', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: ['status', 'region'],
      metrics: { count: 'count' }
    });
    expect(result.group).to.deep.equal(['status', 'region']);
    expect(result.attributes[0]).to.equal('status');
    expect(result.attributes[1]).to.equal('region');
  });

  it('date-bucket dimension uses DATE_TRUNC aliased to the field', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: { field: 'createdAt', interval: 'month' },
      metrics: { count: 'count' }
    });

    const [bucketExpr, bucketAlias] = result.attributes[0];
    expect(bucketAlias).to.equal('createdAt');
    expect(bucketExpr.fn).to.equal('DATE_TRUNC');
    expect(bucketExpr.args[0]).to.equal('month');
    expect(bucketExpr.args[1].col).to.equal('createdAt');
    expect(result.group[0].fn).to.equal('DATE_TRUNC');
  });

  it('mixed date-bucket + plain dimensions', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: [{ field: 'createdAt', interval: 'day' }, 'status'],
      metrics: { count: 'count' }
    });
    expect(result.attributes[0][1]).to.equal('createdAt');
    expect(result.attributes[1]).to.equal('status');
    expect(result.group[0].fn).to.equal('DATE_TRUNC');
    expect(result.group[1]).to.equal('status');
  });

  it('reuses filters for the where clause', () => {
    const result = QueryBuilder.buildAggregation({
      filters: { archived: false },
      groupBy: 'status',
      metrics: { count: 'count' }
    });
    expect(result.where?.archived?.[Op.eq]).to.equal(false);
  });

  it('global stats (no groupBy) omit group and return a single-row shape', () => {
    const result = QueryBuilder.buildAggregation({
      metrics: { total: 'count', revenue: { fn: 'sum', field: 'amount' } }
    });
    expect(result.group).to.equal(undefined);
    expect(result.attributes[0][1]).to.equal('total');
    expect(result.attributes[1][0].fn).to.equal('SUM');
  });

  it('countDistinct nests DISTINCT inside COUNT', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { uniqueUsers: { fn: 'countDistinct', field: 'userId' } }
    });
    const expr = result.attributes[1][0];
    expect(expr.fn).to.equal('COUNT');
    expect(expr.args[0].fn).to.equal('DISTINCT');
    expect(expr.args[0].args[0].col).to.equal('userId');
  });

  it('HAVING builds a sequelize.where over the metric expression', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' },
      having: { count: { gte: 10 } }
    });
    expect(result.having).to.not.equal(undefined);
    expect(result.having.comparator).to.equal(Op.gte);
    expect(result.having.logic).to.equal(10);
    expect(result.having.attribute.fn).to.equal('COUNT');
  });

  it('HAVING with multiple predicates uses Op.and', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count', avgAmount: { fn: 'avg', field: 'amount' } },
      having: { count: { gte: 10 }, avgAmount: { lt: 1000 } }
    });
    expect(result.having[Op.and]).to.be.an('array').with.length(2);
  });

  it('metric ordering reuses getOrderQuery (orders by the alias)', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' },
      sort: [{ count: 'DESC' }]
    });
    expect(result.order).to.deep.equal([['count', 'DESC']]);
  });

  it('throws on an unsupported aggregate function', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { x: { fn: 'stddev', field: 'amount' } }
    })).to.throw(/Unsupported aggregate function/);
  });

  it('throws when sum/avg/min/max are missing a field', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { x: { fn: 'sum' } }
    })).to.throw(/requires a field/);
  });

  it('throws on an invalid date interval', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: { field: 'createdAt', interval: 'fortnight' },
      metrics: { count: 'count' }
    })).to.throw(/Unsupported date interval/);
  });

  it('throws when a metric alias collides with a groupBy field', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { status: { fn: 'count' } }
    })).to.throw(/collides with a groupBy field/);
  });

  it('throws when having references an unknown metric', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' },
      having: { ghost: { gte: 1 } }
    })).to.throw(/unknown metric/);
  });

  it('throws on an unsupported having operator', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' },
      having: { count: { weird: 1 } }
    })).to.throw(/Unsupported having operator/);
  });

  it('throws when sorting by something that is neither dimension nor metric', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' },
      sort: [{ ghost: 'DESC' }]
    })).to.throw(/Cannot sort by/);
  });

  it('throws when paging without a groupBy', () => {
    expect(() => QueryBuilder.buildAggregation({
      metrics: { count: 'count' },
      size: 10
    })).to.throw(/require groupBy/);
  });

  it('throws when countDistinct is missing a field', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { unique: { fn: 'countDistinct' } }
    })).to.throw(/countDistinct requires a field/);
  });

  it('throws when a date-bucket dimension is missing a field', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: { interval: 'month' },
      metrics: { count: 'count' }
    })).to.throw(/groupBy dimension requires a field/);
  });

  it('an empty having produces no having clause', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { count: 'count' },
      having: {}
    });
    expect(result.having).to.equal(undefined);
  });

  it('count with an explicit field uses COUNT(col)', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { rows: { fn: 'count', field: 'id' } }
    });
    const expr = result.attributes[1][0];
    expect(expr.fn).to.equal('COUNT');
    expect(expr.args[0].col).to.equal('id');
  });

  it('groupBy with no metrics selects the dimensions only', () => {
    const result = QueryBuilder.buildAggregation({ groupBy: 'status' });
    expect(result.attributes).to.deep.equal(['status']);
    expect(result.group).to.deep.equal(['status']);
  });

  it('throws on a null metric spec', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { broken: null }
    })).to.throw(/Unsupported aggregate function/);
  });

  it('throws on a null groupBy dimension', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: [null],
      metrics: { count: 'count' }
    })).to.throw(/groupBy dimension requires a field/);
  });
});

describe('buildAggregation hardening', () => {
  it('throws on duplicate groupBy dimension names (silent overwrite under raw)', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: [{ field: 'createdAt', interval: 'month' }, 'createdAt'],
      metrics: { c: 'count' }
    })).to.throw(/duplicate|collide/i);
    expect(() => QueryBuilder.buildAggregation({
      groupBy: ['status', 'status'],
      metrics: { c: 'count' }
    })).to.throw(/duplicate|collide/i);
  });

  it('rejects a prototype-chain key as an aggregate function', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { x: { fn: 'constructor', field: 'a' } }
    })).to.throw(/Unsupported aggregate function/);
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { x: { fn: 'toString', field: 'a' } }
    })).to.throw(/Unsupported aggregate function/);
  });

  it('throws on a non-object having predicate', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { count: 'count' }, having: { count: 5 }
    })).to.throw(/having predicate/);
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { count: 'count' }, having: { count: null }
    })).to.throw(/having predicate/);
  });

  it('rejects a non-comparison having operator', () => {
    expect(() => QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { count: 'count' }, having: { count: { is: null } }
    })).to.throw(/Unsupported having operator/);
  });
});

describe('buildAggregation date-bucket timezone', () => {
  it('defaults DATE_TRUNC to UTC', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: { field: 'createdAt', interval: 'month' }, metrics: { count: 'count' }
    });
    const expr = result.attributes[0][0];
    expect(expr.fn).to.equal('DATE_TRUNC');
    expect(expr.args[2]).to.equal('UTC');
  });

  it('honours an explicit timezone override', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: { field: 'createdAt', interval: 'day', timezone: 'Europe/Paris' }, metrics: { count: 'count' }
    });
    expect(result.attributes[0][0].args[2]).to.equal('Europe/Paris');
  });
});

describe('buildAggregation fieldMap value validation', () => {
  it('ignores a non-string fieldMap value and falls back to the attribute', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { x: { fn: 'sum', field: 'amt' } }, fieldMap: { amt: 123 }
    });
    expect(result.attributes[1][0].args[0].col).to.equal('amt');
  });

  it('ignores an empty-string fieldMap value', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status', metrics: { x: { fn: 'sum', field: 'amt' } }, fieldMap: { amt: '' }
    });
    expect(result.attributes[1][0].args[0].col).to.equal('amt');
  });
});

describe('buildAggregation paging', () => {
  it('omits limit/offset when neither size nor from is given (returns all groups)', () => {
    const result = QueryBuilder.buildAggregation({ groupBy: 'status', metrics: { count: 'count' } });
    expect(result.limit).to.equal(undefined);
    expect(result.offset).to.equal(undefined);
  });

  it('applies limit and offset when size and from are given', () => {
    const result = QueryBuilder.buildAggregation({ groupBy: 'status', metrics: { count: 'count' }, from: 5, size: 10 });
    expect(result.limit).to.equal(10);
    expect(result.offset).to.equal(5);
  });

  it('applies only limit when size is given without from', () => {
    const result = QueryBuilder.buildAggregation({ groupBy: 'status', metrics: { count: 'count' }, size: 3 });
    expect(result.limit).to.equal(3);
    expect(result.offset).to.equal(undefined);
  });
});

describe('buildAggregation fieldMap (attribute -> DB column)', () => {
  it('maps a sum metric field through fieldMap', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { revenue: { fn: 'sum', field: 'titleId' } },
      fieldMap: { titleId: 'title_id' }
    });
    expect(result.attributes[1][0].args[0].col).to.equal('title_id');
  });

  it('maps a countDistinct field through fieldMap', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { u: { fn: 'countDistinct', field: 'requestShortId' } },
      fieldMap: { requestShortId: 'request_short_id' }
    });
    expect(result.attributes[1][0].args[0].args[0].col).to.equal('request_short_id');
  });

  it('maps COUNT(field) through fieldMap', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { rows: { fn: 'count', field: 'titleId' } },
      fieldMap: { titleId: 'title_id' }
    });
    expect(result.attributes[1][0].args[0].col).to.equal('title_id');
  });

  it('maps a date-bucket field but keeps the attribute alias as the output key', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: { field: 'createdAt', interval: 'month' },
      metrics: { count: 'count' },
      fieldMap: { createdAt: 'created_at' }
    });
    const [bucketExpr, bucketAlias] = result.attributes[0];
    expect(bucketAlias).to.equal('createdAt');
    expect(bucketExpr.args[1].col).to.equal('created_at');
  });

  it('leaves a field unchanged when fieldMap has no entry for it', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: 'status',
      metrics: { revenue: { fn: 'sum', field: 'amount' } },
      fieldMap: { other: 'x' }
    });
    expect(result.attributes[1][0].args[0].col).to.equal('amount');
  });

  it('does not map plain groupBy dimensions (Sequelize maps the bare attribute)', () => {
    const result = QueryBuilder.buildAggregation({
      groupBy: ['requestShortId'],
      metrics: { count: 'count' },
      fieldMap: { requestShortId: 'request_short_id' }
    });
    expect(result.attributes[0]).to.equal('requestShortId');
    expect(result.group).to.deep.equal(['requestShortId']);
  });
});

describe('coerceAggregation', () => {
  const params = {
    groupBy: 'status',
    metrics: {
      count: 'count',
      revenue: { fn: 'sum', field: 'amount' },
      avgAmount: { fn: 'avg', field: 'amount' },
      maxAmount: { fn: 'max', field: 'amount' }
    }
  };

  it('coerces count/sum/avg to numbers but leaves min/max and dimensions', () => {
    const rows = [{ status: 'active', count: '42', revenue: '1500.50', avgAmount: '125.25', maxAmount: '999.99' }];
    const [row] = QueryBuilder.coerceAggregation(rows, params);
    expect(row.count).to.equal(42);
    expect(row.revenue).to.equal(1500.5);
    expect(row.avgAmount).to.equal(125.25);
    expect(row.maxAmount).to.equal('999.99'); // max not coerced
    expect(row.status).to.equal('active'); // dimension untouched
  });

  it('preserves null metric values', () => {
    const rows = [{ status: 'active', count: '0', revenue: null }];
    const [row] = QueryBuilder.coerceAggregation(rows, params);
    expect(row.count).to.equal(0);
    expect(row.revenue).to.equal(null);
  });

  it('is a no-op when there are no coercible metrics', () => {
    const rows = [{ status: 'active', maxAmount: '5' }];
    const result = QueryBuilder.coerceAggregation(rows, { metrics: { maxAmount: { fn: 'max', field: 'amount' } } });
    expect(result).to.equal(rows);
  });

  it('returns rows unchanged when params have no metrics', () => {
    const rows = [{ status: 'active' }];
    expect(QueryBuilder.coerceAggregation(rows, {})).to.equal(rows);
    expect(QueryBuilder.coerceAggregation(rows)).to.equal(rows);
  });
});
