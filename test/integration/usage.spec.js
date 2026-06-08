// Integration tests: execute the built options against a real PostgreSQL (testcontainers)
// to prove the behaviours unit tests can't — operators, arrays/hstore/jsonb columns,
// DATE_TRUNC buckets, paranoid exclusion, HAVING, ORDER BY alias, string-typed metrics ->
// coercion, and disjunctive facet counts — and that the results are numerically accurate.
//
// NOTE: aggregation/facet field names must equal the DB column names — kuuliza is
// schema-agnostic and passes them straight to sequelize.col(), which does NOT resolve a
// model's `field:` mapping. The fixture model below keeps attribute === column.
import { expect } from 'chai';
import Sequelize, { DataTypes } from 'sequelize';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import QueryBuilderClass from '../../src/index.js';

const indexBy = (rows, key) => rows.reduce((acc, row) => {
  acc[row[key]] = row;
  return acc;
}, {});

// Seed: 8 visible rows (7 active + 1 archived) + 1 soft-deleted. amounts sum to 760 (avg 95).
const SEED = [
  { brand: 'Nike', size: '42', color: 'Red', status: 'active', amount: 100, qty: 2, soldAt: '2026-01-10', promoCode: null, meta: { category: 'running', rating: 5 }, tags: ['sale', 'new'], props: { region: 'EU' } },
  { brand: 'Nike', size: '42', color: 'Blue', status: 'active', amount: 120, qty: 1, soldAt: '2026-01-20', promoCode: 'SUMMER', meta: { category: 'running', rating: 4 }, tags: ['new'], props: { region: 'EU' } },
  { brand: 'Nike', size: '41', color: 'Red', status: 'active', amount: 90, qty: 3, soldAt: '2026-02-05', promoCode: null, meta: { category: 'casual', rating: 3 }, tags: ['clearance'], props: { region: 'US' } },
  { brand: 'Adidas', size: '42', color: 'Red', status: 'active', amount: 80, qty: 5, soldAt: '2026-01-15', promoCode: null, meta: { category: 'running', rating: 4 }, tags: ['sale'], props: { region: 'US' } },
  { brand: 'Adidas', size: '43', color: 'Blue', status: 'active', amount: 110, qty: 2, soldAt: '2026-02-10', promoCode: 'SUMMER', meta: { category: 'casual', rating: 5 }, tags: ['new', 'sale'], props: { region: 'EU' } },
  { brand: 'Puma', size: '41', color: 'Red', status: 'active', amount: 70, qty: 4, soldAt: '2026-02-12', promoCode: null, meta: { category: 'running', rating: 2 }, tags: ['clearance'], props: { region: 'US' } },
  { brand: 'Puma', size: '43', color: 'Blue', status: 'active', amount: 60, qty: 1, soldAt: '2026-03-01', promoCode: null, meta: { category: 'casual', rating: 3 }, tags: ['sale'], props: { region: 'EU' } },
  { brand: 'Nike', size: '42', color: 'Red', status: 'archived', amount: 130, qty: 2, soldAt: '2026-03-03', promoCode: null, meta: { category: 'running', rating: 5 }, tags: ['new'], props: { region: 'US' } }
];

describe('integration: real PostgreSQL', () => {
  let container;
  let sequelize;
  let Product;
  let QueryBuilder;

  before(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    sequelize = new Sequelize(container.getConnectionUri(), {
      dialect: 'postgres',
      logging: false,
      timezone: '+00:00'
    });
    QueryBuilder = QueryBuilderClass.init(Sequelize);

    Product = sequelize.define('products', {
      brand: DataTypes.TEXT,
      size: DataTypes.TEXT,
      color: DataTypes.TEXT,
      status: DataTypes.TEXT,
      amount: DataTypes.DECIMAL(10, 2),
      qty: DataTypes.INTEGER,
      soldAt: DataTypes.DATE,
      promoCode: DataTypes.TEXT,
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      tags: DataTypes.ARRAY(DataTypes.TEXT),
      props: DataTypes.HSTORE
    }, { paranoid: true });

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS hstore');
    await sequelize.sync({ force: true });
    await Product.bulkCreate(SEED);

    // Soft-delete one active Adidas row to prove paranoid exclusion from every query path.
    const deleted = await Product.create({ brand: 'Adidas', size: '42', color: 'Red', status: 'active', amount: 50, qty: 1, soldAt: '2026-01-25', meta: { category: 'running', rating: 1 }, tags: ['sale'], props: { region: 'EU' } });
    await deleted.destroy();
  });

  after(async () => {
    if (sequelize) {
      await sequelize.close();
    }
    if (container) {
      await container.stop();
    }
  });

  const find = (params) => Product.findAll(QueryBuilder.build(params));

  // --- query (build) ---------------------------------------------------------

  describe('build()', () => {
    it('equality filter + sort + limit', async () => {
      const rows = await find({ filters: { brand: 'Nike' }, sort: [{ amount: 'DESC' }], size: 2 });
      expect(rows).to.have.length(2);
      expect(Number(rows[0].amount)).to.equal(130);
      expect(Number(rows[1].amount)).to.equal(120);
    });

    it('offset paging (from)', async () => {
      const rows = await find({ sort: [{ amount: 'ASC' }], from: 2, size: 2 });
      expect(rows.map((r) => Number(r.amount))).to.deep.equal([80, 90]);
    });

    it('ne operator', async () => {
      const rows = await find({ filters: { status: { ne: 'active' } } });
      expect(rows).to.have.length(1);
      expect(rows[0].status).to.equal('archived');
    });

    it('in operator (array)', async () => {
      const rows = await find({ filters: { size: ['41', '43'] } });
      expect(rows).to.have.length(4);
    });

    it('gte / between range operators', async () => {
      expect(await find({ filters: { amount: { gte: 110 } } })).to.have.length(3);
      expect(await find({ filters: { amount: { between: [80, 110] } } })).to.have.length(4);
    });

    it('iLike operator', async () => {
      const rows = await find({ filters: { color: { iLike: '%re%' } } });
      expect(rows).to.have.length(5); // Red
    });

    it('is null / not null', async () => {
      expect(await find({ filters: { promoCode: { not: null } } })).to.have.length(2);
      expect(await find({ filters: { promoCode: { is: null } } })).to.have.length(6);
    });

    it('nested JSONB filter', async () => {
      const rows = await find({ filters: { meta: { category: 'running' } } });
      expect(rows).to.have.length(5);
    });

    it('array overlap operator', async () => {
      expect(await find({ filters: { tags: { overlap: ['sale'] } } })).to.have.length(4);
      expect(await find({ filters: { tags: { overlap: ['clearance'] } } })).to.have.length(2);
    });

    it('reads array (tags) and hstore (props) columns back', async () => {
      const [row] = await find({ filters: { brand: 'Nike', color: 'Blue' } }); // unique row
      expect(row.tags).to.deep.equal(['new']);
      // hstore round-trips; sequelize may return it parsed (object) or as raw hstore text.
      const region = typeof row.props === 'string'
        ? /"region"=>"([^"]+)"/.exec(row.props)[1]
        : row.props.region;
      expect(region).to.equal('EU');
    });

    it('gt / lt / lte operators', async () => {
      expect(await find({ filters: { amount: { gt: 110 } } })).to.have.length(2);
      expect(await find({ filters: { amount: { lt: 80 } } })).to.have.length(2);
      expect(await find({ filters: { amount: { lte: 80 } } })).to.have.length(3);
    });

    it('notIn operator', async () => {
      expect(await find({ filters: { brand: { notIn: ['Nike'] } } })).to.have.length(4);
    });

    it('like / notLike / notILike operators', async () => {
      expect(await find({ filters: { brand: { like: 'Nike' } } })).to.have.length(4);
      expect(await find({ filters: { color: { notLike: 'Red' } } })).to.have.length(3);
      expect(await find({ filters: { color: { notILike: '%red%' } } })).to.have.length(3);
    });

    it('notBetween operator', async () => {
      expect(await find({ filters: { amount: { notBetween: [80, 110] } } })).to.have.length(4);
    });

    it('or operator', async () => {
      expect(await find({ filters: { amount: { or: [60, 130] } } })).to.have.length(2);
    });

    it('combined filters (AND)', async () => {
      const rows = await find({ filters: { brand: 'Nike', color: 'Red' } });
      expect(rows).to.have.length(3);
    });

    it('attributes projection', async () => {
      const rows = await find({ filters: { brand: 'Puma' }, attributes: ['brand', 'amount'] });
      expect(rows).to.have.length(2);
      expect(rows[0].size).to.equal(undefined);
    });

    it('empty result', async () => {
      expect(await find({ filters: { brand: 'Reebok' } })).to.have.length(0);
    });
  });

  // --- aggregations ----------------------------------------------------------

  describe('buildAggregation()', () => {
    const run = async (params) => QueryBuilder.coerceAggregation(await Product.findAll(QueryBuilder.buildAggregation(params)), params);

    it('global stats (no groupBy) over the visible rows', async () => {
      const [row] = await run({
        metrics: {
          count: 'count',
          total: { fn: 'sum', field: 'amount' },
          avgAmount: { fn: 'avg', field: 'amount' },
          qtySum: { fn: 'sum', field: 'qty' }
        }
      });
      expect(row.count).to.equal(8);
      expect(row.total).to.equal(760);
      expect(row.avgAmount).to.equal(95);
      expect(row.qtySum).to.equal(20);
    });

    it('count grouped by status excludes soft-deleted rows (paranoid)', async () => {
      const byStatus = indexBy(await run({ groupBy: 'status', metrics: { count: 'count' } }), 'status');
      expect(byStatus.active.count).to.equal(7); // 8 active rows, 1 soft-deleted
      expect(byStatus.archived.count).to.equal(1);
    });

    it('multi-field group-by (status, brand)', async () => {
      const rows = await run({ groupBy: ['status', 'brand'], metrics: { count: 'count' } });
      const byKey = rows.reduce((acc, r) => { acc[`${r.status}/${r.brand}`] = r.count; return acc; }, {});
      expect(byKey['active/Nike']).to.equal(3);
      expect(byKey['active/Adidas']).to.equal(2);
      expect(byKey['active/Puma']).to.equal(2);
      expect(byKey['archived/Nike']).to.equal(1);
    });

    it('sum / avg / min / max per brand', async () => {
      const byBrand = indexBy(await run({
        groupBy: 'brand',
        metrics: {
          count: 'count',
          total: { fn: 'sum', field: 'amount' },
          avgAmount: { fn: 'avg', field: 'amount' },
          minAmount: { fn: 'min', field: 'amount' },
          maxAmount: { fn: 'max', field: 'amount' }
        }
      }), 'brand');
      expect(byBrand.Nike).to.include({ count: 4, total: 440, avgAmount: 110 });
      expect(Number(byBrand.Nike.minAmount)).to.equal(90);
      expect(Number(byBrand.Nike.maxAmount)).to.equal(130);
      expect(byBrand.Adidas.total).to.equal(190);
      expect(byBrand.Puma.total).to.equal(130);
    });

    it('date-bucket (DATE_TRUNC month) with a metric', async () => {
      const rows = await run({
        groupBy: { field: 'soldAt', interval: 'month' },
        metrics: { count: 'count', total: { fn: 'sum', field: 'amount' } }
      });
      const byMonth = rows.reduce((acc, r) => { acc[r.soldAt.toISOString().slice(0, 7)] = r; return acc; }, {});
      expect(byMonth['2026-01']).to.include({ count: 3, total: 300 });
      expect(byMonth['2026-02']).to.include({ count: 3, total: 270 });
      expect(byMonth['2026-03']).to.include({ count: 2, total: 190 });
    });

    it('HAVING filters buckets and metric sort orders them', async () => {
      const rows = await run({
        groupBy: 'brand',
        metrics: { count: 'count' },
        having: { count: { gte: 3 } },
        sort: [{ count: 'DESC' }]
      });
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ brand: 'Nike', count: 4 });
    });

    it('countDistinct', async () => {
      const [row] = await run({ metrics: { brands: { fn: 'countDistinct', field: 'brand' }, colors: { fn: 'countDistinct', field: 'color' } } });
      expect(row.brands).to.equal(3);
      expect(row.colors).to.equal(2);
    });

    it('filters + aggregation', async () => {
      const byBrand = indexBy(await run({ filters: { status: 'active' }, groupBy: 'brand', metrics: { count: 'count' } }), 'brand');
      expect(byBrand.Nike.count).to.equal(3); // archived Nike excluded by filter
      expect(byBrand.Adidas.count).to.equal(2);
    });

    it('count over a specific field (COUNT(col)) ignores nulls', async () => {
      const [row] = await run({ metrics: { promos: { fn: 'count', field: 'promoCode' } } });
      expect(row.promos).to.equal(2); // only 2 rows have a promoCode
    });

    it('sort by a groupBy dimension', async () => {
      const rows = await run({ groupBy: 'brand', metrics: { count: 'count' }, sort: [{ brand: 'ASC' }] });
      expect(rows.map((r) => r.brand)).to.deep.equal(['Adidas', 'Nike', 'Puma']);
    });
  });

  // --- coerceNumbers ---------------------------------------------------------

  describe('coerceNumbers', () => {
    const params = {
      metrics: {
        count: 'count',
        total: { fn: 'sum', field: 'amount' },
        avgAmount: { fn: 'avg', field: 'amount' },
        minAmount: { fn: 'min', field: 'amount' },
        maxAmount: { fn: 'max', field: 'amount' }
      }
    };

    it('raw Postgres metrics are all strings', async () => {
      const [row] = await Product.findAll(QueryBuilder.buildAggregation(params));
      expect(row.count).to.be.a('string');
      expect(row.total).to.be.a('string');
      expect(row.avgAmount).to.be.a('string');
      expect(row.minAmount).to.be.a('string');
      expect(row.maxAmount).to.be.a('string');
    });

    it('coerceAggregation casts count/sum/avg to numbers, leaves min/max as strings', async () => {
      const raw = await Product.findAll(QueryBuilder.buildAggregation(params));
      const [row] = QueryBuilder.coerceAggregation(raw, params);
      expect(row.count).to.equal(8);
      expect(row.total).to.equal(760);
      expect(row.avgAmount).to.equal(95);
      expect(row.minAmount).to.equal('60.00'); // min is type-ambiguous -> not coerced
      expect(row.maxAmount).to.equal('130.00');
    });
  });

  // --- buildSearch (faceted) -------------------------------------------------

  describe('buildSearch()', () => {
    const runSearch = async (params) => {
      const spec = QueryBuilder.buildSearch(params);
      const [hits, total, ...facetRows] = await Promise.all([
        Product.findAll(spec.hits),
        Product.count(spec.count),
        ...spec.facets.map((f) => Product.findAll(f.options))
      ]);
      return QueryBuilder.assembleSearch({
        hits,
        total,
        facetResults: spec.facets.map((f, i) => ({ name: f.name, type: f.type, rows: facetRows[i] }))
      });
    };

    it('disjunctive facet ignores its own filter; others respect it', async () => {
      const response = await runSearch({
        filters: { brand: 'Nike' },
        facets: {
          brand: { type: 'terms', disjunctive: true },
          size: { type: 'terms', disjunctive: true },
          amount: { type: 'stats' }
        }
      });

      expect(response.total).to.equal(4);

      const brandCounts = indexBy(response.facets.brand, 'value');
      expect(brandCounts.Nike.count).to.equal(4);
      expect(brandCounts.Adidas.count).to.equal(2); // still shown though brand=Nike filtered
      expect(brandCounts.Puma.count).to.equal(2);

      const sizeCounts = indexBy(response.facets.size, 'value');
      expect(sizeCounts['42'].count).to.equal(3); // Nike-only (brand filter kept)
      expect(sizeCounts['41'].count).to.equal(1);
      expect(sizeCounts['43']).to.equal(undefined);

      expect(response.stats.amount).to.deep.include({ min: 90, max: 130, count: 4 });
    });

    it('conjunctive facet (disjunctive:false) keeps its own filter', async () => {
      const response = await runSearch({
        filters: { brand: 'Nike' },
        facets: { brand: { type: 'terms', disjunctive: false } }
      });
      expect(response.facets.brand).to.have.length(1);
      expect(response.facets.brand[0]).to.deep.equal({ value: 'Nike', count: 4 });
    });

    it('terms facet limit returns the top-N buckets by count', async () => {
      const response = await runSearch({ facets: { brand: { type: 'terms', limit: 1 } } });
      expect(response.facets.brand).to.have.length(1);
      expect(response.facets.brand[0]).to.deep.equal({ value: 'Nike', count: 4 });
    });

    it('global facet distribution (no filters)', async () => {
      const response = await runSearch({ facets: { color: { type: 'terms' }, amount: { type: 'stats' } } });
      const colors = indexBy(response.facets.color, 'value');
      expect(colors.Red.count).to.equal(5);
      expect(colors.Blue.count).to.equal(3);
      expect(response.stats.amount).to.deep.include({ min: 60, max: 130, count: 8 });
      expect(response.stats.amount.avg).to.equal(95);
    });

    it('facet with omitted type defaults to terms', async () => {
      const response = await runSearch({ facets: { color: {} } });
      expect(response.facets.color).to.be.an('array');
      expect(response.facets.color[0].count).to.be.a('number');
    });

    it('assembles the stable envelope with numeric facet counts', async () => {
      const response = await runSearch({ from: 0, size: 3, facets: { brand: { type: 'terms' } } });
      expect(response.hits).to.have.length(3);
      expect(response.total).to.equal(8);
      expect(response.facets.brand[0].count).to.be.a('number');
    });
  });
});
