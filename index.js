const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    // Method 1: Direct JSON/HTML Fetch via Axios (Fast & Lightweight)
    try {
        const url = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        // Extract JSON embedded in NEXT_DATA
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
        if (match && match[1]) {
            const parsed = JSON.parse(match[1]);
            const bibs = parsed?.props?.pageProps?.initialState?.entities?.bibs || {};
            const results = Object.values(bibs).slice(0, 5).map(item => {
                const name = item.title || "Unknown Title";
                const format = item.format || "Item";
                return `${name} [Format: ${format}]`;
            });

            if (results.length > 0) {
                return res.json({ status: "success", mode: "api", query: title, results });
            }
        }
    } catch (axiosErr) {
        console.log("Axios fetch failed/bypassed, falling back to Puppeteer...", axiosErr.message);
    }

    // Method 2: Puppeteer Fallback
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        const url = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
        
        await browser.close();
        return res.json({ status: "success", mode: "puppeteer-fallback", query: title, snippet: bodyText });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
