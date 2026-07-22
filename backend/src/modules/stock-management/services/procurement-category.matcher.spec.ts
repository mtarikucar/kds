import { matchCategory } from './procurement-category.matcher';

describe('matchCategory', () => {
  it('matches meat by item name', () => {
    expect(matchCategory({ itemName: 'Dana Kıyma' })).toBe('MEAT');
    expect(matchCategory({ itemName: 'tavuk but' })).toBe('MEAT');
    expect(matchCategory({ itemName: 'Somon fileto' })).toBe('MEAT');
  });
  it('prefers the category name over the item name', () => {
    expect(matchCategory({ categoryName: 'Temizlik', itemName: 'Bez' })).toBe('CLEANING');
  });
  it('matches produce, dry goods, dairy, beverage, packaging', () => {
    expect(matchCategory({ itemName: 'Domates' })).toBe('PRODUCE');
    expect(matchCategory({ itemName: 'Pirinç' })).toBe('DRY_GOODS');
    expect(matchCategory({ itemName: 'Beyaz peynir' })).toBe('DAIRY');
    expect(matchCategory({ itemName: 'Kola 1L' })).toBe('BEVERAGE');
    expect(matchCategory({ itemName: 'Karton kutu' })).toBe('PACKAGING');
  });
  it('returns null when nothing matches', () => {
    expect(matchCategory({ itemName: 'Zzzxq' })).toBeNull();
  });
  it('is case/diacritic tolerant', () => {
    expect(matchCategory({ itemName: 'KIYMA' })).toBe('MEAT');
  });
  it('resolves cross-category substring collisions by longest keyword', () => {
    expect(matchCategory({ itemName: 'Tereyağı' })).toBe('DAIRY');
    expect(matchCategory({ itemName: 'Meyve suyu' })).toBe('BEVERAGE');
    expect(matchCategory({ itemName: 'Sabun' })).toBe('CLEANING');
    expect(matchCategory({ itemName: 'Deterjan' })).toBe('CLEANING');
    expect(matchCategory({ itemName: 'Tuvalet kağıdı' })).toBe('CLEANING');
    expect(matchCategory({ itemName: 'Plastik pipet' })).toBe('PACKAGING');
    expect(matchCategory({ itemName: 'Karton kutu' })).toBe('PACKAGING');
  });
});
