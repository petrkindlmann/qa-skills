export function quote(subtotal, method='standard') {
  if (!Number.isSafeInteger(subtotal) || subtotal < 0 || !['standard','express'].includes(method)) throw new Error('Invalid quote input');
  const shipping = method === 'express' ? 1200 : subtotal >= 5000 ? 0 : 500;
  return {subtotal, shipping, total: subtotal + shipping};
}
