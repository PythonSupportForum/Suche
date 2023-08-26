const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const cheerio = require("cheerio");

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
function removeNonAsciiCharacters(inputString) {
    return inputString.replace(/[^\x00-\xFF]/g, ' ').trim();
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

class Search {
    constructor() {}
    search(originalQuery, page = 0, fast = false){
        return new Promise(async function(resolve){
            let startTime = new Date();

            let oldQuery = originalQuery.toLowerCase().trim();
            let query = calculateHash(oldQuery);

            let foundUrls = {}

            let readData = await new Promise(function(resolve){
                classes.db.query("SELECT * FROM queries WHERE LOWER(query) = LOWER(?) OR LOWER(query) = LOWER(?) ORDER BY strong DESC LIMIT ?, ?; ", [query, oldQuery, page*16, (page+1)*16], (results) => {
                    resolve(results);
                });
            });
            readData.forEach(function(row){
                foundUrls[row.url] = {
                    url: row.url || "",
                    strong: row.strong || 0,
                    klicks: row.klicks || 0,
                    inappropriate: row.inappropriate || 0
                }
            });
            let first = Object.keys(foundUrls).length === 0 && page === 0;
            if(first){
                let googleURLs = await classes.google.search(originalQuery);
                for(let i = 0; i < googleURLs.length; i++){
                    let url = googleURLs[i];
                    classes.crawler.index(url).then(() => {});
                    if(!(url in foundUrls)) {
                        foundUrls[url] = {
                            url: url || "",
                            strong: (googleURLs.length-i)*8,
                            klicks: 0,
                            inappropriate: 0
                        }
                        classes.db.query("INSERT INTO queries (query, url, strong) VALUES (?, ?, ?);", [query, foundUrls[url].url, foundUrls[url].strong]);
                    }
                }
            }
            if(new Date()-startTime < 6000 && (first || page > 0) && Object.keys(foundUrls) < 8 && (!fast || Object.keys(foundUrls).length === 0)){
                let SQLQuery = `SELECT
                        u.id as id,
                        u.url as url,
                        u.title as title,
                        u.description as description,
                        u.keywords as keywords,
                        u.imageURL as image,
                        u.favicon as favicon,
                        u.type as type,
                        u.name as name,
                        CASE
                            WHEN u.url IS NOT NULL THEN u.url
                            ELSE CONCAT('https://', u.domain, u.path)
                        END AS reconstructed_url,
                        COALESCE(SUM(q.strong + q.klicks), 0) AS total_sum
                    FROM
                        urls u
                    LEFT JOIN
                        queries q ON u.url = q.url
                        OR
                        (u.url IS NULL AND CONCAT('https://', u.domain, u.path) = q.url)
                    WHERE
                        LOWER(u.title) LIKE LOWER(?) OR
                        LOWER(u.description) LIKE LOWER(?) OR
                        LOWER(u.keywords) LIKE LOWER(?) OR
                        LOWER(u.domain) LIKE LOWER(?)
                    GROUP BY
                        u.id, reconstructed_url
                    ORDER BY
                        total_sum DESC
                    LIMIT ?, ?;
                `;
                let readOwnExtraData = await new Promise(function(resolve, reject){
                    classes.db.query(SQLQuery, ["%"+oldQuery.replaceAll(" ", "%")+"%", "%"+oldQuery.replaceAll(" ", "%")+"%", "%"+oldQuery.replaceAll(" ", "%")+"%", "%"+oldQuery.replaceAll(" ", "%")+"%", page*6, (page+1)*6], (results) => {
                        resolve(results);
                    });
                });
                readOwnExtraData.forEach(function(row){
                    if(!(row.reconstructed_url in foundUrls)){
                        foundUrls[row.reconstructed_url] = {
                            url: row.reconstructed_url || "",
                            strong: row.total_sum,
                            klicks: 0,
                            inappropriate: 0,
                            title: row.title,
                            description: row.description,
                            keywords: row.keywords,
                            image: row.image,
                            favicon: row.favicon,
                            type: row.type,
                            name: row.name
                        }
                        classes.db.query("INSERT INTO queries (query, url, strong) VALUES (?, ?, ?);", [query, foundUrls[row.reconstructed_url].url, foundUrls[row.reconstructed_url].strong]);
                    }
                });
            }
            const urlArray = Object.values(foundUrls);
            urlArray.sort((a, b) => {
                const scoreA = a.strong * 1 + a.klicks * 1 - a.inappropriate * 8;
                const scoreB = b.strong * 1 + b.klicks * 1 - b.inappropriate * 8;
                if (scoreA !== scoreB) {
                    return scoreB - scoreA;
                } else if (a.inappropriate !== b.inappropriate) {
                    return a.inappropriate - b.inappropriate;
                } else {
                    return b.klicks - a.klicks;
                }
            });
            let uniqueUrls = [];
            let Domains = {};
            for(let i = 0; i < urlArray.length; i++){
                let entry = urlArray[i];
                let parts = extractDomainAndPath(entry.url || "");
                entry.domain = parts.domain;
                entry.path = parts.path;
                if(!entry.title && new Date()-startTime < 5000){
                    console.log(i, "Entry Working", new Date()-startTime);
                    let SQLQuery = "SELECT * FROM urls WHERE url = ? OR (url IS NULL AND domain = ? AND path = ?) LIMIT 1; ";
                    let results = await classes.db.query(SQLQuery, [entry.url, entry.domain, entry.path]);
                    console.log(i, "Runned Query", new Date()-startTime);
                    if(results.length > 0) {
                        let result = results[0];
                        entry.title = result.title;
                        entry.description = result.description;
                        entry.keywords = result.keywords;
                        entry.image = result.imageURL;
                        entry.favicon = result.favicon;
                        entry.type = result.type;
                        entry.name = result.name;
                    } else if(new Date()-startTime < 5000 && !fast){
                        try {
                            let htmlContent = await new Promise(async function(resolve, reject){
                                try {
                                    const response = await axios.get(entry.url);
                                    const htmlContent = response.data;
                                    resolve(htmlContent);
                                } catch(e){
                                    console.log(`Error:`, e);
                                    resolve(false);
                                }
                            });
                            if(!htmlContent) continue;

                            const pageInfo = await extractPageInfo(htmlContent, entry.url);

                            entry.name = pageInfo.pageTitle || "";
                            entry.image = pageInfo.ogImageUrl || "";
                            entry.favicon = pageInfo.faviconUrl || "";

                            try {
                                const $ = cheerio.load(htmlContent);
                                entry.title = removeNonAsciiCharacters($('title').text() || "");
                                entry.description = removeNonAsciiCharacters($('meta[name="description"]').attr('content') || "");
                                entry.keywords = removeNonAsciiCharacters($('meta[name="keywords"]').attr('content') || "");

                                if((entry.title || "").trim().length === 0){
                                    entry.title = removeNonAsciiCharacters($('h1').text() || "");
                                }
                                if((entry.title || "").trim().length === 0){
                                    entry.title = removeNonAsciiCharacters($('h2').text() || "");
                                }
                            } catch(e){
                                console.log("Error Crawling Website:", e);
                            }
                        } catch(e){
                            console.log(e);
                            continue;
                        }
                    }
                }
                if(entry.title){
                    if(!(entry.domain in Domains)) Domains[entry.domain] = {};
                    if((entry.title || "") in Domains[entry.domain]) continue;

                    if(entry.title.trim().length > 0) Domains[entry.domain][entry.title] = true;
                }
                uniqueUrls.push(entry);
            }
            console.log("Fertig", new Date()-startTime);
            resolve(uniqueUrls);
        });
    }
}

module.exports = new Search();