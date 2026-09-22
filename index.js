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

        // Step 1: Go to the Denver Public Library Catalog homepage
        await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Step 2: Find the search box dynamically, type the title, and hit Enter
        const searchInput = await page.$('input[name="search"], input[name="q"], input[name="term"], input[type="search"], input[title*="Search"], input[title*="search"]');
        
        if (!searchInput) {
            const rawHtml = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').substring(0, 500));
            await browser.close();
            return res.json({ status: "error", message: "Could not find the search box on the DPL homepage.", debug: rawHtml });
        }

        await searchInput.type(title);
        await searchInput.press('Enter');

        // Wait for the search results page to load
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

        // Step 3: Scrape the titles from the search results
        const pageData = await page.evaluate(() => {
            // Target common title formats used in classic catalogs
            const itemLinks = Array.from(document.querySelectorAll('.title, .title-content, h2, h3, a.record-title'));
            
            const results = itemLinks
                .map(link => link.innerText.trim())
                .filter(text => text.length > 2 && !text.toLowerCase().includes('search'));

            // X-Ray Output just in case
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

        // If no classes match, return the X-Ray debug text
        return res.json({ 
            status: "x-ray-debug", 
            query: title, 
            message: "Search executed, but no specific titles found. Here is the page text:",
            pageContent: pageData.debugText 
        });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
