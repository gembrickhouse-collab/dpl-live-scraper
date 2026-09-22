const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    const searchUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;

    // Method 1: Try direct embedded JSON state extraction via Axios
    try {
        const { data: html } = await axios.get(searchUrl, {
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
    } catch (axiosErr) {
        console.log("Axios API strategy bypassed, moving to Puppeteer...");
    }

    // Method 2: Dynamic Chromium DOM Query
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        const results = await page.evaluate(() => {
            // Broad search selector capturing heading text and links inside result cards
            const candidates = Array.from(document.querySelectorAll('h2, h3, [data-key="bib-title"], .title-content, .cp-title'));
            
            const titles = candidates
                .map(el => el.innerText.trim())
                .filter(txt => txt.length > 2 && !txt.toLowerCase().includes('search') && !txt.toLowerCase().includes('filter') && !txt.toLowerCase().includes('catalog'));

            // Deduplicate results
            return Array.from(new Set(titles)).slice(0, 5);
        });

        await browser.close();

        if (results.length > 0) {
            return res.json({ status: "success", mode: "puppeteer", query: title, results });
        }

        return res.json({ status: "partial", query: title, note: "Rendered catalog page successfully, but query returned no titles." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
