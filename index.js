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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const url = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for results container or list item
        await page.waitForSelector('.cp-search-result-item, .cp-batch-actions-list-item, [data-key="bib-title"]', { timeout: 20000 });

        const results = await page.evaluate(() => {
            // Target search result cards flexibly
            const items = Array.from(document.querySelectorAll('.cp-search-result-item, .cp-batch-actions-list-item')).slice(0, 3);
            
            if (items.length === 0) {
                // Fallback extraction if container classes changed
                const titles = Array.from(document.querySelectorAll('[data-key="bib-title"]')).slice(0, 3);
                return titles.map(t => t.innerText.trim());
            }

            return items.map(item => {
                const titleEl = item.querySelector('.cp-title, [data-key="bib-title"]');
                const availEl = item.querySelector('.cp-availability-status, .cp-availability');
                
                const t = titleEl ? titleEl.innerText.trim() : "Unknown Title";
                const a = availEl ? availEl.innerText.trim() : "Status Unknown";
                return `${t} [${a}]`;
            });
        });

        await browser.close();
        return res.json({ query: title, results });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
