import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import translateService from '../services/translate.service.js';

export const translate = asyncHandler(async (req, res) => {
  const { text, target } = req.body;
  const result = await translateService.translateText(text, target);
  res.json(ApiResponse.ok('Translation', { ...result }));
});

export default { translate };
