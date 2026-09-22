const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    // Method 1: Query BiblioCommons API directly
    try {
        const apiUrl = `https://denver.bibliocommons.com/v2/bibs/search?query=${encodeURIComponent(title)}&searchType=smart`;
        const { data } = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            },
            timeout: 8000
        });

        if (data && data.entities && data.entities.bibs) {
            const results = Object.values(data.entities.bibs).slice(0, 5).map(bib => {
                const name = bib.title || "Unknown";
                const format = bib.format || "Book";
                return `${name} [${format}]`;
            });

            if (results.length > 0) {
                return res.json({ status: "success", mode: "direct-api", query: title, results });
            }
        }
    } catch (apiErr) {
        console.log("Direct API query failed/bypassed, switching to Puppeteer...");
    }

    // Method 2: Puppeteer DOM Scraping with explicit delay
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const searchUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Force a 4-second delay for client-side React rendering
        await new Promise(resolve => setTimeout(resolve, 4000));

        const data = await page.evaluate(() => {
            // Check for title anchors or elements containing class names with 'title'
            const links = Array.from(document.querySelectorAll('a'))
                .map(a => a.innerText.trim())
                .filter(txt => txt.length > 3 && !txt.toLowerCase().includes('search') && !txt.toLowerCase().includes('log in') && !txt.toLowerCase().includes('menu'));

            return Array.from(new Set(links)).slice(0, 5);
        });

        await browser.close();

        if (data.length > 0) {
            return res.json({ status: "success", mode: "puppeteer", query: title, results: data });
        }

        return res.json({ status: "partial", query: title, note: "Loaded catalog page but extracted 0 title links after render delay." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
