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

        // Navigate directly to the DPL catalog search results page
        const searchUrl = `https://catalog.denverlibrary.org/Search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(title)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait 3 seconds for the catalog database to populate the results
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pageData = await page.evaluate(() => {
            // Target standard title classes used in this catalog system
            const itemLinks = Array.from(document.querySelectorAll('.title, .title-content, h2, h3, a.record-title, .nsm-brief-primary-title-group'));
            
            const results = itemLinks
                .map(link => link.innerText.trim())
                .filter(text => text.length > 2 && !text.toLowerCase().includes('search'));

            // X-Ray Output just in case the classes don't match
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

        // X-Ray Debug output
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
