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

        // Step 1: Initialize session cookie
        await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 2: Search
        const searchUrl = `https://catalog.denverlibrary.org/Search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(title)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pageData = await page.evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a'));
            
            // List of words that appear in junk links, buttons, and authors
            const junkWords = [
                'author', 'adapter', 'available', 'click here', 'excerpt', 
                'search', 'account', 'log in', 'holds', 'fees', 'saved', 
                'sign in', 'help', 'details', 'place hold', 'my list', 'checkout'
            ];
            
            let titles = allLinks
                .map(a => a.innerText.replace(/\s+/g, ' ').trim())
                .filter(text => text.length > 5) // Ignore empty or tiny links
                .filter(text => !junkWords.some(junk => text.toLowerCase().includes(junk)));

            return {
                results: Array.from(new Set(titles)).slice(0, 5)
            };
        });

        await browser.close();

        if (pageData.results.length > 0) {
            return res.json({ status: "success", query: title, results: pageData.results });
        }

        return res.json({ status: "empty", query: title, message: "No clean titles found after filtering." });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
