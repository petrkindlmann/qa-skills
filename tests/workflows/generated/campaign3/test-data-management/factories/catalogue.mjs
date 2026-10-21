// Static reference fixture: the Shop's catalogue as the contract states it.
// Prices are server owned; test 1 checks this fixture against GET /api/catalog
// so a price change on the server shows up as a fixture drift, not as a
// mysterious amount mismatch in every order test.

export const catalogue = Object.freeze({
  currency: 'EUR',
  products: Object.freeze([
    Object.freeze({ sku: 'TEA-50', unit_amount: 1200 }),
    Object.freeze({ sku: 'CUP-01', unit_amount: 1800 }),
  ]),
  quantity: Object.freeze({ min: 1, max: 10 }),
});

export function unitAmount(sku) {
  return catalogue.products.find(product => product.sku === sku)?.unit_amount;
}

// Reduce either the fixture or the server's catalogue to the fields the
// factories depend on, sorted, so the two can be compared with toEqual.
export function catalogueView(source) {
  return {
    currency: source.currency,
    products: [...source.products]
      .map(({ sku, unit_amount }) => ({ sku, unit_amount }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  };
}
