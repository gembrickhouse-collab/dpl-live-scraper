const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    // Correct BiblioCommons Search URL format
    const searchUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=title`;

    // Method 1: Direct JSON/HTML Fetch via Axios
    try {
        const { data: html } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
                const availability = item.availability?.status || "Check catalog";
                return `${name} (${format}) - ${availability}`;
            });

            if (results.length > 0) {
                return res.json({ status: "success", mode: "api", query: title, results });
            }
        }
    } catch (axiosErr) {
        console.log("Axios fetch bypassed, falling back to Puppeteer...", axiosErr.message);
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

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Extract title elements from updated search page
        const results = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('.cp-title, [data-key="bib-title"]')).slice(0, 5);
            return elements.map(el => el.innerText.trim());
        });

        await browser.close();

        if (results.length > 0) {
            return res.json({ status: "success", mode: "puppeteer", query: title, results });
        }

        return res.json({ status: "partial", query: title, note: "Loaded page but found no results for title." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
