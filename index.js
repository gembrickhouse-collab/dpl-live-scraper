const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    // Try standard BiblioCommons catalog URL routes
    const targetUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=title`;

    // Method 1: Fetch raw HTML & parse JSON payload
    try {
        const { data: html } = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 8000
        });

        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
        if (match && match[1]) {
            const parsed = JSON.parse(match[1]);
            const bibs = parsed?.props?.pageProps?.initialState?.entities?.bibs || {};
            const results = Object.values(bibs).slice(0, 5).map(item => `${item.title} [${item.format || 'Book'}]`);

            if (results.length > 0) {
                return res.json({ status: "success", mode: "api", query: title, results });
            }
        }
    } catch (e) {
        console.log("Axios strategy bypassed, launching Chromium...");
    }

    // Method 2: Headless Browser Fallback
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Wait up to 8s for item container cards to load
        await page.waitForSelector('.cp-search-result-item, [data-key="bib-title"], .title-content', { timeout: 8000 }).catch(() => {});

        const results = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('.cp-title, [data-key="bib-title"], .title-content, h2 a, h3 a'));
            const titles = nodes.map(n => n.innerText.trim()).filter(txt => txt.length > 2);
            return Array.from(new Set(titles)).slice(0, 5);
        });

        await browser.close();

        if (results.length > 0) {
            return res.json({ status: "success", mode: "puppeteer", query: title, results });
        }

        return res.json({ status: "partial", query: title, message: "Catalog loaded, but no titles extracted." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
