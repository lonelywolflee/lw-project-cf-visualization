import { compareByNameThenId } from './catalog-selectors';

describe('compareByNameThenId', () => {
  it('orders case-insensitively by code point and breaks name ties by id', () => {
    const entities = [
      { id: 'b', name: 'workers' },
      { id: 'a', name: 'Workers' },
      { id: 'c', name: 'CDN' },
    ];
    expect([...entities].sort(compareByNameThenId).map((entity) => entity.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
