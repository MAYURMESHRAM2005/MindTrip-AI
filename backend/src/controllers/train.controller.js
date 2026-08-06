import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import trainProvider from '../providers/train.provider.js';

export const searchTrains = asyncHandler(async (req, res) => {
  const { from, to, date, passengers, trainClass } = req.query;
  const result = await trainProvider.searchTrains({
    from,
    to,
    date,
    passengers: Number(passengers) || 1,
    trainClass: trainClass || '',
  });
  res.json(
    ApiResponse.ok(result.message, {
      trains: result.data || [],
      isLive: result.isLive,
      providerStatus: trainProvider.providerStatus(),
      externalSources: [{ name: 'IRCTC', url: 'https://www.irctc.co.in' }, { name: 'RailYatri', url: 'https://www.railyatri.in' }],
    })
  );
});

export default { searchTrains };
