let cachedListings = [];
let lastFetched = 0;
const CACHE_DURATION = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { lat, lng, minPrice, maxPrice } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const now = Date.now();

  if (cachedListings.length === 0 || now - lastFetched > CACHE_DURATION) {
    try { await refreshCache(APIFY_TOKEN); }
    catch (e) { console.error('Refresh failed:', e.message); }
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radius = 0.5;

  const filtered = cachedListings.filter(item => {
    if (!item.lat || !item.lng) return false;
    if (Math.abs(item.lat - userLat) > radius) return false;
    if (Math.abs(item.lng - userLng) > radius) return false;
    if (minPrice && item.price < parseFloat(minPrice)) return false;
    if (maxPrice && parseFloat(maxPrice) > 0 && item.price > parseFloat(maxPrice)) return false;
    return true;
  }).map(item => ({
    mlsNumber: item.id,
    listPrice: item.price,
    address: { streetNumber: '', streetName: item.title, city: item.city, state: 'Canada' },
    map: { latitude: item.lat, longitude: item.lng },
    details: { numBedrooms: item.bedrooms, propertyType: 'Apartment' },
    images: item.images,
    listingURL: item.url
  }));

  res.status(200).json({ listings: filtered, count: filtered.length, total: cachedListings.length });
}

async function refreshCache(token) {
  if (!token) { cachedListings = getSampleListings(); lastFetched = Date.now(); return; }

  // Use smartspidering/kijiji-ca-scraper — most reliable actor
  const response = await fetch(
    `https://api.apify.com/v2/acts/smartspidering~kijiji-ca-scraper/run-sync-get-dataset-items?token=${token}&timeout=55`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [
          { url: 'https://www.kijiji.ca/b-for-rent/canada/c30349001l0' },
          { url: 'https://www.kijiji.ca/b-apartments-condos/canada/c37l0' }
        ],
        maxItems: 200,
        proxyConfiguration: { useApifyProxy: true }
      })
    }
  );

  if (!response.ok) throw new Error(`Apify ${response.status}: ${await response.text()}`);

  const items = await response.json();
  console.log(`Raw items: ${items.length}`);

  cachedListings = items.map(i => {
    // Handle different field structures from different Kijiji scrapers
    const lat = i.latitude || i.location?.latitude || i.map?.latitude;
    const lng = i.longitude || i.location?.longitude || i.map?.longitude;
    if (!lat || !lng) return null;

    const priceStr = String(i.price || i.listPrice || '0');
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

    return {
      id: String(i.adId || i.id || i.listing_id || Math.random()),
      title: i.title || 'Rental listing',
      price,
      city: i.location_name || i.location?.address || i.city || 'Canada',
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      bedrooms: extractBedrooms(i.title || ''),
      images: i.image_urls || i.images || [],
      url: i.kijiji_url || i.url || i.detailPageUrl || ''
    };
  }).filter(i => i !== null);

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
    { id: 's1', title: '2BR Apartment - Charlottetown', price: 1800, city: 'Charlottetown', lat: 46.2382, lng: -63.1311, bedrooms: 2, images: [], url: '' },
    { id: 's2', title: '3BR House - Charlottetown', price: 2200, city: 'Charlottetown', lat: 46.2420, lng: -63.1350, bedrooms: 3, images: [], url: '' },
    { id: 's3', title: '1BR Condo - Charlottetown', price: 1400, city: 'Charlottetown', lat: 46.2360, lng: -63.1280, bedrooms: 1, images: [], url: '' }
  ];
}
