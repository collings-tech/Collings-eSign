const mongoose = require('mongoose');
const { mongoUri } = require('../config/env');

async function connectMongo() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
}

module.exports = {
  connectMongo,
  mongoose,
};

