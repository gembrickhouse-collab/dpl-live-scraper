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

        // Step 2: Execute Search
        const searchUrl = `https://catalog.denverlibrary.org/Search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(title)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Step 3: Extract titles using Regex on the raw page text
        const pageData = await page.evaluate(() => {
            // Compress all text on the page into a single clean string
            const rawText = document.body.innerText.replace(/\s+/g, ' ');
            
            // Look for the pattern: [Number][Dot][Space][TITLE][Space]by[Space]
            const regex = /\b\d+\.\s+(.*?)(?=\s+by\s+)/gi;
            const matches = [];
            let match;
            
            // Loop through the text and pull out every title that fits the pattern
            while ((match = regex.exec(rawText)) !== null) {
                if (match[1] && match[1].length > 3) {
                    matches.push(match[1].trim());
                }
            }

            return {
                results: Array.from(new Set(matches)).slice(0, 5),
                debugText: rawText.substring(0, 500)
            };
        });

        await browser.close();

        if (pageData.results.length > 0) {
            return res.json({ status: "success", query: title, count: pageData.results.length, results: pageData.results });
        }

        return res.json({ status: "empty", query: title, message: "Could not parse titles from text.", text: pageData.debugText });

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
