const http = require('http');
const url = require('url');

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path.startsWith('/search/')) {
        let page = 0;
        let searchText = "";
        try {
            if (path.startsWith('/search/page/')) {
                page = Number(path.split("/")[3] || 0);
                searchText = decodeURIComponent(path.slice(('/search/page/'+(path.split("/")[3] || 0)+'/').length));
                if(!page) page = 0;
            } else {
                searchText = decodeURIComponent(path.slice('/search/'.length));
            }
        } catch(e){
            console.log(e);
        }
        if(page < 0) page = 0;
        let fast = page === 0;

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);

        let startTime = new Date();
        classes.search.search(searchText, page, true).then(r => {
            let endTime = new Date();
            let diffTime = endTime-startTime;

            const responseJson = {
                searchQuery: searchText,
                page: page,
                fast: fast,
                message: 'Search query received successfully.',
                time: diffTime,
                results: r
            };

            res.end(JSON.stringify(responseJson));
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

const PORT = 2023;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});