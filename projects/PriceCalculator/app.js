const express = require("express");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3000;

const kafka = new Kafka({
  clientId: "price-calculator",
  brokers: ["localhost:9092"], // Replace with your Kafka broker addresses
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "price-calculator-group" });

// Function to produce messages
async function produceMessages(food) {
  await producer.connect();
  await producer.send({
    topic: "request-data",
    messages: [
      { key: "driver", value: "find-driver" },
      { key: "restaurant", value: JSON.stringify({ food }) },
    ],
  });
}

// Function to consume messages
async function consumeMessages() {
  let driver = null;
  let restaurant = null;

  await consumer.connect();
  await consumer.subscribe({ topic: "response-data", fromBeginning: true });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

    consumer
      .run({
        eachMessage: async ({ message }) => {
          const key = message.key.toString();
          const value = JSON.parse(message.value.toString());

          if (key === "driver") {
            driver = value;
          } else if (key === "restaurant") {
            restaurant = value;
          }

          if (driver && restaurant) {
            clearTimeout(timeout);
            resolve({ driver, restaurant });
          }
        },
      })
      .catch(reject);
  });

  return { driver, restaurant };
}

app.get("/price-calculator", async (req, res) => {
  try {
    const food = req.query.food;

    // Produce messages to request driver and restaurant data
    await produceMessages(food);

    // Consume responses
    const { driver, restaurant } = await consumeMessages();

    if (!driver.available || !restaurant.available) {
      return res.status(400).send("Driver or Restaurant is not available");
    }

    // Calculate the price
    const price = driver.rate + restaurant.rate; // Example calculation
    res.send({ price });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  } finally {
    await producer.disconnect();
    await consumer.disconnect();
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
