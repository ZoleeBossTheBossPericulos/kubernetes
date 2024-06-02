const express = require("express");
const { Kafka } = require("kafkajs");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || "";

app.use(express.json());

const kafka = new Kafka({
  clientId: "restaurant-service",
  brokers: ["localhost:9092"], // Replace with your Kafka broker addresses
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "restaurant-service-group" });

// Function to connect to MongoDB
async function connectToMongoDB(uri) {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  return client;
}

// Function to find a restaurant by specific food
function findRestaurant(restaurants, specificFood) {
  return restaurants.find((restaurant) =>
    restaurant.foods.some((foodItem) => foodItem.name === specificFood)
  );
}

// Endpoint to get all restaurants
app.get("/restaurants", async (req, res) => {
  let client;
  try {
    client = await connectToMongoDB(MONGODB_URI);
    const db = client.db("kubernetes");
    const restaurants = await db.collection("restaurants").find({}).toArray();
    res.json(restaurants);
  } catch (err) {
    console.error("Error fetching restaurants:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (client) {
      await client.close();
    }
  }
});

// Kafka consumer and producer logic
const runKafka = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "request-data", fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (message.key.toString() === "restaurant") {
        const { food } = JSON.parse(message.value.toString());
        let client;
        try {
          client = await connectToMongoDB(MONGODB_URI);
          const db = client.db("kubernetes");
          const restaurants = await db
            .collection("restaurants")
            .find({})
            .toArray();
          const restaurant = findRestaurant(restaurants, food);
          await producer.send({
            topic: "response-data",
            messages: [
              { key: "restaurant", value: JSON.stringify(restaurant) },
            ],
          });
        } catch (err) {
          console.error("Error processing Kafka message:", err);
        } finally {
          if (client) {
            await client.close();
          }
        }
      }
    },
  });
};

runKafka().catch(console.error);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
