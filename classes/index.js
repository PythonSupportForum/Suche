const fs = require('fs');
const path = require('path');
const controllers = {};
fs.readdirSync(__dirname)
    .filter(file => file !== 'index.js')
    .forEach(file => {
        const controllerName = path.basename(file, '.js');
        controllers[controllerName] = require(path.join(__dirname, file));
    });
module.exports = controllers;