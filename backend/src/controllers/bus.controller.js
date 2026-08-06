import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import busProvider from '../providers/bus.provider.js';

export const searchBuses = asyncHandler(async (req, res) => {
  const { from, to, date, passengers } = req.query;
  const result = await busProvider.searchBuses({
    from,
    to,
    date,
    passengers: Number(passengers) || 1,
  });
  res.json(
    ApiResponse.ok(result.message, {
      buses: result.data || [],
      isLive: result.isLive,
      providerStatus: busProvider.providerStatus(),
      externalSources: [{ name: 'RedBus', url: 'https://www.redbus.in' }, { name: 'abhibus', url: 'https://www.abhibus.com' }],
    })
  );
});

export default { searchBuses };
