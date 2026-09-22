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

        // Step 1: Visit the homepage to initialize the Polaris session cookie
        await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 2: Now that we have a valid session, execute the search URL
        const searchUrl = `https://catalog.denverlibrary.org/Search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(title)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait 3 seconds for the catalog database to render the results
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pageData = await page.evaluate(() => {
            // Target Polaris item links (they usually contain 'details' in the href)
            // or rely on specific table classes they use for short items
            let itemLinks = Array.from(document.querySelectorAll('a[href*="details"], a.title, .nsm-short-item a'));
            
            let results = itemLinks
                .map(link => link.innerText.trim())
                .filter(text => text.length > 5 && !text.toLowerCase().includes('details') && !text.toLowerCase().includes('place hold'));

            // Fallback: If specific attributes fail, grab any large anchor tag that looks like a book title
            if (results.length === 0) {
                const allLinks = Array.from(document.querySelectorAll('a'));
                results = allLinks
                    .map(a => a.innerText.trim())
                    .filter(text => text.length > 15 && !text.toLowerCase().includes('account') && !text.toLowerCase().includes('search'));
            }

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
            message: "Session established, but exact title links were hidden. X-Ray text:",
            pageContent: pageData.debugText 
        });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
