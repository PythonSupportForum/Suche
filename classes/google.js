const { google } = require('googleapis');
const path = require("path");
const fs = require("fs");
const customsearch = google.customsearch('v1');

const YOUR_CX = '659fc30f71ea14ee9';
const YOUR_KEY = 'AIzaSyA86D7LK9Kfo89616o7Ncjuk6vVNoCT7dA';

async function searchGoogle(query = "", numResults = 10) {
    try {
        const res = await customsearch.cse.list({
            q: query,
            cx: YOUR_CX,
            num: numResults,
            auth: YOUR_KEY,
            hl: "de",
            gl: "de"
        });
        const items = res.data.items;
        if (items && items.length) return items.map(item => item.link);
        return [];
    } catch (error) {
        classes.logger.log('Error searching Google: '+error, "error");
        return [];
    }
}

let cache = {};

class Google {
    constructor() {}

    search(query = ""){
        return new Promise(async function(resolve){
            if((query in cache) && new Date()-cache[query].time < 30*24*60*60*1000) return cache[query].urls;
            const resultUrls = await searchGoogle(query, 6);
            cache[query] = {"time": new Date(), "urls": resultUrls};
            while(Object.keys(cache).length > 10000){
                delete cache[Object.keys(cache)[0]];
            }
            resolve(resultUrls);
        });
    }
}

module.exports = new Google();