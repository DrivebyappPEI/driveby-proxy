let cachedListings = [];
let lastFetched = 0;
const CACHE_DURATION = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { lat, lng, minPrice, maxPrice } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const now = Date.now();
  if (cachedListings.length === 0 || now - lastFetched > CACHE_DURATION) {
    try { await refreshCache(); }
    catch (e) { console.error('Refresh failed:', e.message); }
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);

  const filtered = cachedListings.filter(item => {
    if (!item.lat || !item.lng) return false;
    if (Math.abs(item.lat - userLat) > 0.5) return false;
    if (Math.abs(item.lng - userLng) > 0.5) return false;
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

async function refreshCache() {
  const url = 'https://www.kijiji.ca/b-for-rent/canada/c30349001l0';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-CA,en;q=0.9',
    }
  });

  if (!response.ok) throw new Error(`Kijiji ${response.status}`);
  const html = await response.text();

  // Extract JSON data from Kijiji's page
  const match = html.match(/__NEXT_DATA__\s*=\s*({.+?})<\/script>/s) ||
                html.match(/window\.__data\s*=\s*({.+?});\s*<\/script>/s);

  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const listings = extractListingsFromNextData(data);
      if (listings.length > 0) {
        cachedListings = listings;
        lastFetched = Date.now();
        console.log(`Cached ${listings.length} listings from Kijiji`);
        return;
      }
    } catch(e) {
      console.error('Parse error:', e.message);
    }
  }

  // Fallback — regex scrape
  cachedListings = scrapeListingsFromHTML(html);
  lastFetched = Date.now();
  console.log(`Cached ${cachedListings.length} listings via regex`);
}

function extractListingsFromNextData(data) {
  try {
    const listings = data?.props?.pageProps?.listings ||
                     data?.props?.pageProps?.ads ||
                     [];
    return listings.map(l => ({
      id: String(l.id || l.adId || Math.random()),
      title: l.title || 'Rental',
      price: parseFloat(String(l.price?.amount || l.price || '0').replace(/[^0-9.]/g, '')) || 0,
      city: l.location?.name || l.city || 'Canada',
      lat: l.location?.latitude || l.latitude || null,
      lng: l.location?.longitude || l.longitude || null,
      bedrooms: extractBedrooms(l.title || ''),
      images: l.imageUrls || l.images || [],
      url: `https://www.kijiji.ca${l.seoUrl || ''}` || ''
    })).filter(l => l.lat && l.lng);
  } catch(e) { return []; }
}

function scrapeListingsFromHTML(html) {
  const results = [];
  const adRegex = /"adId":(\d+).*?"title":"([^"]+)".*?"price":\{"amount":(\d+).*?"latitude":([\d.-]+),"longitude":([\d.-]+)/gs;
  let match;
  while ((match = adRegex.exec(html)) !== null && results.length < 100) {
    results.push({
      id: match[1],
      title: match[2],
      price: parseFloat(match[3]) / 100,
      city: 'Canada',
      lat: parseFloat(match[4]),
      lng: parseFloat(match[5]),
      bedrooms: extractBedrooms(match[2]),
      images: [],
      url: ''
    });
  }
  return results;
}

function extractBedrooms(title) {
  const m = title.match(/(\d+)\s*(bed|bdr|br|bedroom)/i);
  if (m) return parseInt(m[1]);
  if (/bachelor|studio/i.test(title)) return 0;
  return 1;
}
