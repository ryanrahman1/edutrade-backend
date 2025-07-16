const yahooFinance = require("yahoo-finance2").default;

const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "quote-cache.json");

const CACHE = new Map();

if (fs.existsSync(CACHE_PATH)) {
    try {
        const raw = fs.readFileSync(CACHE_PATH);
        const json = JSON.parse(raw);
        for (const [key, value] of Object.entries(json)) {
            CACHE.set(key, value);
        }
        console.log("Cache loaded:", CACHE.size,);
        console.log("Cache JSON Size:", raw.length, "bytes");
    } catch (error) {
        console.error("Error loading cache:", error.message);
    }
}

const TTL = 86400000;

const getWithCache = async (key, fetchFn) => {
    const now = Date.now();
    const cached = CACHE.get(key);
    
    if (cached && now - cached.ts < TTL) {
        return cached.data;
    }

    const data = await fetchFn();
    CACHE.set(key, { data, ts: now });
    saveCache();
    return data;
};

async function getQuote(symbol) {
  const sym = symbol.toUpperCase();

  return getWithCache(`quote:${sym}`, async () => {
    const fullQuote = await yahooFinance.quote(sym);

    // return only what we want (this is what gets cached)
    return {
      symbol: fullQuote.symbol,
      shortName: fullQuote.shortName,
      exchange: fullQuote.exchange,
      longName: fullQuote.longName,
      regularMarketPrice: fullQuote.regularMarketPrice,
      regularMarketChange: fullQuote.regularMarketChange,
      regularMarketChangePercent: fullQuote.regularMarketChangePercent,
      regularMarketPreviousClose: fullQuote.regularMarketPreviousClose,
      regularMarketOpen: fullQuote.regularMarketOpen,
      regularMarketDayHigh: fullQuote.regularMarketDayHigh,
      regularMarketDayLow: fullQuote.regularMarketDayLow,
      marketState: fullQuote.marketState,
      marketCap: fullQuote.marketCap,
      volume: fullQuote.regularMarketVolume,
      currency: fullQuote.currency,
    };
  });
}

async function getMultipleQuotes(symbols = []) {
    const syms = symbols.map(s => s.toUpperCase());
    return yahooFinance.quote(syms);
}

async function getHistoricalData(symbol, { interval = "5m", periodDays = 1 } = {}) {
    const sym = symbol.toUpperCase();
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - periodDays * 24 * 60 * 60 * 1000);

    console.log("Fetching chart for", sym, "from", period1, "to", period2, "interval:", interval);

    try {
        const res = await yahooFinance.chart(sym, {
            period1,
            interval,
        });

        const result = res.chart?.result?.[0];
        if (!result) throw new Error(res.chart?.error?.description || "No chart result");

        const timestamps = result.timestamp;
        const quotes = result.indicators?.quote?.[0];

        if (!timestamps || !quotes || !quotes.close) throw new Error("Invalid chart data");

        return timestamps.map((ts, i) => {
            const time = new Date(ts * 1000).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            });
            return {
                time,
                price: quotes.close[i],
            };
        });
    } catch (err) {
        console.warn(`⚠️ Failed with interval=${interval}: ${err.message}`);
        if (interval === "5m") {
            console.log("🔁 Falling back to interval=1d...");
            return getHistoricalData(sym, { interval: "1d", periodDays });
        } else {
            throw err;
        }
    }
}

function saveCache() {
    const obj = Object.fromEntries(CACHE);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(obj));
}

module.exports = {
    getQuote,
    getMultipleQuotes,
    getHistoricalData
};