const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    // Method 1: Fast direct API query to BiblioCommons
    try {
        const apiUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        const apiResponse = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        const html = await apiResponse.text();

        // Extract JSON payload embedded inside the HTML page state
        const jsonMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
        if (jsonMatch && jsonMatch[1]) {
            const pageData = JSON.parse(jsonMatch[1]);
            const entities = pageData?.props?.pageProps?.initialState?.entities?.bibs || {};
            const results = Object.values(entities).slice(0, 5).map(bib => `${bib.title} [Format: ${bib.format}]`);
            
            if (results.length > 0) {
                return res.json({ source: "direct-api", query: title, results });
            }
        }
    } catch (apiErr) {
        console.log("API strategy bypass failed, falling back to Puppeteer...", apiErr.message);
    }

    // Method 2: Stealth Puppeteer Browser Fallback
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1280,800'
            ]
        });
        const page = await browser.newPage();

        // Extra stealth overrides
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

        const url = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Grab full page HTML or body text to debug raw output
        const pageText = await page.evaluate(() => document.body.innerText);
        await browser.close();

        return res.json({ 
            query: title, 
            snippet: pageText.substring(0, 500).replace(/\s+/g, ' ') 
        });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
