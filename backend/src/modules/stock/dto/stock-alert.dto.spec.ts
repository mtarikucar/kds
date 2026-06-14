import { plainToInstance } from 'class-transformer';
import { StockAlertDto } from './stock-alert.dto';

/**
 * Contract spec for the outbound StockAlertDto (the @ApiResponse type of
 * GET /stock/alerts). No validators — it's a response shape — but the
 * controller documents this as the payload contract, so we pin that the
 * documented numeric/boolean fields survive a plain→instance round-trip and
 * the optional image stays optional.
 */
describe('StockAlertDto contract', () => {
  it('round-trips a fully-populated alert row', () => {
    const dto = plainToInstance(StockAlertDto, {
      id: 'p1',
      name: 'Tomatoes',
      currentStock: 3,
      categoryName: 'Produce',
      image: '/img/tomato.webp',
      price: 12.5,
      isAvailable: true,
    });
    expect(dto.id).toBe('p1');
    expect(dto.currentStock).toBe(3);
    expect(dto.price).toBe(12.5);
    expect(dto.isAvailable).toBe(true);
    expect(dto.image).toBe('/img/tomato.webp');
  });

  it('allows the image to be omitted (optional field)', () => {
    const dto = plainToInstance(StockAlertDto, {
      id: 'p2',
      name: 'Onions',
      currentStock: 0,
      categoryName: 'Produce',
      price: 8,
      isAvailable: false,
    });
    expect(dto.image).toBeUndefined();
    expect(dto.isAvailable).toBe(false);
    expect(dto.currentStock).toBe(0);
  });
});
