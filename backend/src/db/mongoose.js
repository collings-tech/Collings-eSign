const dns = require('dns');
const mongoose = require('mongoose');
const { mongoUri } = require('../config/env');

// Some networks (VPN / corporate / ISP resolvers) refuse the DNS SRV lookup that a
// `mongodb+srv://` URI requires, which surfaces as `querySrv ECONNREFUSED` before any
// connection is attempted. Point Node's resolver (c-ares) at public DNS so the SRV/TXT
// records for Atlas resolve regardless of the local resolver. Override via DNS_SERVERS
// (comma-separated) if needed.
try {
  const servers = (process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
} catch (err) {
  console.warn('[mongoose] Could not set custom DNS servers:', err.message);
}

async function connectMongo() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
}

module.exports = {
  connectMongo,
  mongoose,
};

