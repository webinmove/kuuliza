import Sequelize, { Op } from 'sequelize';
import { expect } from 'chai';
import QueryBuilderClass from '../src/index.js';
const QueryBuilder = QueryBuilderClass.init(Sequelize);

describe('buildSearch', () => {
  const params = {
    filters: { brand: 'Nike', size: '42' },
    sort: [{ price: 'ASC' }],
    from: 0,
    size: 20,
    facets: {
      brand: { type: 'terms', disjunctive: true, limit: 10 },
      size: { type: 'terms', disjunctive: true },
      price: { type: 'stats' }
    }
  };

  const search = QueryBuilder.buildSearch(params);
  const byName = Object.fromEntries(search.facets.map((f) => [f.name, f]));

  it('returns hits options from build()', () => {
    expect(search.hits.limit).to.equal(20);
    expect(search.hits.where?.brand?.[Op.eq]).to.equal('Nike');
    expect(search.hits.order).to.deep.equal([['price', 'ASC']]);
  });

  it('returns a count spec carrying the full filters', () => {
    expect(search.count.where?.brand?.[Op.eq]).to.equal('Nike');
    expect(search.count.where?.size?.[Op.eq]).to.equal('42');
  });

  it('disjunctive facet drops only its OWN filter', () => {
    // brand facet: brand removed, size kept
    expect(byName.brand.options.where?.brand).to.equal(undefined);
    expect(byName.brand.options.where?.size?.[Op.eq]).to.equal('42');
    // size facet: size removed, brand kept
    expect(byName.size.options.where?.size).to.equal(undefined);
    expect(byName.size.options.where?.brand?.[Op.eq]).to.equal('Nike');
  });

  it('terms facet selects value + count, grouped and ordered by count', () => {
    const opts = byName.brand.options;
    expect(opts.attributes[0][0].col).to.equal('brand');
    expect(opts.attributes[0][1]).to.equal('value');
    expect(opts.attributes[1][0].fn).to.equal('COUNT');
    expect(opts.attributes[1][1]).to.equal('count');
    expect(opts.group).to.deep.equal(['brand']);
    expect(opts.order[0][0].fn).to.equal('COUNT');
    expect(opts.order[0][1]).to.equal('DESC');
    expect(opts.limit).to.equal(10);
    expect(opts.raw).to.equal(true);
  });

  it('terms facet defaults limit to 10', () => {
    expect(byName.size.options.limit).to.equal(10);
  });

  it('stats facet emits min/max/avg/count with no group', () => {
    const opts = byName.price.options;
    const aliases = opts.attributes.map((a) => a[1]);
    expect(aliases).to.deep.equal(['min', 'max', 'avg', 'count']);
    expect(opts.attributes[0][0].fn).to.equal('MIN');
    expect(opts.group).to.equal(undefined);
  });

  it('stats facet is conjunctive by default (keeps all filters)', () => {
    expect(byName.price.options.where?.brand?.[Op.eq]).to.equal('Nike');
    expect(byName.price.options.where?.size?.[Op.eq]).to.equal('42');
  });

  it('a non-disjunctive terms facet keeps its own filter', () => {
    const s = QueryBuilder.buildSearch({
      filters: { brand: 'Nike' },
      facets: { brand: { type: 'terms', disjunctive: false } }
    });
    expect(s.facets[0].options.where?.brand?.[Op.eq]).to.equal('Nike');
  });

  it('throws on an unsupported facet type', () => {
    expect(() => QueryBuilder.buildSearch({ facets: { brand: { type: 'histogram' } } }))
      .to.throw(/Unsupported facet type/);
  });

  it('no facets yields an empty facet list', () => {
    expect(QueryBuilder.buildSearch({}).facets).to.deep.equal([]);
  });

  it('a null facet config defaults to a terms facet', () => {
    const s = QueryBuilder.buildSearch({ facets: { tag: null } });
    expect(s.facets[0].name).to.equal('tag');
    expect(s.facets[0].type).to.equal('terms');
    expect(s.facets[0].options.limit).to.equal(10);
  });

  describe('fieldMap (attribute -> DB column)', () => {
    it('maps a terms facet field (col + group) but keeps the response name', () => {
      const s = QueryBuilder.buildSearch({
        facets: { brandId: { type: 'terms' } },
        fieldMap: { brandId: 'brand_id' }
      });
      const f = s.facets[0];
      expect(f.name).to.equal('brandId');
      expect(f.options.attributes[0][0].col).to.equal('brand_id');
      expect(f.options.attributes[0][1]).to.equal('value');
      expect(f.options.group).to.deep.equal(['brand_id']);
    });

    it('maps a stats facet field through fieldMap', () => {
      const s = QueryBuilder.buildSearch({
        facets: { unitPrice: { type: 'stats' } },
        fieldMap: { unitPrice: 'unit_price' }
      });
      const a = s.facets[0].options.attributes;
      expect(a[0][0].args[0].col).to.equal('unit_price'); // MIN
      expect(a[1][0].args[0].col).to.equal('unit_price'); // MAX
      expect(a[2][0].args[0].col).to.equal('unit_price'); // AVG
    });

    it('disjunctive drop still keys on the attribute name, not the mapped column', () => {
      const s = QueryBuilder.buildSearch({
        filters: { brandId: 'X' },
        facets: { brandId: { type: 'terms', disjunctive: true } },
        fieldMap: { brandId: 'brand_id' }
      });
      expect(s.facets[0].options.where?.brandId).to.equal(undefined);
    });

    it('leaves facet fields unchanged without a fieldMap entry', () => {
      const s = QueryBuilder.buildSearch({ facets: { brand: { type: 'terms' } } });
      expect(s.facets[0].options.attributes[0][0].col).to.equal('brand');
      expect(s.facets[0].options.group).to.deep.equal(['brand']);
    });
  });
});

describe('assembleSearch', () => {
  it('zips facet rows into the stable envelope with numeric coercion', () => {
    const response = QueryBuilder.assembleSearch({
      hits: [{ id: 1 }],
      total: 47,
      facetResults: [
        { name: 'brand', type: 'terms', rows: [{ value: 'Nike', count: '25' }, { value: 'Adidas', count: '15' }] },
        { name: 'price', type: 'stats', rows: [{ min: '80', max: '250', avg: '145.5', count: '47' }] }
      ]
    });

    expect(response.hits).to.deep.equal([{ id: 1 }]);
    expect(response.total).to.equal(47);
    expect(response.facets.brand).to.deep.equal([
      { value: 'Nike', count: 25 },
      { value: 'Adidas', count: 15 }
    ]);
    expect(response.stats.price).to.deep.equal({ min: 80, max: 250, avg: 145.5, count: 47 });
  });

  it('omits facets/stats keys when none were requested', () => {
    const response = QueryBuilder.assembleSearch({ hits: [], total: 0, facetResults: [] });
    expect(response).to.deep.equal({ hits: [], total: 0 });
  });

  it('leaves null and non-numeric stats values untouched', () => {
    const response = QueryBuilder.assembleSearch({
      hits: [],
      total: 0,
      facetResults: [
        { name: 'when', type: 'stats', rows: [{ min: null, max: '2026-01-01', avg: '5', count: '3' }] }
      ]
    });
    expect(response.stats.when.min).to.equal(null); // null passes through
    expect(response.stats.when.max).to.equal('2026-01-01'); // non-numeric passes through
    expect(response.stats.when.avg).to.equal(5);
    expect(response.stats.when.count).to.equal(3);
  });

  it('handles missing facetResults', () => {
    expect(QueryBuilder.assembleSearch({ hits: [], total: 0 })).to.deep.equal({ hits: [], total: 0 });
  });

  it('handles an empty stats facet and missing terms rows', () => {
    const response = QueryBuilder.assembleSearch({
      hits: [],
      total: 0,
      facetResults: [
        { name: 'price', type: 'stats', rows: [] },
        { name: 'brand', type: 'terms', rows: undefined }
      ]
    });
    expect(response.stats.price.min).to.equal(undefined);
    expect(response.facets.brand).to.deep.equal([]);
  });
});
