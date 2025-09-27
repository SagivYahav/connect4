let mysql = require("mysql");

let pool = mysql.createPool({
    connectionLimit: 1,
    host: "localhost",
    user: "root",
    password: "b0mboKlatt",
    database: "my_db",
});

module.exports = pool;
