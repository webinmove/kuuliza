import { Op } from 'sequelize';
import chai from 'chai';
import QueryBuilderClass from '../src/index.js';
const { expect } = chai;
const QueryBuilder = QueryBuilderClass.init(Op);

describe('Build Query', () => {
  const date = Date.now();
  const query = QueryBuilder.build({
    filters: {
      alertLastStatus: '',
      assignations: { is: null },
      companyIdentifier: { not: null },
      alertShortId: 'ALERT_SHORT_ID',
      eventShortId: [
        'EVENT_SHORT_ID_1',
        'EVENT_SHORT_ID_2',
        'EVENT_SHORT_ID_3'
      ],
      indexedMeta: {
        eventType: 'EVENT_TYPE_VALUE',
        eventSeverity: ['LOW', 'HIGH']
      },
      updatedAt: {
        gte: date
      }
    },
    from: 0,
    sort: [{ updatedAt: 'ASC' }]
  });
  const emptyQuery = QueryBuilder.build({});

  it('1. Attributes should be undefined', () => {
    expect(query.attributes).to.be.undefined;
  });

  it('2. Nested range should equal', () => {
    expect(query.where?.updatedAt?.[Op.and]?.[0]?.[Op.gte]).to.deep.equal(date);
  });

  it('3. Nested json Simple column value should equal', () => {
    expect(query.where?.indexedMeta?.[Op.and]?.[0]?.eventType?.[Op.eq]).to.deep.equal('EVENT_TYPE_VALUE');
  });

  it('4. Nested json Array should equal', () => {
    expect(query.where?.indexedMeta?.[Op.and]?.[1]?.eventSeverity?.[Op.in]).to.deep.equal(['LOW', 'HIGH']);
  });

  it('5. Simple column value should equal', () => {
    expect(query.where?.alertShortId?.[Op.eq]).to.deep.equal('ALERT_SHORT_ID');
  });

  it('6. Array should equal', () => {
    expect(query.where?.eventShortId?.[Op.in]).to.deep.equal([
      'EVENT_SHORT_ID_1',
      'EVENT_SHORT_ID_2',
      'EVENT_SHORT_ID_3'
    ]);
  });

  it('7. Is null column value should return null', () => {
    expect(query.where?.assignations?.[Op.and]?.[0]?.[Op.is]).is.null;
  });

  it('8. Not null column value should equal', () => {
    expect(query.where?.companyIdentifier?.[Op.and]?.[0]?.[Op.not]).is.null;
  });

  it('9. Order should equal', () => {
    expect(query.order).to.deep.equal([['updatedAt', 'ASC']]);
  });

  it('10. Return minimal query', () => {
    expect(emptyQuery).to.deep.equal({
      attributes: undefined,
      where: {},
      order: null,
      limit: 100,
      offset: 0
    });
  });
});
