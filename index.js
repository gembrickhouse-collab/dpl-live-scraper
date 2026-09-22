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
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const searchUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait 3 seconds for React hydration
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pageData = await page.evaluate(() => {
            // Broadest possible selector for BiblioCommons titles
            const itemLinks = Array.from(document.querySelectorAll('.title-content, [data-key="bib-title"], .cp-title'));
            
            const results = itemLinks.map(link => link.innerText.trim())
                .filter(text => text.length > 2);

            // If nothing is found, grab the first 1000 characters of the page text so we can see what is blocking us
            const rawText = document.body.innerText.replace(/\s+/g, ' ').substring(0, 1000);

            return {
                results: Array.from(new Set(results)).slice(0, 5),
                debugText: rawText
            };
        });

        await browser.close();

        if (pageData.results.length > 0) {
            return res.json({ status: "success", query: title, results: pageData.results });
        }

        // X-Ray Output: See what the bot is actually looking at
        return res.json({ 
            status: "x-ray-debug", 
            query: title, 
            message: "No titles found. Here is what the page actually says:",
            pageContent: pageData.debugText 
        });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
