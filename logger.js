const {createLogger, format, transports} = require("winston");
require('winston-daily-rotate-file');

let debug = process.env.NEPBOT_DEBUG === "true";

const myFormat = format.printf(({level, message, timestamp}) => {
    return `${timestamp} ${level}: ${message}`;
});

let myTransports = [new transports.Console({level: debug ? 'debug' : 'info'}),
    new transports.DailyRotateFile({
        filename: "debug.log.%DATE%",
        zippedArchive: true,
        datePattern: 'YYYY-MM-DD',
        level: 'debug'
    })];

const logger = createLogger({
    format: format.combine(format.timestamp(), format.simple(), format.colorize(), myFormat),
    transports: myTransports,
    handleExceptions: true,
    handleRejections: true
});

module.exports = logger;
