const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

// Allow Express to read the URL-encoded POST data Twilio sends
app.use(express.urlencoded({ extended: true }));

// Main SMS endpoint connected directly to Twilio
app.post('/sms', async (req, res) => {
    // Twilio sends the text message inside a property called 'Body'
    const title = req.body.Body; 
    
    // Set the response type to XML (TwiML) so Twilio understands it
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
            const regex = /\b\d+\.\s+(.*?)(?=\s+by\s+)/gi;
            const matches = [];
            let match;
            
            while ((match = regex.exec(rawText)) !== null) {
                if (match[1] && match[1].length > 3) {
                    matches.push(match[1].trim());
                }
            }
            return Array.from(new Set(matches)).slice(0, 5);
        });

        await browser.close();

        // Format the results cleanly for a text message
        let textReply = `No results found for "${title.trim()}".`;
        if (pageData.length > 0) {
            textReply = `Top 5 results for "${title.trim()}":\n\n` + pageData.map((book, i) => `${i + 1}. ${book}`).join('\n');
        }

        // Send the final XML response back to Twilio
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

// A simple status page to check in your browser
app.get('/', (req, res) => {
    res.send("DPL Scraper is live and waiting for Twilio webhooks!");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
