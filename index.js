const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        
        // Realistic desktop user agent to bypass simple headless blocks
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const searchUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait 3 seconds for React hydration to fill search card elements
        await new Promise(resolve => setTimeout(resolve, 3000));

        const extracted = await page.evaluate(() => {
            // Find all anchor links referencing catalog item URLs
            const itemLinks = Array.from(document.querySelectorAll('a[href*="/item/show/"]'));
            
            const results = itemLinks.map(link => {
                const text = link.innerText.trim();
                return text;
            }).filter(text => text.length > 1 && !text.toLowerCase().includes('cover image'));

            // Deduplicate items
            return Array.from(new Set(results)).slice(0, 5);
        });

        await browser.close();

        if (extracted.length > 0) {
            return res.json({ status: "success", query: title, count: extracted.length, results: extracted });
        }

        return res.json({ status: "empty", query: title, message: "Page loaded, but no item links matched /item/show/ criteria." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
