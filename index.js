const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    // Primary BiblioCommons search URL
    const searchUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;

    // Method 1: Direct HTML Axios Fetch
    try {
        const { data: html } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 10000
        });

        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
        if (match && match[1]) {
            const parsed = JSON.parse(match[1]);
            const bibs = parsed?.props?.pageProps?.initialState?.entities?.bibs || {};
            const results = Object.values(bibs).slice(0, 5).map(item => {
                const name = item.title || "Unknown Title";
                const format = item.format || "Book";
                return `${name} [${format}]`;
            });

            if (results.length > 0) {
                return res.json({ status: "success", mode: "api", query: title, results });
            }
        }
    } catch (axiosErr) {
        console.log("Axios fetch bypassed, trying Puppeteer...", axiosErr.message);
    }

    // Method 2: Puppeteer Browser Render
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Target the alternative catalog route if v2 redirects
        const targetUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 25000 });

        const results = await page.evaluate(() => {
            const titles = Array.from(document.querySelectorAll('a[href*="/item/show/"]')).map(a => a.innerText.trim()).filter(Boolean);
            return Array.from(new Set(titles)).slice(0, 5);
        });

        await browser.close();

        if (results.length > 0) {
            return res.json({ status: "success", mode: "puppeteer", query: title, results });
        }

        return res.json({ status: "partial", query: title, note: "Loaded page but found no matching items." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
