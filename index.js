global.classes = require('./classes/index');

classes.logger.log("Starting..");

let searchQueries = [];

searchQueries.forEach(function (w){
    let startTime = new Date();
    classes.search.search(w).then(r => {
        let endTime = new Date();
        let diffTime = endTime-startTime;
        console.log("Search Result in", diffTime, "ms:", r);
    });
});
