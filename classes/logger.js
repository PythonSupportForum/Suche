const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '..', 'logs');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir);
        }
    }

    log(message, level = 'info') {
        const formattedMessage = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
        console.log(formattedMessage);

        const logFilePath = path.join(this.logDir, `${this.getDateString()}.log`);
        fs.appendFileSync(logFilePath, formattedMessage + '\n');
    }

    getDateString() {
        const now = new Date();
        return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    }
}

module.exports = new Logger();