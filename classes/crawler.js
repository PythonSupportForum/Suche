const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const debug = false;

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
    return new Promise((resolve) => {
        try {
            const checkHashQuery = 'SELECT id FROM urls WHERE content_hash = ?';
            classes.db.query(checkHashQuery, [contentHash], (results) => {
                resolve(results.length > 0);
            });
        } catch(e){
            console.log("Error", e);
            resolve(false);
        }
    });
}
function checkURLExists(domain, path) {
    return new Promise((resolve) => {
        try {
            const checkHashQuery = 'SELECT id FROM urls WHERE domain = ? AND path = ?';
            classes.db.query(checkHashQuery, [domain, path], (results) => {
                resolve(results.length > 0);
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

class Crawler {
    constructor(){
        this.must = {};
        this.has = {};
        this.linkCache = {};
        this.backgroundIndex().then(() => {});
    }

    index(url){
        return new Promise(async function(resolve){
            if(url in this.must) delete this.must[url];
            this.has[url] = true;

            if(url.length > 1024) return resolve(false);

            try {
                const data = extractDomainAndPath(url);
                const domain = data.domain;
                const path = data.path;
                if(domain === "") {
                    classes.logger.log(`Website ${url} has no valid Domain!`, "warning");
                    return resolve(false);
                }
                if((await checkURLExists(removeNonAsciiCharacters(shortenString(domain, 64)),  removeNonAsciiCharacters(shortenString(path, 5000))))) return resolve(false);

                let htmlContent = await new Promise(async function(resolve, reject){
                    try {
                        const response = await axios.get(url);
                        const htmlContent = response.data;
                        resolve(htmlContent);
                    } catch(e){
                        if(debug) classes.logger.log(`Error: `+e, "error");
                        resolve(false);
                    }
                });
                if(!htmlContent) return resolve(false);

                const contentHash = calculateHash(htmlContent);
                if(contentHash in this.linkCache) return;
                this.linkCache[contentHash] = true;

                if((await checkContentHashExists(contentHash))) return resolve(false);

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
                                    if(debug) classes.logger.log(`Add Link ${link} to Must!`);
                                    links.push(link);
                                }
                            }
                        }
                    } catch(e){
                        if(debug) classes.logger.log("Error: "+e, "error");
                    }
                });

                const pageInfo = await extractPageInfo(htmlContent, url);

                const insertQuery = 'INSERT INTO urls (url, path, content_hash, type, title, description, keywords, domain, imageURL, name, favicon)\n' +
                    'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?\n' +
                    'WHERE NOT EXISTS (\n' +
                    '    SELECT 1 FROM urls WHERE domain = ? AND path = ?\n' +
                    ');';

                try {
                    await classes.db.query(insertQuery, [
                        removeNonAsciiCharacters(shortenString("https://"+domain+path, 700)),
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
                    if(debug) classes.logger.log(e, "error");
                }

                if(debug) classes.logger.log(`Website ${url} indexed successfully`);

                if(Object.keys(this.must).length > 10000) return resolve(true);

                for (const link of links) {
                    if(!(link in this.has)){
                        this.must[link] = true;
                    }
                }

                resolve(true);
            } catch(e){
                console.log("Error", e);
            }
        }.bind(this));
    }

    async backgroundIndex(){
        while(Object.keys(this.must).length > 0){
            try {
                let mustUrls = Object.keys(this.must);
                let randomIndex = getRandomInteger(0, mustUrls.length-1);
                let url = mustUrls[randomIndex];

                try {
                    await this.index(url);
                } catch(e){
                    classes.logger.log('Error indexing Page: '+e, "error");
                }

                while(Object.keys(this.has).length > 50000) delete this.has[Object.keys(this.has)[0]];
            } catch(e){
                console.log(e);
            }
        }
        setTimeout(function(){
            this.backgroundIndex().then(() => {});
        }.bind(this), 60*1000);
    }
}

module.exports = new Crawler();