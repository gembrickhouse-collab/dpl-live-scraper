const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

app.post('/sms', async (req, res) => {
    const title = req.body.Body; 
    res.type('text/xml');

    if (!title || title.trim() === '') {
        return res.send(`
            <Response>
                <Message>Please text a book title to search the library catalog.</Message>
            </Response>
        `);
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://catalog.denverlibrary.org/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 1500));

        const searchUrl = `https://catalog.denverlibrary.org/Search/searchresults.aspx?type=Keyword&term=${encodeURIComponent(title.trim())}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pageData = await page.evaluate(() => {
            const rawText = document.body.innerText.replace(/\s+/g, ' ');
            
            // Split the page text into chunks right before every number (e.g., "1. ", "2. ")
            const chunks = rawText.split(/(?=\b\d+\.\s+)/);
            const matches = [];
            
            for (const chunk of chunks) {
                // Ensure this chunk is actually a numbered list item
                if (/^\d+\.\s+/.test(chunk)) {
                    // Grab the title between the number and the word "by"
                    const titleMatch = chunk.match(/^\d+\.\s+(.*?)(?=\s+by\s+)/i);
                    
                    if (titleMatch && titleMatch[1]) {
                        const bookTitle = titleMatch[1].trim();
                        
                        // Grab the exact phrase "Available Copies: X (of Y)" from the same chunk
                        const copiesMatch = chunk.match(/(Available Copies:\s*\d+\s*\(of\s*\d+\))/i);
                        const availability = copiesMatch ? copiesMatch[1] : "Availability unknown";
                        
                        // Combine them into a single line
                        matches.push(`${bookTitle} - ${availability}`);
                    }
                }
            }
            return Array.from(new Set(matches)).slice(0, 5);
        });

        await browser.close();

        let textReply = `No results found for "${title.trim()}".`;
        if (pageData.length > 0) {
            textReply = `Top 5 results for "${title.trim()}":\n\n` + pageData.map((book, i) => `${i + 1}. ${book}`).join('\n\n');
        }

        res.send(`
            <Response>
                <Message>${textReply}</Message>
            </Response>
        `);

    } catch (err) {
        if (browser) await browser.close();
        res.send(`
            <Response>
                <Message>Sorry, the catalog search failed. Please try again later.</Message>
            </Response>
        `);
    }
});

app.get('/', (req, res) => {
    res.send("DPL Scraper is live and waiting for Twilio webhooks!");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
