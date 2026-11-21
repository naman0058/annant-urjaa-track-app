'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const action = process.argv[2] === 'down' ? 'down' : 'up';
const file =
  action === 'down'
    ? '006_subscription_payment_link_down.sql'
    : '006_subscription_payment_link.sql';

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', file), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  await conn.query(sql);
  await conn.end();
  console.log(`migrate-subscription-payment-link (${action}): OK`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});