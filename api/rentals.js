// Cache listings in memory (~1hr on Vercel free tier)
let cachedListings = [];
let lastFetched = 0;
const CACHE_DURATION = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { lat, lng, minPrice, maxPrice, minBeds } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const now = Date.now();

  if (cachedListings.length === 0 || now - lastFetched > CACHE_DURATION) {
    try { await refreshCache(APIFY_TOKEN); }
    catch (e) { console.error('Cache refresh failed:', e.message); }
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusDeg = 0.5;

  const filtered = cachedListings.filter(item => {
    if (!item.map?.latitude || !item.map?.longitude) return false;
    if (Math.abs(item.map.latitude - userLat) > radiusDeg) return false;
    if (Math.abs(item.map.longitude - userLng) > radiusDeg) return false;
    const price = item.listPrice || 0;
    if (minPrice && price < parseFloat(minPrice)) return false;
    if (maxPrice && parseFloat(maxPrice) > 0 && price > parseFloat(maxPrice)) return false;
    return true;
  });

  res.status(200).json({ listings: filtered, count: filtered.length, total: cachedListings.length });
}

async function refreshCache(token) {
  if (!token) { cachedListings = getSampleListings(); lastFetched = Date.now(); return; }

  const response = await fetch(
    `https://api.apify.com/v2/acts/memo23~kijiji-scraper/run-sync-get-dataset-items?token=${token}&timeout=55&memory=256`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: 'https://www.kijiji.ca/b-for-rent/canada/c30349001l0' }],
        maxItems: 200,
        proxyConfiguration: { useApifyProxy: true }
      })
    }
  );

  if (!response.ok) throw new Error(`Apify ${response.status}`);

  const items = await response.json();
  cachedListings = items
    .filter(i => i.location?.latitude && i.location?.longitude)
    .map(i => ({
      mlsNumber: String(i.adId || Math.random()),
      listPrice: parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0,
      address: { streetNumber: '', streetName: i.title || 'Rental', city: i.location?.address || '', state: 'Canada' },
      map: { latitude: i.location.latitude, longitude: i.location.longitude },
      details: { numBedrooms: extractBedrooms(i.title || ''), propertyType: 'Apartment' },
      images: i.images || [],
      listingURL: i.url || ''
    }));

  lastFetched = Date.now();
  console.log(`Cached ${cachedListings.length} listings`);
}

function extractBedrooms(title) {
  const m = title.match(/(\d+)\s*(bed|bdr|br|bedroom)/i);
  if (m) return parseInt(m[1]);
  if (/bachelor|studio/i.test(title)) return 0;
  return 1;
}

function getSampleListings() {
  return [
    { mlsNumber: 's1', listPrice: 1800, address: { streetNumber: '', streetName: '2BR Apartment', city: 'Charlottetown', state: 'PE' }, map: { latitude: 46.2382, longitude: -63.1311 }, details: { numBedrooms: 2, propertyType: 'Apartment' }, images: [], listingURL: '' },
    { mlsNumber: 's2', listPrice: 2200, address: { streetNumber: '', streetName: '3BR House', city: 'Charlottetown', state: 'PE' }, map: { latitude: 46.2420, longitude: -63.1350 }, details: { numBedrooms: 3, propertyType: 'House' }, images: [], listingURL: '' }
  ];
}
