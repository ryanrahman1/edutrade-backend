//search

const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');

//Load companies
const companies = JSON.parse(fs.readFileSync(path.join(__dirname, 'sandp500.json'), 'utf8'));

const fuse = new Fuse(companies, {
    keys: ['Symbol', 'Security'],
    threshold: 0.3,
    includeScore: false
});

function searchStocks(query) {
    if (!query) return [];

    const results = fuse.search(query);
    return results.map(r => r.item);
}

module.exports = { searchStocks };