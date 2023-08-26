const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const mysql = require('mysql');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const fs = require('fs');

const dbConnection = mysql.createConnection({
    host: 'db.meginder.de',
    user: 'searchEngine',
    password: 'Ttito1607200707',
    database: 'searchEngine'
});
dbConnection.connect();

const debug = true;

function calculateHash(content) {
    content = content.toString();
    return crypto.createHash('sha256').update(content).digest('hex');
}
function extractDomainAndPath(url) {
    try {
        url = url.replace(/^(https?:)?\/\//, '');

        const parts = url.split('/');
        const domain = parts.shift();
        const path = '/' + parts.join('/').split("?")[0].split("#")[0];

        return {
            domain: domain,
            path: path
        };
    } catch(e){
        console.log("Error", e);
        return {
            domain: "",
            path: ""
        };
    }
}
function checkContentHashExists(contentHash) {
    return new Promise((resolve, reject) => {
        try {
            const checkHashQuery = 'SELECT id FROM urls WHERE content_hash = ?';
            dbConnection.query(checkHashQuery, [contentHash], (error, results) => {
                if (error) {
                    console.log("Error", error);
                    resolve(false);
                } else {
                    resolve(results.length > 0);
                }
            });
        } catch(e){
            console.log("Error", e);
            resolve(false);
        }
    });
}
function checkURLExists(domain, path) {
    return new Promise((resolve, reject) => {
        try {
            const checkHashQuery = 'SELECT id FROM urls WHERE domain = ? AND path = ?';
            dbConnection.query(checkHashQuery, [domain, path], (error, results) => {
                if (error) {
                    console.log("Error", error);
                    resolve(false);
                } else {
                    resolve(results.length > 0);
                }
            });
        } catch(e){
            console.log("Error", e);
            resolve(false);
        }
    });
}
function removeNonAsciiCharacters(inputString) {
    return inputString.replace(/[^\x00-\xFF]/g, ' ').trim();
}

function getRandomInteger(min, max) {
    if(min === max) return min;
    if (min >= max) {
        throw new Error("Das Minimum muss kleiner als das Maximum sein.");
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
async function extractPageInfo(htmlContent, baseUrl) {
    const $ = cheerio.load(htmlContent);

    let ogImageUrl = $('meta[property="og:image"]').attr('content');
    if (ogImageUrl && !ogImageUrl.startsWith('http')) {
        ogImageUrl = new URL(ogImageUrl, baseUrl).href;
    }

    let pageTitle = $('title').text().trim().split(" ")[0].split("-")[0];
    pageTitle = pageTitle.charAt(0).toUpperCase() + pageTitle.slice(1);

    let faviconUrl = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href');
    if(!faviconUrl) faviconUrl = "/favicon.ico";
    if (faviconUrl && !faviconUrl.startsWith('http')) {
        faviconUrl = new URL(faviconUrl, baseUrl).href;
    }

    return {
        ogImageUrl: ogImageUrl || "",
        pageTitle: pageTitle || "",
        faviconUrl: faviconUrl || ""
    };
}
function shortenString(inputString, maxLength) {
    maxLength = maxLength-3;
    if (inputString.length > maxLength) {
        return inputString.substring(0, maxLength) + '...';
    }
    return inputString;
}
function flattenNestedArray(arr) {
    const flattenedArray = [];

    function flatten(arr) {
        for (let item of arr) {
            if (Array.isArray(item)) {
                flatten(item);
            } else if (typeof item === 'string') {
                flattenedArray.push(item);
            }
        }
    }

    flatten(arr);
    return flattenedArray;
}


let linkCache = {
    "must": {},
    "has": {},
    "hash": {}
};
let count = 0;

async function indexWebsite(url) {
    if(url.length > 1024) return;
    try {
        const data = extractDomainAndPath(url);
        const domain = data.domain;
        const path = data.path;
        if(domain === "") {
            console.log(`Website ${url} has no valid Domain!`);
            return;
        }
        if((await checkURLExists(removeNonAsciiCharacters(shortenString(domain, 64)),  removeNonAsciiCharacters(shortenString(path, 5000))))){
            if(debug) console.log(`Website ${url} already indexed`);
            return;
        }

        let htmlContent = await new Promise(async function(resolve, reject){
            let stopper = setTimeout(function(){
                if(debug) console.log(`Request to ${url} took to long! Stopped!`);
                resolve(false);
            }, 500);
            try {
                const response = await axios.get(url);
                const htmlContent = response.data;
                resolve(htmlContent);
            } catch(e){
                if(debug) console.log(`Error`, e);
                resolve(false);
            }
        });
        if(!htmlContent) return;

        const contentHash = calculateHash(htmlContent);
        if(contentHash in linkCache) return;
        linkCache[contentHash] = true;

        if ((await checkContentHashExists(contentHash))) {
            if(debug) console.log(`Website ${url} already indexed`);
            return;
        }

        const $ = cheerio.load(htmlContent);
        const links = [];
        $('a').each((index, element) => {
            try {
                let link = $(element).attr('href').toString();
                if (link && link.length > 3) {
                    if(!link.startsWith("mailto") && !link.startsWith("javascript")){
                        if (!(/\s/.test(link))) {
                            if(!link.startsWith("http") && !link.startsWith("//")) {
                                link = new URL(link, url).href;
                            }
                            if(link.startsWith("//")){
                                link = link.replace("//", "https://");
                            }
                            if(debug) console.log(`Add Link ${link} to Must!`);
                            links.push(link);
                        }
                    }
                }
            } catch(e){
                if(debug) console.log("Error", e);
            }
        });

        const pageInfo = await extractPageInfo(htmlContent, url);


        const insertQuery = 'INSERT INTO urls (path, content_hash, type, title, description, keywords, domain, imageURL, name, favicon)\n' +
            'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?\n' +
            'WHERE NOT EXISTS (\n' +
            '    SELECT 1 FROM urls WHERE domain = ? AND path = ?\n' +
            ');';

        try {
            await dbConnection.query(insertQuery, [
                removeNonAsciiCharacters(shortenString(path || "", 5000)),
                removeNonAsciiCharacters(shortenString(contentHash || "", 1024)),
                removeNonAsciiCharacters('website'),
                removeNonAsciiCharacters($('title').text() || ""),
                removeNonAsciiCharacters($('meta[name="description"]').attr('content') || ""),
                removeNonAsciiCharacters($('meta[name="keywords"]').attr('content') || ""),
                removeNonAsciiCharacters(shortenString(domain, 64)),
                removeNonAsciiCharacters(shortenString(pageInfo.ogImageUrl, 5000)),
                removeNonAsciiCharacters(shortenString(pageInfo.pageTitle, 64)),
                removeNonAsciiCharacters(shortenString(pageInfo.faviconUrl, 5000)),
                removeNonAsciiCharacters(shortenString(domain, 64)),
                removeNonAsciiCharacters(shortenString(path || "", 5000))
            ]);
        } catch(e){
            if(debug) console.log(e);
        }

        if(debug) console.log(`Website ${url} indexed successfully`);

        count++;

        if(Object.keys(linkCache.must).length > 10000) return;

        for (const link of links) {
            if(!(link in linkCache.has)){
                linkCache.must[link] = true;
            }
        }
    } catch(e){
        console.log("Error", e);
    }
}

async function main(){
    while(Object.keys(linkCache.must).length > 0){
        try {
            if(Object.keys(linkCache.must).length < 64){
                console.log(`Worker ${process.pid} has no more URLs! Read JSON File!`);
                fs.readFile('data.json', 'utf8', (err, data) => {
                    if (err) {
                        console.error('Error reading file:', err);
                        return;
                    }
                    const jsonData = flattenNestedArray(JSON.parse(data));
                    jsonData.forEach(function(url){
                        linkCache.must[url] = true;
                    });
                });
            }
        } catch(e){
            console.log(e);
        }
        try {
            let mustUrls = Object.keys(linkCache.must);
            let randomIndex = getRandomInteger(0, mustUrls.length-1);
            let url = mustUrls[randomIndex];

            if(url in linkCache.must) delete linkCache.must[url];
            linkCache.has[url] = true;
            try {
                await indexWebsite(url);
            } catch(e){
                if(debug) console.log(e);
            }
            while(Object.keys(linkCache.has).length > 50000){
                delete linkCache.has[Object.keys(linkCache.has)[0]];
            }
        } catch(e){
            console.log(e);
        }
    }
    await new Promise(function(resolve){
        setTimeout(resolve, 1000);
    });
}

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);
    for (let i = 0; i < Math.min(numCPUs, 4); i++) {
        cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        cluster.fork();
    });
} else {
    console.log(`Worker ${process.pid} started`);
    try {
        fs.readFile('data.json', 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading file:', err);
                return;
            }
            const jsonData = flattenNestedArray(JSON.parse(data));
            jsonData.forEach(function(url){
                websitesToIndex.push(url);
            });
        });
    } catch(e){
        console.log(e);
    }
    websitesToIndex.forEach(function(url){
        linkCache.must[url] = true;
    });
    console.log(`Worker ${process.pid} has `+Object.keys(linkCache.must).length+" Websites in Cache!");
    main().then(() => {
        console.log(`Worker ${process.pid} finished`);
        fs.readFile('data.json', 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading file:', err);
                return;
            }
            const jsonData = flattenNestedArray(JSON.parse(data));
            console.log('Read JSON data:', jsonData);
            jsonData.forEach(function(url){
                linkCache.must[url] = true;
            });
        });
    });
    setInterval(function(){
        console.log("["+process.pid+"] "+Object.keys(linkCache.has).length+"/"+Object.keys(linkCache.must).length+" completed! Counter: "+count);
    }, 20000);
    setInterval(function(){
        try {
            const uniqueWebsitesToIndex = [...new Set(websitesToIndex.concat(Object.keys(linkCache.must)))];
            fs.writeFile('data.json', JSON.stringify(uniqueWebsitesToIndex, null, 4), 'utf8', (err) => {
                if (err) console.error('Error writing file:', err);
            });
        } catch(e){
            console.log(e);
        }
    }, 50000);
}