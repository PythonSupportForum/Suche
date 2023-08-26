const mysql = require('mysql');

const dbConnection = mysql.createConnection({
    host: 'db.meginder.de',
    user: 'searchEngine',
    password: 'Ttito1607200707',
    database: 'searchEngine'
});
dbConnection.connect();

class DB {
    constructor() {}

    query(sql, args = [], callback = null){
        return new Promise(function(resolve){
            dbConnection.query(sql, args, (error, results) => {
                if (error) {
                    classes.logger.log('Error running DB query: '+error, "error");
                    if(callback) callback([]);
                    resolve([]);
                } else {
                    if(callback) callback(results);
                    resolve(results);
                }
            });
        });
    }
}

module.exports = new DB();