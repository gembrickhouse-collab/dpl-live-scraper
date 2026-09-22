const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/search', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.json({ error: "No title provided" });

    try {
        // Direct BiblioCommons API Endpoint
        const apiUrl = `https://denver.bibliocommons.com/v2/bibs/search?query=${encodeURIComponent(title)}&searchType=smart`;
        
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://denver.bibliocommons.com/'
            },
            timeout: 10000
        });

        const bibs = response.data?.entities?.bibs || {};
        const results = Object.values(bibs).slice(0, 5).map(item => {
            const name = item.title || "Unknown Title";
            const format = item.format || "Book";
            const author = item.authors ? item.authors.join(', ') : 'Unknown Author';
            return `${name} by ${author} [Format: ${format}]`;
        });

        if (results.length > 0) {
            return res.json({ status: "success", query: title, count: results.length, results });
        } else {
            return res.json({ status: "empty", query: title, message: "No items found for query." });
        }

    } catch (err) {
        // Fallback: If direct JSON API blocks, grab raw embedded NEXT_DATA page state
        try {
            const pageUrl = `https://denver.bibliocommons.com/v2/search?query=${encodeURIComponent(title)}&searchType=smart`;
            const { data: html } = await axios.get(pageUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });

            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
            if (match && match[1]) {
                const parsed = JSON.parse(match[1]);
                const bibs = parsed?.props?.pageProps?.initialState?.entities?.bibs || {};
                const results = Object.values(bibs).slice(0, 5).map(b => `${b.title} [${b.format || 'Item'}]`);
                return res.json({ status: "success", mode: "embedded-json", query: title, results });
            }
        } catch (fallbackErr) {
            return res.status(500).json({ error: err.message, fallbackError: fallbackErr.message });
        }

        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
