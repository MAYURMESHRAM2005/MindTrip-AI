import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import currencyProvider from '../providers/currency.provider.js';

export const rates = asyncHandler(async (_req, res) => {
  const result = await currencyProvider.getRates('USD');
  res.json(ApiResponse.ok(result.message, { rates: result.data, isLive: result.isLive }));
});

export const convert = asyncHandler(async (req, res) => {
  const { amount, from, to } = req.query;
  const result = await currencyProvider.convert(Number(amount), String(from).toUpperCase(), String(to).toUpperCase());
  res.json(ApiResponse.ok('Conversion', { ...result }));
});

export default { rates, convert };
