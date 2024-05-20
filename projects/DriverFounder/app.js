const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "your_mongodb_uri";

app.use(express.json());

const kafka = new Kafka({
  clientId: "driver-service",
  brokers: ["localhost:9092"], // Replace with your Kafka broker addresses
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "driver-service-group" });

// Function to connect to MongoDB
async function connectToMongoDB(uri) {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  return client;
}

// Function to find the cheapest available driver
function findCheapestDriver(drivers) {
  return drivers.reduce((cheapest, driver) => {
    if (driver.available && driver.rate < (cheapest?.rate || Infinity)) {
      return driver;
    }
    return cheapest;
  }, null);
}

// Endpoint to respond with a welcome message
app.get("/", (req, res) => {
  res.send("Hello Drivers!");
});

// Endpoint to get all drivers
app.get("/drivers", async (req, res) => {
  let client;
  try {
    client = await connectToMongoDB(MONGODB_URI);
    const db = client.db();
    const drivers = await db.collection("drivers").find({}).toArray();
    res.json(drivers);
  } catch (err) {
    console.error("Error fetching drivers:", err);
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
      if (message.key.toString() === "find-driver") {
        let client;
        try {
          client = await connectToMongoDB(MONGODB_URI);
          const db = client.db();
          const drivers = await db.collection("drivers").find({}).toArray();
          const driver = findCheapestDriver(drivers);
          await producer.send({
            topic: "response-data",
            messages: [{ key: "driver", value: JSON.stringify(driver) }],
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

// Endpoint to update driver information
app.put("/drivers/:id", async (req, res) => {
  const driverId = req.params.id;
  const updatedFields = req.body;

  let client;
  try {
    client = await connectToMongoDB(MONGODB_URI);
    const db = client.db();
    const objectId = new ObjectId(driverId);

    const result = await db
      .collection("drivers")
      .updateOne({ _id: objectId }, { $set: updatedFields });

    if (result.modifiedCount === 1) {
      res.status(200).send("Driver updated successfully");
    } else {
      res.status(404).send("Driver not found");
    }
  } catch (err) {
    console.error("Error updating driver:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (client) {
      await client.close();
    }
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
